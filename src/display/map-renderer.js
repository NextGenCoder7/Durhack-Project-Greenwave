// Draws one world snapshot onto one canvas in the control-room style. Reads snapshots only.
import { junctionPos, dirVec, DIRS, PHASE_OF, WORLD_SIZE, N, SPACING, STUB } from '../world/grid.js';

const C = {
  bg: '#0b1220', panel: '#111b2e', border: '#1f2d47', road: '#1c2a44', lane: '#2a3d61',
  text: '#e6f0ff', muted: '#8ea3c4', go: '#3dffa8', stop: '#ff5470', wait: '#ffb547',
  data: '#38bdf8', siren: '#ff3355', sirenBlue: '#4d7cff', car: '#9fb3d1', off: '#4a5a78',
  msgCar: '#ffe14d', msgEmv: '#ff3df0', route: '#c77dff',
};
const ROAD_W = 16;        // m
const PLATE = 22;         // m, junction plate
const SIREN_RANGE = 80;   // m, matches the world's siren detection range

export function createMapRenderer(canvas) {
  const ctx = canvas.getContext('2d');
  const staticLayer = document.createElement('canvas');
  let cssSize = 0, dpr = 1, pxPerM = 1;

  /** Size the canvas to its container (square), at device-pixel resolution. */
  function resize() {
    const box = canvas.parentElement;
    const size = Math.floor(Math.min(box.clientWidth, box.clientHeight));
    const d = window.devicePixelRatio || 1;
    if (size < 50) return;                                   // hidden or collapsed: keep last size
    if (size === cssSize && d === dpr) return;
    cssSize = size; dpr = d; pxPerM = size / WORLD_SIZE;
    canvas.style.width = canvas.style.height = `${size}px`;
    canvas.width = canvas.height = Math.round(size * dpr);
    buildStatic();
  }

  const px = n => n / pxPerM;                                 // CSS pixels -> metres (drawing units)

  function buildStatic() {
    staticLayer.width = staticLayer.height = canvas.width;
    const g = staticLayer.getContext('2d');
    g.setTransform(pxPerM * dpr, 0, 0, pxPerM * dpr, 0, 0);
    g.clearRect(0, 0, WORLD_SIZE, WORLD_SIZE);
    // Roads: every row and column runs edge to edge.
    for (let i = 0; i < N; i++) {
      const at = STUB + i * SPACING;
      g.fillStyle = C.road;
      g.fillRect(0, at - ROAD_W / 2, WORLD_SIZE, ROAD_W);
      g.fillRect(at - ROAD_W / 2, 0, ROAD_W, WORLD_SIZE);
    }
    // Lane centre lines.
    g.strokeStyle = C.lane; g.lineWidth = px(1); g.setLineDash([4, 5]);
    for (let i = 0; i < N; i++) {
      const at = STUB + i * SPACING;
      g.beginPath(); g.moveTo(0, at); g.lineTo(WORLD_SIZE, at); g.moveTo(at, 0); g.lineTo(at, WORLD_SIZE); g.stroke();
    }
    g.setLineDash([]);
  }

  /** Client (mouse) coordinates -> world metres, using the current on-screen size. */
  function toWorld(clientX, clientY) {
    const r = canvas.getBoundingClientRect();
    return { x: ((clientX - r.left) * WORLD_SIZE) / r.width, y: ((clientY - r.top) * WORLD_SIZE) / r.height };
  }

  function glow(color, blurPx) { ctx.shadowColor = color; ctx.shadowBlur = blurPx * dpr; }
  function noGlow() { ctx.shadowBlur = 0; }

  function draw(s, { showMessages = false, hoverLink = null, time = 0, reducedMotion = false } = {}) {
    resize();                                                // cheap no-op unless size or DPR changed (e.g. moved to a projector)
    if (!cssSize) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(staticLayer, 0, 0);
    ctx.setTransform(pxPerM * dpr, 0, 0, pxPerM * dpr, 0, 0);
    ctx.lineCap = 'round';

    // 1. Comms links.
    for (const l of s.links) {
      const a = junctionPos(l.a), b = junctionPos(l.b);
      const hovered = hoverLink && hoverLink.a === l.a && hoverLink.b === l.b;
      ctx.globalAlpha = hovered ? 1 : 0.85;
      if (!l.up) { ctx.strokeStyle = C.stop; ctx.lineWidth = px(hovered ? 5 : 3); ctx.setLineDash([px(8), px(6)]); }
      else if (s.messaging === false) { ctx.strokeStyle = C.off; ctx.lineWidth = px(hovered ? 3 : 1.5); ctx.setLineDash([px(2), px(5)]); }
      else { ctx.strokeStyle = C.data; ctx.lineWidth = px(hovered ? 3 : 1.5); ctx.setLineDash([]); }
      if (hovered) glow(ctx.strokeStyle, 8);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      noGlow(); ctx.setLineDash([]);
      if (!l.up) {                                            // ✕ at the midpoint
        const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2, k = px(6);
        ctx.lineWidth = px(2.5);
        ctx.beginPath(); ctx.moveTo(mx - k, my - k); ctx.lineTo(mx + k, my + k); ctx.moveTo(mx + k, my - k); ctx.lineTo(mx - k, my + k); ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;

    // 2. Junction plates, signals, orphaned outline.
    const pulse = reducedMotion ? 1 : 0.5 + 0.5 * Math.sin(time / 300);
    for (const j of s.junctions) {
      const c = junctionPos(j.id);
      ctx.fillStyle = C.panel; ctx.strokeStyle = C.border; ctx.lineWidth = px(1);
      roundRect(c.x - PLATE / 2, c.y - PLATE / 2, PLATE, PLATE, 4); ctx.fill(); ctx.stroke();
      for (const d of DIRS) {
        const v = dirVec(d), pxv = -v.y, pyv = v.x;           // bar runs across the approach road
        const cx = c.x + v.x * (PLATE / 2 + 2), cy = c.y + v.y * (PLATE / 2 + 2);
        const lit = j.lights === PHASE_OF[d];
        const half = lit ? 7 : 3;
        ctx.strokeStyle = lit ? C.go : C.stop; ctx.lineWidth = lit ? px(3.5) : px(2.5);
        if (lit) glow(C.go, 10);
        ctx.beginPath(); ctx.moveTo(cx - pxv * half, cy - pyv * half); ctx.lineTo(cx + pxv * half, cy + pyv * half); ctx.stroke();
        noGlow();
      }
      if (j.orphaned) {
        ctx.globalAlpha = pulse; ctx.strokeStyle = C.wait; ctx.lineWidth = px(2);
        roundRect(c.x - PLATE / 2 - 5, c.y - PLATE / 2 - 5, PLATE + 10, PLATE + 10, 6); ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.fillStyle = C.wait; ctx.font = `${px(9)}px Bahnschrift, "Segoe UI", sans-serif`; ctx.textAlign = 'center';
        ctx.fillText('TIMER', c.x, c.y - PLATE / 2 - px(8));
      }
    }

    // 3. Messages travelling along links.
    if (showMessages && s.messages) {
      for (const m of s.messages) {
        const a = junctionPos(m.a), b = junctionPos(m.b);
        const at = f => ({ x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f });
        const f = Math.min(1, m.age);
        if (m.type === 'PRIORITY') {
          for (let i = 3; i >= 1; i--) {
            const p = at(Math.max(0, f - 0.08 * i));
            ctx.globalAlpha = 0.25 * (4 - i) / 3; ctx.fillStyle = C.msgEmv;
            ctx.beginPath(); ctx.arc(p.x, p.y, 4, 0, Math.PI * 2); ctx.fill();
          }
          ctx.globalAlpha = 1; glow(C.msgEmv, 10); ctx.fillStyle = C.msgEmv;
          const p = at(f); ctx.beginPath(); ctx.arc(p.x, p.y, 5, 0, Math.PI * 2); ctx.fill(); noGlow();
        } else {
          ctx.fillStyle = C.msgCar; const p = at(f);
          ctx.beginPath(); ctx.arc(p.x, p.y, 3, 0, Math.PI * 2); ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
    }

    // 4. Em-vehicle route (planned or dispatched) and planner targets.
    if (route && route.pts.length > 1) {
      const { pts, dim, finished } = route;
      ctx.globalAlpha = dim ? 0.35 : 0.9; ctx.strokeStyle = C.route; ctx.lineWidth = px(5); ctx.lineJoin = 'round';
      if (!dim) glow(C.route, 10);
      ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y); for (const p of pts.slice(1)) ctx.lineTo(p.x, p.y); ctx.stroke();
      noGlow(); ctx.globalAlpha = 1;
      const mid = (p, q) => ({ x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 });
      const dot = (p, col) => { ctx.fillStyle = col; ctx.beginPath(); ctx.arc(p.x, p.y, 6, 0, Math.PI * 2); ctx.fill(); };
      dot(mid(pts[0], pts[1]), C.go);
      if (finished) dot(mid(pts[pts.length - 1], pts[pts.length - 2]), C.stop);
    }
    if (targets && targets.length) {
      ctx.globalAlpha = reducedMotion ? 0.8 : 0.45 + 0.45 * (0.5 + 0.5 * Math.sin(time / 220));
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = px(2.5);
      for (const t of targets) { ctx.beginPath(); ctx.arc(t.x, t.y, 14, 0, Math.PI * 2); ctx.stroke(); }
      ctx.globalAlpha = 1;
    }

    // 5. Cars (ambulance last, on top).
    let amb = null;
    for (const car of s.cars) {
      if (car.isAmbulance) { amb = car; continue; }
      ctx.fillStyle = car.stopped ? C.wait : C.car;
      ctx.beginPath(); ctx.arc(car.x, car.y, 3, 0, Math.PI * 2); ctx.fill();
    }
    if (amb) {
      ctx.globalAlpha = 0.35; ctx.strokeStyle = C.siren; ctx.lineWidth = px(1.2); ctx.setLineDash([px(5), px(5)]);
      ctx.beginPath(); ctx.arc(amb.x, amb.y, SIREN_RANGE, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]); ctx.globalAlpha = 1;
      const halo = reducedMotion || Math.floor(time / 250) % 2 === 0 ? C.siren : C.sirenBlue;
      glow(halo, 16); ctx.fillStyle = halo; ctx.globalAlpha = 0.55;
      ctx.beginPath(); ctx.arc(amb.x, amb.y, 12, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1; noGlow();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.arc(amb.x, amb.y, 5, 0, Math.PI * 2); ctx.fill();
    }
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }

  let route = null, targets = null;
  /** Em-vehicle route polyline in world metres (or null); dim = already dispatched. Same contract as the 3D view. */
  function setRoute(pts, { dim = false, finished = true } = {}) { route = pts && pts.length > 1 ? { pts, dim, finished } : null; }
  /** Clickable planner targets in world metres, or null. They pulse in draw(). */
  function setTargets(pts) { targets = pts; }

  return { resize, draw, toWorld, setRoute, setTargets, get pxPerMetre() { return pxPerM; } };
}
