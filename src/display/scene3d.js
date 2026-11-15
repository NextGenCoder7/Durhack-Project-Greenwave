// 3D view of one world snapshot (three.js). Drop-in for createMapRenderer: reads snapshots only.
import * as THREE from 'three';
import { junctionPos, dirVec, DIRS, PHASE_OF, WORLD_SIZE, N, SPACING, STUB, opposite, left } from '../world/grid.js';
import { mulberry32 } from '../world/rng.js';

const C = {
  bg: 0x0b1220, ground: 0x0d1626, block: 0x121c30, panel: 0x111b2e, road: 0x1c2a44, lane: 0x3a5280,
  go: 0x3dffa8, stop: 0xff5470, wait: 0xffb547, data: 0x38bdf8, siren: 0xff3355, sirenBlue: 0x4d7cff,
  car: 0x9fb3d1, off: 0x4a5a78, park: 0x10261f, tree: 0x1f6b4a, trunk: 0x3a2a1e,
};
const W = WORLD_SIZE, H = W / 2;
const ROAD_W = 16, PLATE = 22, SIREN_RANGE = 80;
const LINK_Y = 12;                    // links run overhead like fibre; picking intersects this plane
const FRAME_R = 300;                  // m: radius of the circle the camera keeps in frame
const ELEV = THREE.MathUtils.degToRad(62), FOV = 34;
const MAX_CARS = 500, MAX_MSG = 400;
const CAR = { L: 9, W: 4.2, H: 2.6 };  // exaggerated so cars read at panel size

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
  scene.fog = new THREE.Fog(C.bg, dist * 1.05, dist * 1.9);

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

  // ---------------- Static: traffic lights (poles, heads, stop bars) ----------------
  const lamp = { redOn: glowMat(C.stop), redOff: mat(0x3a1820), greenOn: glowMat(C.go), greenOff: mat(0x143428) };
  const barMat = { go: glowMat(C.go), stop: glowMat(C.stop) };
  const poleMat = mat(0x2a3650), headMat = mat(0x0a0f1a);
  const poleGeo = new THREE.CylinderGeometry(0.45, 0.45, 9, 6), headGeo = new THREE.BoxGeometry(1.6, 5, 1.6);
  const lampGeo = new THREE.SphereGeometry(0.9, 10, 8), barGeo = new THREE.BoxGeometry(1.4, 0.5, ROAD_W / 2 - 1);
  const signals = [];                          // [j][d] -> { red, green, bar }
  for (let j = 0; j < NJ; j++) {
    const p = junctionPos(j), row = {};
    for (const d of DIRS) {
      const v = dirVec(d), heading = opposite(d), l = dirVec(left(heading));
      const g = new THREE.Group();
      // Corner on the approaching driver's side (drive on the left), just before the stop line.
      const cx = p.x + v.x * (PLATE / 2 + 2) + l.x * (ROAD_W / 2 + 1.5), cy = p.y + v.y * (PLATE / 2 + 2) + l.y * (ROAD_W / 2 + 1.5);
      g.position.set(sx(cx), 0, sz(cy));
      const pole = new THREE.Mesh(poleGeo, poleMat); pole.position.y = 4.5; g.add(pole);
      const head = new THREE.Mesh(headGeo, headMat); head.position.y = 10.5; g.add(head);
      const red = new THREE.Mesh(lampGeo, lamp.redOff), green = new THREE.Mesh(lampGeo, lamp.greenOff);
      // Lamps face the approaching cars (towards side d).
      red.position.set(v.x * 0.9, 12, v.y * 0.9); green.position.set(v.x * 0.9, 9, v.y * 0.9);
      g.add(red, green); city.add(g);
      // Stop bar across the approach lane.
      const bar = new THREE.Mesh(barGeo, barMat.stop);
      const lane = ROAD_W / 4;
      bar.position.set(sx(p.x + v.x * (PLATE / 2 + 1) + l.x * lane), 0.35, sz(p.y + v.y * (PLATE / 2 + 1) + l.y * lane));
      bar.rotation.y = yawOf(v.x, v.y);
      city.add(bar);
      row[d] = { red, green, bar };
    }
    signals.push(row);
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

  // ---------------- Dynamic: ambulance ----------------
  const amb = new THREE.Group();
  const ambBody = new THREE.Mesh(new THREE.BoxGeometry(9, 3.6, 3.8), mat(0xf4f7ff)); ambBody.position.y = 2.2;
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(9.05, 0.7, 3.85), glowMat(C.siren)); stripe.position.y = 2.2;
  const barR = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.8, 1.6), glowMat(C.siren)); barR.position.set(1.5, 4.4, -0.9);
  const barB = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.8, 1.6), glowMat(C.sirenBlue)); barB.position.set(1.5, 4.4, 0.9);
  const halo = new THREE.Mesh(new THREE.SphereGeometry(9, 16, 12), glowMat(C.siren, { transparent: true, opacity: 0.22, depthWrite: false }));
  halo.position.y = 3;
  const sirenLight = new THREE.PointLight(C.siren, 0, 90, 1.5); sirenLight.position.y = 8;
  amb.add(ambBody, stripe, barR, barB, halo);
  city.add(sirenLight);                        // outside the (sometimes hidden) group: light count never changes
  amb.visible = false; city.add(amb);
  const sirenRing = new THREE.Mesh(new THREE.RingGeometry(SIREN_RANGE - 1.2, SIREN_RANGE, 72), glowMat(C.siren, { transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false }));
  sirenRing.rotation.x = -Math.PI / 2; sirenRing.visible = false; city.add(sirenRing);
  let ambYaw = 0, ambPrev = null;

  // ---------------- Dynamic: messages ----------------
  const msgData = new THREE.InstancedMesh(new THREE.SphereGeometry(1.6, 8, 6), glowMat(C.data), MAX_MSG);
  const msgPri = new THREE.InstancedMesh(new THREE.SphereGeometry(2.4, 10, 8), glowMat(C.siren, { transparent: true }), MAX_MSG);
  msgData.frustumCulled = msgPri.frustumCulled = false;
  msgData.count = msgPri.count = 0; city.add(msgData, msgPri);

  // ---------------- Sizing, orientation, picking ----------------
  let cssSize = 0, dpr = 1, pxPerM = 1;
  function measureScale() {
    const a = new THREE.Vector3(0, 0, 0).project(camera), b = new THREE.Vector3(10, 0, 0).project(camera);
    pxPerM = Math.max(0.05, (Math.abs(b.x - a.x) * cssSize) / 2 / 10);
  }
  function resize() {
    const box = canvas.parentElement;
    const size = Math.floor(Math.min(box.clientWidth, box.clientHeight));
    const d = Math.min(window.devicePixelRatio || 1, 2);
    if (size < 50) return;
    if (size === cssSize && d === dpr) return;
    cssSize = size; dpr = d;
    renderer.setPixelRatio(d); renderer.setSize(size, size);
    camera.aspect = 1; camera.updateProjectionMatrix();
    measureScale();
  }
  function setOrientation(yaw) { city.rotation.y = yaw; city.updateMatrixWorld(true); yaws.clear(); ambPrev = null; }

  const ray = new THREE.Raycaster(), plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -LINK_Y), hit = new THREE.Vector3();
  function toWorld(clientX, clientY) {
    const r = canvas.getBoundingClientRect();
    ray.setFromCamera({ x: ((clientX - r.left) / r.width) * 2 - 1, y: -((clientY - r.top) / r.height) * 2 + 1 }, camera);
    if (!ray.ray.intersectPlane(plane, hit)) return { x: -1e9, y: -1e9 };
    const local = city.worldToLocal(hit.clone());
    return { x: local.x + H, y: local.z + H };
  }

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
    if (!cssSize || !s) return;
    frameNo++;

    // Lights.
    for (const j of s.junctions) {
      for (const d of DIRS) {
        const sig = signals[j.id][d], lit = j.lights === PHASE_OF[d];
        sig.green.material = lit ? lamp.greenOn : lamp.greenOff;
        sig.red.material = lit ? lamp.redOff : lamp.redOn;
        sig.bar.material = lit ? barMat.go : barMat.stop;
      }
      const o = orphans[j.id], pulse = reducedMotion ? 1 : 0.5 + 0.5 * Math.sin(time / 300);
      o.ring.visible = o.label.visible = !!j.orphaned;
      if (j.orphaned) o.ring.material.opacity = 0.3 + 0.7 * pulse;
    }

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
      barR.material.color.setHex(red ? C.siren : 0x3a1820);
      barB.material.color.setHex(red ? 0x141c3a : C.sirenBlue);
      halo.material.color.setHex(red ? C.siren : C.sirenBlue);
      sirenLight.color.setHex(red ? C.siren : C.sirenBlue);
      sirenLight.intensity = 1800;
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
  return { resize, draw, toWorld, setOrientation, setCity, get pxPerMetre() { return pxPerM; } };
}
