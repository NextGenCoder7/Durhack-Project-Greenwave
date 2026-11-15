// 3D view of one world snapshot (three.js). Drop-in for createMapRenderer: reads snapshots only.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/OrbitControls.js';
import { junctionPos, dirVec, DIRS, PHASE_OF, WORLD_SIZE, N, SPACING, STUB, opposite, left } from '../world/grid.js';
import { mulberry32 } from '../world/rng.js';

const C = {
  bg: 0x0b1220, ground: 0x0d1626, block: 0x121c30, panel: 0x111b2e, road: 0x1c2a44, lane: 0x3a5280,
  go: 0x3dffa8, stop: 0xff5470, wait: 0xffb547, data: 0x38bdf8, siren: 0xff3355, sirenBlue: 0x4d7cff,
  car: 0x9fb3d1, off: 0x4a5a78, park: 0x10261f, tree: 0x1f6b4a, trunk: 0x3a2a1e,
  // Signals: saturated pure green / red so they read from the back of a room; route preview is violet
  // so it never competes with either.
  sigGo: 0x22ff66, sigStop: 0xff2238, route: 0xc77dff,
};
const W = WORLD_SIZE, H = W / 2;
const ROAD_W = 16, PLATE = 16, SIREN_RANGE = 80;   // plate = road width; cars stop 12 m from centre (world BOX_HALF)
const LINK_Y = 12;                    // links run overhead like fibre; picking intersects this plane
const FRAME_R = 300;                  // m: radius of the circle the camera keeps in frame
const ELEV = THREE.MathUtils.degToRad(62), FOV = 34;
const MAX_CARS = 500, MAX_MSG = 400;
// Camera limits: zoom range (distance to the look-at point), tilt range, and how far the look-at point may pan.
const MIN_DIST = 90, MAX_DIST = 1500, MIN_POLAR = 0.05, MAX_POLAR = THREE.MathUtils.degToRad(78), PAN_LIMIT = H + 60;
// Ambulance view: camera this far from the ambulance, tilted this far from straight down.
const FOLLOW_DIST = 230, FOLLOW_PHI = THREE.MathUtils.degToRad(28), FOLLOW_LERP = 0.15;
const CAR = { L: 5, W: 3, H: 2.2 };    // short enough that a queue (drawn gap ~5 m) doesn't overlap

// World metres (x right, y down) -> local scene coords (x, z), centred on the grid.
const sx = x => x - H, sz = y => y - H;
const yawOf = (vx, vy) => Math.atan2(-vy, vx);   // rotation.y that points local +x along (vx, vy)

function textSprite(text, color, h = 14) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 64;
  const g = c.getContext('2d');
  g.font = 'bold 44px Bahnschrift, "Segoe UI", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = color; g.fillText(text, 128, 34);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthTest: false }));
  s.scale.set(h * 4, h, 1);
  return s;
}

function haloTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d'), grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)'); grad.addColorStop(0.25, 'rgba(255,255,255,0.7)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

/** Flat chevron arrow lying on the ground, pointing along local +x. */
function arrowGeometry(len, wid) {
  const sh = new THREE.Shape();
  sh.moveTo(len / 2, 0); sh.lineTo(-len / 2, wid / 2); sh.lineTo(-len / 6, 0); sh.lineTo(-len / 2, -wid / 2); sh.closePath();
  const g = new THREE.ShapeGeometry(sh);
  g.rotateX(-Math.PI / 2);                 // shape XY -> ground XZ
  return g;
}

function windowTexture(rng) {
  const c = document.createElement('canvas'); c.width = 64; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, 64, 128);
  for (let y = 4; y < 124; y += 10) for (let x = 4; x < 60; x += 9) {
    const u = rng();
    if (u < 0.45) continue;
    g.fillStyle = u < 0.8 ? '#ffd9a0' : u < 0.93 ? '#9fd8ff' : '#ffffff';
    g.globalAlpha = 0.35 + rng() * 0.6; g.fillRect(x, y, 5, 6);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function createScene3D(canvas) {
  let renderer;
  try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true }); } catch { return null; }
  renderer.setClearColor(C.bg);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(FOV, 1, 5, 3000);
  const dist = FRAME_R / Math.sin(THREE.MathUtils.degToRad(FOV / 2));
  camera.position.set(0, dist * Math.sin(ELEV), dist * Math.cos(ELEV));
  camera.lookAt(0, 0, 0);
  const home = camera.position.clone();
  scene.fog = new THREE.Fog(C.bg, dist * 1.05, dist * 1.9);

  // Orbit (left drag), pan (right drag / shift+drag), zoom (wheel / pinch), within fixed limits.
  const controls = new OrbitControls(camera, canvas);
  Object.assign(controls, {
    minDistance: MIN_DIST, maxDistance: MAX_DIST, minPolarAngle: MIN_POLAR, maxPolarAngle: MAX_POLAR,
    screenSpacePanning: false, zoomToCursor: true, rotateSpeed: 0.6,
  });
  let syncing = false, onView = null;
  function afterViewChange() {
    const t = controls.target;
    t.x = THREE.MathUtils.clamp(t.x, -PAN_LIMIT, PAN_LIMIT); t.z = THREE.MathUtils.clamp(t.z, -PAN_LIMIT, PAN_LIMIT); t.y = 0;
    const d = camera.position.distanceTo(t);
    scene.fog.near = d * 1.05; scene.fog.far = d * 1.9 + 400;
    measureScale();
  }
  controls.addEventListener('change', () => {
    afterViewChange();
    if (!syncing && onView) onView(getView());
  });
  // While following, panels share only the camera's offset from their own ambulance (each follows its own).
  let follow = false;
  const offset = new THREE.Vector3(), ambAt = new THREE.Vector3();
  const getView = () => (follow
    ? { offset: camera.position.clone().sub(controls.target).toArray() }
    : { position: camera.position.toArray(), target: controls.target.toArray() });
  function setView(v) {
    syncing = true;
    if (v.offset) camera.position.copy(controls.target).add(offset.fromArray(v.offset));
    else { camera.position.fromArray(v.position); controls.target.fromArray(v.target); }
    controls.update(); afterViewChange();
    syncing = false;
  }
  let followFresh = true;                       // next em-vehicle seen while following: swoop in close
  function resetView() { setView({ position: home.toArray(), target: [0, 0, 0] }); followFresh = true; }
  /** Ambulance view: the camera hovers above the ambulance and travels with it (orbit and zoom still work). */
  function setFollow(on) {
    follow = !!on;
    controls.enablePan = !follow;
    if (!follow) return;
    followFresh = false;
    const sph = new THREE.Spherical().setFromVector3(offset.copy(camera.position).sub(controls.target));
    sph.radius = FOLLOW_DIST; sph.phi = FOLLOW_PHI;
    setView({ offset: offset.setFromSpherical(sph).toArray() });
  }

  scene.add(new THREE.HemisphereLight(0xb8ccff, 0x1a2540, 1.6));
  const sun = new THREE.DirectionalLight(0xdfe8ff, 1.6); sun.position.set(-300, 600, 250); scene.add(sun);

  const city = new THREE.Group(); scene.add(city);
  const mat = (color, extra = {}) => new THREE.MeshLambertMaterial({ color, ...extra });
  const glowMat = (color, extra = {}) => new THREE.MeshBasicMaterial({ color, ...extra });

  // ---------------- Static: ground, roads, plates ----------------
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(W * 3, W * 3), mat(C.ground));
  ground.rotation.x = -Math.PI / 2; ground.position.y = -0.05; city.add(ground);
  const roadMat = mat(C.road), plateMat = mat(C.panel);
  for (let i = 0; i < N; i++) {
    const at = STUB + i * SPACING;
    const ew = new THREE.Mesh(new THREE.BoxGeometry(W, 0.2, ROAD_W), roadMat); ew.position.set(0, 0.1, sz(at)); city.add(ew);
    const ns = new THREE.Mesh(new THREE.BoxGeometry(ROAD_W, 0.2, W), roadMat); ns.position.set(sx(at), 0.1, 0); city.add(ns);
  }
  const laneMat = new THREE.LineDashedMaterial({ color: C.lane, dashSize: 4, gapSize: 5 });
  for (let i = 0; i < N; i++) {
    const at = STUB + i * SPACING;
    for (const pts of [[sx(0), sz(at), sx(W), sz(at)], [sx(at), sz(0), sx(at), sz(W)]]) {
      const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(pts[0], 0.25, pts[1]), new THREE.Vector3(pts[2], 0.25, pts[3])]);
      const l = new THREE.Line(g, laneMat); l.computeLineDistances(); city.add(l);
    }
  }
  const NJ = N * N;
  for (let j = 0; j < NJ; j++) {
    const p = junctionPos(j);
    const plate = new THREE.Mesh(new THREE.BoxGeometry(PLATE, 0.3, PLATE), plateMat); plate.position.set(sx(p.x), 0.15, sz(p.y)); city.add(plate);
  }

  // ---------------- Static: traffic lights ----------------
  // Every approach shows its state three ways, so it reads at any zoom and without relying on colour alone:
  //   1. a tall signal head (red lamp on top, green below) with a glowing halo around the lit lamp;
  //   2. red: a thick glowing stop bar across the lane;  green: a glowing arrow pointing through the junction.
  const lamp = { redOn: glowMat(C.sigStop), redOff: mat(0x2a1216), greenOn: glowMat(C.sigGo), greenOff: mat(0x0f2a18) };
  const haloTex = haloTexture();
  const haloMat = c => new THREE.SpriteMaterial({ map: haloTex, color: c, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false });
  const halos = { go: haloMat(C.sigGo), stop: haloMat(C.sigStop) };
  const barMat = glowMat(C.sigStop), arrowMat = glowMat(C.sigGo, { side: THREE.DoubleSide });
  const poleMat = mat(0x2a3650), headMat = mat(0x0a0f1a);
  const poleGeo = new THREE.CylinderGeometry(0.5, 0.5, 12, 6), headGeo = new THREE.BoxGeometry(2.4, 7.5, 2.4);
  const lampGeo = new THREE.SphereGeometry(1.3, 12, 10), barGeo = new THREE.BoxGeometry(3, 0.6, ROAD_W / 2 - 0.4);
  const arrowGeo = arrowGeometry(7, 6.5);
  const RED_Y = 16.6, GREEN_Y = 12.4;
  const signals = [];                          // [j][d] -> { red, green, bar, arrow, halo }
  for (let j = 0; j < NJ; j++) {
    const p = junctionPos(j), row = {};
    for (const d of DIRS) {
      const v = dirVec(d), heading = opposite(d), h = dirVec(heading), l = dirVec(left(heading));
      const g = new THREE.Group();
      // Corner on the approaching driver's side (drive on the left), just before the stop line.
      const cx = p.x + v.x * (PLATE / 2 + 2) + l.x * (ROAD_W / 2 + 1.5), cy = p.y + v.y * (PLATE / 2 + 2) + l.y * (ROAD_W / 2 + 1.5);
      g.position.set(sx(cx), 0, sz(cy));
      const pole = new THREE.Mesh(poleGeo, poleMat); pole.position.y = 6; g.add(pole);
      const head = new THREE.Mesh(headGeo, headMat); head.position.y = 14.5; g.add(head);
      const red = new THREE.Mesh(lampGeo, lamp.redOff), green = new THREE.Mesh(lampGeo, lamp.greenOff);
      // Lamps face the approaching cars (towards side d).
      red.position.set(v.x * 1.2, RED_Y, v.y * 1.2); green.position.set(v.x * 1.2, GREEN_Y, v.y * 1.2);
      const halo = new THREE.Sprite(halos.stop); halo.scale.set(20, 20, 1); halo.position.copy(red.position);
      g.add(red, green, halo); city.add(g);
      const lane = ROAD_W / 4;
      // Red: stop bar across the approach lane, at the stop line.
      const bar = new THREE.Mesh(barGeo, barMat);
      bar.position.set(sx(p.x + v.x * (PLATE / 2 + 0.6) + l.x * lane), 0.45, sz(p.y + v.y * (PLATE / 2 + 0.6) + l.y * lane));
      bar.rotation.y = yawOf(v.x, v.y);
      // Green: arrow inside the junction, in this approach's lane, pointing the way traffic now flows.
      const arrow = new THREE.Mesh(arrowGeo, arrowMat);
      arrow.position.set(sx(p.x + v.x * 4.5 + l.x * lane), 0.5, sz(p.y + v.y * 4.5 + l.y * lane));
      arrow.rotation.y = yawOf(h.x, h.y);
      arrow.visible = false;
      city.add(bar, arrow);
      row[d] = { red, green, bar, arrow, halo };
    }
    signals.push(row);
  }

  // ---------------- Route preview (ambulance planner) ----------------
  const routeGroup = new THREE.Group(), targetGroup = new THREE.Group();
  city.add(routeGroup, targetGroup);
  const routeMat = glowMat(C.route, { transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide });
  const routeDim = glowMat(C.route, { transparent: true, opacity: 0.28, depthWrite: false, side: THREE.DoubleSide });
  const targetMat = glowMat(0xffffff, { transparent: true, side: THREE.DoubleSide, depthWrite: false });
  const segGeo = new THREE.BoxGeometry(1, 0.3, 2.6), nodeGeo = new THREE.CylinderGeometry(3.2, 3.2, 0.4, 24);
  const tipGeo = arrowGeometry(16, 14);
  const ringGeo = new THREE.RingGeometry(9, 12, 36); ringGeo.rotateX(-Math.PI / 2);
  let routeKey = '', targetKey = '';
  const clearGroup = gr => { while (gr.children.length) gr.remove(gr.children[0]); };
  /** pts: world-metre polyline, or null. dim: drawn fainter (while the ambulance drives). */
  function setRoute(pts, { dim = false } = {}) {
    const key = pts && pts.length > 1 ? JSON.stringify(pts) + dim : '';
    if (key === routeKey) return;
    routeKey = key; clearGroup(routeGroup);
    if (!key) return;
    const m = dim ? routeDim : routeMat;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i], len = Math.hypot(b.x - a.x, b.y - a.y);
      const seg = new THREE.Mesh(segGeo, m);
      seg.scale.x = len; seg.position.set(sx((a.x + b.x) / 2), 0.9, sz((a.y + b.y) / 2)); seg.rotation.y = yawOf(b.x - a.x, b.y - a.y);
      routeGroup.add(seg);
      if (i < pts.length - 1) { const n = new THREE.Mesh(nodeGeo, m); n.position.set(sx(b.x), 1, sz(b.y)); routeGroup.add(n); }
    }
    const end = pts[pts.length - 1], prev = pts[pts.length - 2];
    const tip = new THREE.Mesh(tipGeo, m);
    tip.position.set(sx(end.x), 1.1, sz(end.y)); tip.rotation.y = yawOf(end.x - prev.x, end.y - prev.y);
    routeGroup.add(tip);
  }
  /** pts: clickable planner targets (world metres), or null. They pulse in draw(). */
  function setTargets(pts) {
    const key = pts && pts.length ? JSON.stringify(pts) : '';
    if (key === targetKey) return;
    targetKey = key; clearGroup(targetGroup);
    for (const t of pts || []) { const r = new THREE.Mesh(ringGeo, targetMat); r.position.set(sx(t.x), 1.2, sz(t.y)); targetGroup.add(r); }
  }

  // ---------------- Static: links (overhead) ----------------
  const linkMats = { up: glowMat(C.data, { transparent: true, opacity: 0.85 }), off: glowMat(C.off, { transparent: true, opacity: 0.5 }), cut: glowMat(C.stop) };
  const linkHoverMats = { up: glowMat(0xa8e6ff), off: glowMat(0x8ea3c4), cut: glowMat(0xff9aab) };
  const links = new Map();                     // "a-b" -> { mesh, x }
  const linkGeo = new THREE.BoxGeometry(1, 0.6, 1.4);
  const ensureLink = (a, b) => {
    const k = `${a}-${b}`;
    if (links.has(k)) return links.get(k);
    const pa = junctionPos(a), pb = junctionPos(b);
    const len = Math.hypot(pb.x - pa.x, pb.y - pa.y) - PLATE;
    const mesh = new THREE.Mesh(linkGeo, linkMats.up);
    mesh.scale.x = len; mesh.position.set(sx((pa.x + pb.x) / 2), LINK_Y, sz((pa.y + pb.y) / 2));
    mesh.rotation.y = yawOf(pb.x - pa.x, pb.y - pa.y);
    const x = textSprite('✕', '#ff5470', 18); x.position.copy(mesh.position); x.position.y += 4; x.visible = false;
    // Masts at each end so the overhead link reads as attached to its junctions.
    city.add(mesh, x);
    const e = { mesh, x }; links.set(k, e); return e;
  };
  const mastGeo = new THREE.CylinderGeometry(0.5, 0.5, LINK_Y, 6), mastMat = mat(0x2a3d61);
  for (let j = 0; j < NJ; j++) {
    const p = junctionPos(j), m = new THREE.Mesh(mastGeo, mastMat);
    m.position.set(sx(p.x), LINK_Y / 2, sz(p.y)); city.add(m);
  }

  // ---------------- Static: orphan markers ----------------
  const orphans = [];
  for (let j = 0; j < NJ; j++) {
    const p = junctionPos(j);
    const ring = new THREE.Mesh(new THREE.RingGeometry(PLATE * 0.78, PLATE * 0.92, 40), glowMat(C.wait, { transparent: true, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2; ring.position.set(sx(p.x), 0.5, sz(p.y)); ring.visible = false;
    const label = textSprite('TIMER', '#ffb547', 10); label.position.set(sx(p.x), 26, sz(p.y)); label.visible = false;
    city.add(ring, label); orphans.push({ ring, label });
  }

  // ---------------- Buildings (rebuilt per city seed) ----------------
  let buildings = new THREE.Group(); city.add(buildings);
  function setCity(seed) {
    city.remove(buildings);
    buildings.traverse(o => { o.geometry?.dispose?.(); if (o.material) [].concat(o.material).forEach(m => { m.emissiveMap?.dispose(); m.dispose(); }); });
    buildings = new THREE.Group(); city.add(buildings);
    const rng = mulberry32((seed * 2654435761) >>> 0);
    // Block spans between road edges along one axis, with a sidewalk setback.
    const cuts = [0];
    for (let i = 0; i < N; i++) { const at = STUB + i * SPACING; cuts.push(at - ROAD_W / 2, at + ROAD_W / 2); }
    cuts.push(W);
    const spans = []; for (let i = 0; i < cuts.length; i += 2) spans.push([cuts[i] + 4, cuts[i + 1] - 4]);
    const blockMat = mat(C.block), parkMat = mat(C.park), treeMat = mat(C.tree), trunkMat = mat(C.trunk);
    const treeGeo = new THREE.ConeGeometry(3.2, 9, 7), trunkGeo = new THREE.CylinderGeometry(0.6, 0.6, 2.5, 5);
    const roofMat = mat(0x24324f);
    for (const [x0, x1] of spans) for (const [y0, y1] of spans) {
      const pad = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0 + 6, 0.4, y1 - y0 + 6), blockMat);
      pad.position.set(sx((x0 + x1) / 2), 0.2, sz((y0 + y1) / 2)); buildings.add(pad);
      const outer = x0 < STUB || y0 < STUB || x1 > W - STUB || y1 > W - STUB;
      const nx = 1 + Math.floor(rng() * 2), ny = 1 + Math.floor(rng() * 2);
      const lw = (x1 - x0) / nx, lh = (y1 - y0) / ny;
      for (let a = 0; a < nx; a++) for (let b = 0; b < ny; b++) {
        const lx0 = x0 + a * lw + 3, ly0 = y0 + b * lh + 3, w = lw - 6, d = lh - 6;
        const cxp = lx0 + w / 2, cyp = ly0 + d / 2;
        if (rng() < 0.14) {                    // park
          const park = new THREE.Mesh(new THREE.BoxGeometry(w, 0.6, d), parkMat);
          park.position.set(sx(cxp), 0.4, sz(cyp)); buildings.add(park);
          const nt = 3 + Math.floor(rng() * 4);
          for (let t = 0; t < nt; t++) {
            const tx = sx(lx0 + 4 + rng() * (w - 8)), tz = sz(ly0 + 4 + rng() * (d - 8));
            const tr = new THREE.Mesh(trunkGeo, trunkMat); tr.position.set(tx, 1.6, tz);
            const cone = new THREE.Mesh(treeGeo, treeMat); cone.position.set(tx, 7, tz);
            buildings.add(tr, cone);
          }
          continue;
        }
        const bw = w * (0.55 + rng() * 0.3), bd = d * (0.55 + rng() * 0.3);
        const h = (outer ? 10 : 6) + rng() * (outer ? 30 : 18);
        const tex = windowTexture(rng);
        tex.repeat.set(Math.max(1, Math.round(bw / 14)), Math.max(1, Math.round(h / 18)));
        const tone = new THREE.Color().setHSL(0.6 + rng() * 0.05, 0.2, 0.16 + rng() * 0.08);
        const side = new THREE.MeshLambertMaterial({ color: tone, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.75 });
        const box = new THREE.Mesh(new THREE.BoxGeometry(bw, h, bd), [side, side, roofMat, roofMat, side, side]);
        box.position.set(sx(cxp), h / 2 + 0.4, sz(cyp)); buildings.add(box);
        if (h > 30 && rng() < 0.5) {           // rooftop beacon
          const bcn = new THREE.Mesh(new THREE.SphereGeometry(0.9, 8, 6), glowMat(C.stop));
          bcn.position.set(sx(cxp), h + 1.6, sz(cyp)); buildings.add(bcn);
        }
      }
    }
  }

  // ---------------- Dynamic: cars ----------------
  const bodyGeo = new THREE.BoxGeometry(CAR.L, CAR.H, CAR.W); bodyGeo.translate(0, CAR.H / 2 + 0.3, 0);
  const cabGeo = new THREE.BoxGeometry(CAR.L * 0.5, CAR.H * 0.7, CAR.W * 0.88); cabGeo.translate(-CAR.L * 0.08, CAR.H + 0.3 + CAR.H * 0.35, 0);
  const bodies = new THREE.InstancedMesh(bodyGeo, glowMat(0xffffff), MAX_CARS);   // unlit: cars must pop at panel size
  const cabs = new THREE.InstancedMesh(cabGeo, mat(0x1b2a44), MAX_CARS);
  bodies.frustumCulled = cabs.frustumCulled = false;
  const colGo = new THREE.Color(C.car), colWait = new THREE.Color(C.wait);
  for (let i = 0; i < MAX_CARS; i++) bodies.setColorAt(i, colGo);
  bodies.count = cabs.count = 0;
  city.add(bodies, cabs);
  const yaws = new Map();                      // car id -> { x, y, yaw }

  // ---------------- Dynamic: em-vehicle (ambulance, fire engine or police car) ----------------
  // Each model has two light-bar lamps (a, b) that alternate; `colors` are their lit colours.
  const amb = new THREE.Group();
  const box = (w, h, d, m, x, y, z = 0) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.position.set(x, y, z); return o; };
  const lampPair = (g, x, y, ca, cb, spread = 0.8) => {
    const a = box(1.2, 0.8, 1.4, glowMat(ca), x, y, -spread), b = box(1.2, 0.8, 1.4, glowMat(cb), x, y, spread);
    g.add(a, b); return { a, b };
  };
  function buildAmbulance() {
    const g = new THREE.Group();
    g.add(box(6.5, 3.2, 3.4, mat(0xf4f7ff), 0, 2), box(6.55, 0.6, 3.45, glowMat(C.siren), 0, 2));
    return { g, colors: [C.siren, C.sirenBlue], ...lampPair(g, 0.8, 3.9, C.siren, C.sirenBlue) };
  }
  function buildFireEngine() {
    const g = new THREE.Group(), red = mat(0xd81e1e), white = mat(0xe8eef8);
    g.add(box(8.5, 3, 3.4, red, -0.4, 1.9), box(2.2, 3.4, 3.5, mat(0xa01414), 3.6, 2.1));   // body + cab
    g.add(box(2.25, 0.9, 3.55, glowMat(0x9fd8ff), 3.7, 2.8));                              // windscreen band
    for (const z of [-1, 1]) g.add(box(6.6, 0.3, 0.3, white, -0.9, 3.7, z));                // ladder rails
    for (let i = 0; i < 6; i++) g.add(box(0.25, 0.25, 2, white, -3.8 + i * 1.15, 3.7));      // rungs
    return { g, colors: [0xff2020, 0xffffff], ...lampPair(g, 3.6, 4.2, 0xff2020, 0xffffff) };
  }
  function buildPoliceCar() {
    const g = new THREE.Group();
    g.add(box(5.6, 1.6, 3, mat(0x15224a), 0, 1.2), box(5.65, 0.5, 3.05, mat(0xf4f7ff), 0, 1.3));  // body + white band
    g.add(box(2.8, 1.1, 2.7, mat(0xdfe6f2), -0.3, 2.55));                                        // cabin
    return { g, colors: [0x2f6bff, 0xff2238], ...lampPair(g, -0.3, 3.4, 0x2f6bff, 0xff2238, 0.7) };
  }
  const models = { ambulance: buildAmbulance(), fire: buildFireEngine(), police: buildPoliceCar() };
  let kind = 'ambulance';
  for (const [k, m] of Object.entries(models)) { m.g.visible = k === kind; amb.add(m.g); }
  const halo = new THREE.Mesh(new THREE.SphereGeometry(7, 16, 12), glowMat(C.siren, { transparent: true, opacity: 0.22, depthWrite: false }));
  halo.position.y = 3;
  const sirenLight = new THREE.PointLight(C.siren, 0, 90, 1.5); sirenLight.position.y = 8;
  amb.add(halo);
  city.add(sirenLight);                        // outside the (sometimes hidden) group: light count never changes
  amb.visible = false; city.add(amb);
  const dimmed = new THREE.Color();
  /** Which em-vehicle model to draw: 'ambulance' | 'fire' | 'police'. */
  function setVehicleKind(k) {
    if (!models[k]) return;
    kind = k;
    for (const [key, m] of Object.entries(models)) m.g.visible = key === k;
  }
  const sirenRing = new THREE.Mesh(new THREE.RingGeometry(SIREN_RANGE - 1.2, SIREN_RANGE, 72), glowMat(C.siren, { transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false }));
  sirenRing.rotation.x = -Math.PI / 2; sirenRing.visible = false; city.add(sirenRing);
  let ambYaw = 0, ambPrev = null;

  // ---------------- Dynamic: messages ----------------
  const msgData = new THREE.InstancedMesh(new THREE.SphereGeometry(1.6, 8, 6), glowMat(C.data), MAX_MSG);
  const msgPri = new THREE.InstancedMesh(new THREE.SphereGeometry(2.4, 10, 8), glowMat(C.siren, { transparent: true }), MAX_MSG);
  msgData.frustumCulled = msgPri.frustumCulled = false;
  msgData.count = msgPri.count = 0; city.add(msgData, msgPri);

  // ---------------- Sizing, orientation, picking ----------------
  let cssW = 0, cssH = 0, dpr = 1, pxPerM = 1;
  function measureScale() {
    if (!cssW) return;
    camera.updateMatrixWorld();
    const t = controls.target, a = t.clone().project(camera), b = t.clone().add(new THREE.Vector3(10, 0, 0)).project(camera);
    pxPerM = Math.max(0.05, (Math.abs(b.x - a.x) * cssW) / 2 / 10);
  }
  function resize() {
    // The canvas fills its whole box (any shape). The camera frames the city by height; on a box taller
    // than it is wide it zooms out so the city still fits across.
    const host = canvas.parentElement;
    const w = Math.floor(host.clientWidth), h = Math.floor(host.clientHeight);
    const d = Math.min(window.devicePixelRatio || 1, 2);
    if (w < 50 || h < 50) return;
    if (w === cssW && h === cssH && d === dpr) return;
    cssW = w; cssH = h; dpr = d;
    renderer.setPixelRatio(d); renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.zoom = Math.min(1, w / h); camera.updateProjectionMatrix();
    measureScale();
  }
  function setOrientation(yaw) { city.rotation.y = yaw; city.updateMatrixWorld(true); yaws.clear(); ambPrev = null; resetView(); }

  const ray = new THREE.Raycaster(), plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -LINK_Y), hit = new THREE.Vector3();
  const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  function pick(clientX, clientY, pl) {
    const r = canvas.getBoundingClientRect();
    ray.setFromCamera({ x: ((clientX - r.left) / r.width) * 2 - 1, y: -((clientY - r.top) / r.height) * 2 + 1 }, camera);
    if (!ray.ray.intersectPlane(pl, hit)) return { x: -1e9, y: -1e9 };
    const local = city.worldToLocal(hit.clone());
    return { x: local.x + H, y: local.z + H };
  }
  /** Mouse -> world metres on the overhead link layer (for link clicks). */
  const toWorld = (clientX, clientY) => pick(clientX, clientY, plane);
  /** Mouse -> world metres on the road surface (for route planning). */
  const toGround = (clientX, clientY) => pick(clientX, clientY, groundPlane);

  // ---------------- Per-frame draw ----------------
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), pos = new THREE.Vector3(), scl = new THREE.Vector3(1, 1, 1), up = new THREE.Vector3(0, 1, 0);
  const angLerp = (a, b, t) => { let d = b - a; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return a + d * t; };
  function trackYaw(store, id, car) {
    let e = store.get(id);
    if (!e) { const v = dirVec(car.heading); e = { x: car.x, y: car.y, yaw: yawOf(v.x, v.y), seen: 0 }; store.set(id, e); }
    const dx = car.x - e.x, dy = car.y - e.y;
    if (dx * dx + dy * dy > 0.09) { e.yaw = angLerp(e.yaw, yawOf(dx, dy), 0.5); e.x = car.x; e.y = car.y; }
    return e;
  }

  let frameNo = 0;
  function draw(s, { showMessages = false, hoverLink = null, time = 0, reducedMotion = false } = {}) {
    resize();
    if (!cssW || !s) return;
    frameNo++;

    // Lights.
    for (const j of s.junctions) {
      for (const d of DIRS) {
        const sig = signals[j.id][d], lit = j.lights === PHASE_OF[d];
        sig.green.material = lit ? lamp.greenOn : lamp.greenOff;
        sig.red.material = lit ? lamp.redOff : lamp.redOn;
        sig.halo.material = lit ? halos.go : halos.stop;
        sig.halo.position.y = lit ? GREEN_Y : RED_Y;
        sig.bar.visible = !lit; sig.arrow.visible = lit;
      }
      const o = orphans[j.id], pulse = reducedMotion ? 1 : 0.5 + 0.5 * Math.sin(time / 300);
      o.ring.visible = o.label.visible = !!j.orphaned;
      if (j.orphaned) o.ring.material.opacity = 0.3 + 0.7 * pulse;
    }

    // Planner targets pulse so the presenter can see where to click.
    if (targetGroup.children.length) targetMat.opacity = reducedMotion ? 0.8 : 0.45 + 0.45 * (0.5 + 0.5 * Math.sin(time / 220));

    // Links.
    for (const l of s.links) {
      const e = ensureLink(l.a, l.b);
      const kind = !l.up ? 'cut' : s.messaging === false ? 'off' : 'up';
      const hovered = hoverLink && hoverLink.a === l.a && hoverLink.b === l.b;
      e.mesh.material = hovered ? linkHoverMats[kind] : linkMats[kind];
      e.mesh.scale.y = e.mesh.scale.z = hovered ? 2.2 : kind === 'off' ? 0.6 : 1;
      e.x.visible = !l.up;
    }

    // Cars.
    let n = 0, ambCar = null;
    for (const car of s.cars) {
      if (car.isAmbulance) { ambCar = car; continue; }
      if (n >= MAX_CARS) continue;
      const e = trackYaw(yaws, car.id, car); e.seen = frameNo;
      pos.set(sx(car.x), 0, sz(car.y)); q.setFromAxisAngle(up, e.yaw);
      m4.compose(pos, q, scl);
      bodies.setMatrixAt(n, m4); cabs.setMatrixAt(n, m4);
      bodies.setColorAt(n, car.stopped ? colWait : colGo);
      n++;
    }
    bodies.count = cabs.count = n;
    bodies.instanceMatrix.needsUpdate = cabs.instanceMatrix.needsUpdate = true;
    if (bodies.instanceColor) bodies.instanceColor.needsUpdate = true;
    if (frameNo % 120 === 0) for (const [id, e] of yaws) if (frameNo - e.seen > 60) yaws.delete(id);

    // Ambulance.
    amb.visible = sirenRing.visible = !!ambCar;
    if (ambCar) {
      if (!ambPrev) { const v = dirVec(ambCar.heading); ambYaw = yawOf(v.x, v.y); ambPrev = { x: ambCar.x, y: ambCar.y }; }
      const dx = ambCar.x - ambPrev.x, dy = ambCar.y - ambPrev.y;
      if (dx * dx + dy * dy > 0.09) { ambYaw = angLerp(ambYaw, yawOf(dx, dy), 0.5); ambPrev = { x: ambCar.x, y: ambCar.y }; }
      amb.position.set(sx(ambCar.x), 0, sz(ambCar.y)); amb.rotation.y = ambYaw;
      sirenRing.position.set(sx(ambCar.x), 0.6, sz(ambCar.y));
      sirenLight.position.set(sx(ambCar.x), 8, sz(ambCar.y));
      const red = reducedMotion || Math.floor(time / 250) % 2 === 0;
      const mdl = models[kind], [ca, cb] = mdl.colors;
      mdl.a.material.color.set(red || reducedMotion ? ca : dimmed.set(ca).multiplyScalar(0.15));
      mdl.b.material.color.set(!red || reducedMotion ? cb : dimmed.set(cb).multiplyScalar(0.15));
      halo.material.color.set(red ? ca : cb);
      sirenLight.color.set(red ? ca : cb);
      sirenLight.intensity = 1800;
      if (follow && followFresh) setFollow(true);   // e.g. first dispatch after Reset: frame it close up
      if (follow) {                            // glide the camera along with this panel's em-vehicle
        amb.updateWorldMatrix(true, false); amb.getWorldPosition(ambAt); ambAt.y = 0;
        offset.copy(camera.position).sub(controls.target);
        controls.target.lerp(ambAt, reducedMotion ? 1 : FOLLOW_LERP);
        camera.position.copy(controls.target).add(offset);
        syncing = true; controls.update(); afterViewChange(); syncing = false;
      }
    } else { sirenLight.intensity = 0; ambPrev = null; }

    // Messages.
    let nd = 0, np = 0;
    if (showMessages && s.messages) {
      for (const m of s.messages) {
        const a = junctionPos(m.a), b = junctionPos(m.b), f = Math.min(1, m.age);
        const at = (t, k) => { pos.set(sx(a.x + (b.x - a.x) * t), LINK_Y + 1.5, sz(a.y + (b.y - a.y) * t)); m4.compose(pos, q.identity(), scl.setScalar(k)); return m4; };
        if (m.type === 'PRIORITY') {
          for (let i = 0; i <= 3 && np < MAX_MSG; i++) msgPri.setMatrixAt(np++, at(Math.max(0, f - 0.08 * i), 1 - i * 0.22));
        } else if (nd < MAX_MSG) msgData.setMatrixAt(nd++, at(f, 1));
      }
      scl.setScalar(1);
    }
    msgData.count = nd; msgPri.count = np;
    msgData.instanceMatrix.needsUpdate = msgPri.instanceMatrix.needsUpdate = true;

    renderer.render(scene, camera);
  }

  setCity(1);
  return {
    resize, draw, toWorld, toGround, setOrientation, setCity, getView, setView, resetView, setRoute, setTargets, setFollow, setVehicleKind,
    /** Called with the new view whenever the user moves this camera (used to keep panels in sync). */
    onViewChange(cb) { onView = cb; },
    get pxPerMetre() { return pxPerM; },
  };
}
