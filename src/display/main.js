// Display layer: draws world snapshots and sends commands. No simulation logic lives here.
import { createWorld } from '../world/world.js';
import { createCentral } from '../controllers/central.js';
import { createFixed } from '../controllers/fixed.js';
import { createGreenwaveWorkers } from '../controllers/greenwave-workers.js';
import { canSpawnAmbulance } from './demo-rules.js';
import { junctionPos, dirVec, DIRS, PHASE_OF, WORLD_SIZE } from '../world/grid.js';

const PX = 420;                       // canvas size in CSS px
const S = PX / WORLD_SIZE;            // px per metre
const MAX_FRAME_S = 0.25;             // cap real time per frame (hidden tab, slow laptop)
const SUB_S = 0.1;                    // world.tick limit

const params = new URLSearchParams(location.search);
const seed = Number(params.get('seed')) || 42;
let speed = 3;
let panels = [];
let pending = [];                     // commands applied to all worlds at the same sim time
let last = performance.now();

const $ = id => document.getElementById(id);

function build() {
  for (const p of panels) p.ctrl.terminate?.();
  $('panels').innerHTML = '';
  const defs = [
    { label: 'Central', ctrl: createCentral() },
    { label: 'Fixed (central failed)', ctrl: createFixed() },
    { label: 'Greenwave', ctrl: createGreenwaveWorkers({ speed }) },
  ];
  panels = defs.map(d => {
    const el = document.createElement('div'); el.className = 'panel';
    const h = document.createElement('h2'); h.textContent = d.label;
    const stats = document.createElement('div'); stats.className = 'stats';
    const canvas = document.createElement('canvas');
    const dpr = window.devicePixelRatio || 1;
    canvas.width = PX * dpr; canvas.height = PX * dpr;
    canvas.style.width = canvas.style.height = `${PX}px`;
    const ctx = canvas.getContext('2d'); ctx.scale(dpr, dpr);
    canvas.addEventListener('click', e => onCanvasClick(e, canvas));
    el.append(h, stats, canvas); $('panels').append(el);
    return { ...d, world: createWorld({ seed }), stats, ctx };
  });
  pending = [];
  last = performance.now();
  $('gwmsgs').checked = true;   // new worlds start with messaging on
}

const broadcast = fn => pending.push(fn);

function onCanvasClick(e, canvas) {
  const r = canvas.getBoundingClientRect();
  const mx = (e.clientX - r.left) / S, my = (e.clientY - r.top) / S;
  let best = null, bestD = 12 / S;
  for (const l of panels[0].world.snapshot().links) {
    const a = junctionPos(l.a), b = junctionPos(l.b);
    const d = Math.hypot(mx - (a.x + b.x) / 2, my - (a.y + b.y) / 2);
    if (d < bestD) { bestD = d; best = l; }
  }
  if (!best) return;
  const { a, b, up } = best;
  broadcast(w => (up ? w.cutLink(a, b) : w.restoreLink(a, b)));
}

$('amb').onclick = () => {
  if (canSpawnAmbulance(panels.map(p => p.world))) broadcast(w => w.spawnAmbulance());
};
$('fail').onclick = () => broadcast(w => w.failCentral());
$('cutall').onclick = () => broadcast(w => w.cutAll());
$('restore').onclick = () => broadcast(w => w.restoreAll());
$('reset').onclick = () => build();
// Greenwave-only: switch neighbour cooperation off/on without touching links or the other panels.
$('gwmsgs').onchange = e => {
  const on = e.target.checked;
  pending.push((w, p) => { if (p.ctrl.name === 'greenwave') w.setMessaging(on); });
};
$('speed').onchange = e => { speed = Number(e.target.value); for (const p of panels) p.ctrl.setSpeed?.(speed); };

// Simulation runs on a timer (not tied to frame rate); drawing runs on animation frames.
function simStep() {
  const now = performance.now();
  let sim = Math.min((now - last) / 1000, MAX_FRAME_S) * speed;
  last = now;
  for (const fn of pending) for (const p of panels) fn(p.world, p);
  pending = [];
  while (sim > 1e-9) {
    const dt = Math.min(SUB_S, sim);
    for (const p of panels) { p.ctrl.tick(p.world); p.world.tick(dt); }
    sim -= dt;
  }
}

function frame() {
  for (const p of panels) draw(p);
  $('clock').textContent = `t = ${panels[0].world.now.toFixed(1)} s`;
  requestAnimationFrame(frame);
}

function fmtAmb(a) {
  if (a.state === 'none') return '—';
  return `${a.journey.toFixed(1)} s (stopped ${a.stopped.toFixed(1)} s)${a.state === 'arrived' ? ' ✓ arrived' : ' …'}`;
}

function draw(p) {
  const s = p.world.snapshot(), ctx = p.ctx, m = s.metrics;
  p.stats.textContent =
    (s.messaging ? '' : 'MESSAGES OFF: junctions use only their own sensors\n') +
    `Ambulance     ${fmtAmb(m.ambulance)}\n` +
    `Avg car wait  ${m.avgWait.toFixed(1)} s   (last 60 s: ${m.rollingWait.toFixed(1)} s)\n` +
    `Stops per car ${m.stopsPerCar.toFixed(2)}   (last 60 s: ${m.rollingStopsPerCar.toFixed(2)})\n` +
    `Throughput    ${m.throughputPerMin} cars/min   exited ${m.exited}\n` +
    `Conflicting greens  ${m.conflicts}`;

  ctx.clearRect(0, 0, PX, PX);
  ctx.save(); ctx.scale(S, S);

  // Roads (full rows/columns including stubs).
  ctx.strokeStyle = '#ddd'; ctx.lineWidth = 14;
  for (let i = 0; i < 4; i++) {
    const { x, y } = junctionPos(i * 5);   // diagonal junctions give each row/column coordinate
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(WORLD_SIZE, y); ctx.moveTo(x, 0); ctx.lineTo(x, WORLD_SIZE); ctx.stroke();
  }

  // Links between junctions.
  for (const l of s.links) {
    const a = junctionPos(l.a), b = junctionPos(l.b);
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
    if (l.up && !s.messaging) { ctx.setLineDash([2, 4]); ctx.strokeStyle = '#bbb'; ctx.lineWidth = 2; }
    else if (l.up) { ctx.setLineDash([]); ctx.strokeStyle = '#999'; ctx.lineWidth = 1; }
    else { ctx.setLineDash([6, 5]); ctx.strokeStyle = '#d00'; ctx.lineWidth = 4; }
    ctx.stroke();
  }
  ctx.setLineDash([]);

  // Message overlay (Task 9).
  if ($('msgs').checked && s.messages) {
    for (const msg of s.messages) {
      const a = junctionPos(msg.a), b = junctionPos(msg.b), f = Math.min(1, msg.age);
      const x = a.x + (b.x - a.x) * f, y = a.y + (b.y - a.y) * f;
      ctx.fillStyle = msg.type === 'PRIORITY' ? '#e00' : '#06f';
      ctx.beginPath(); ctx.arc(x, y, msg.type === 'PRIORITY' ? 5 : 3, 0, Math.PI * 2); ctx.fill();
    }
  }

  // Junctions: stop-line ticks per approach, orphaned outline.
  for (const j of s.junctions) {
    const c = junctionPos(j.id);
    for (const d of DIRS) {
      const v = dirVec(d), px = -v.y, py = v.x;
      const cx = c.x + v.x * 10, cy = c.y + v.y * 10;
      ctx.strokeStyle = j.lights === PHASE_OF[d] ? '#0a0' : '#d00'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(cx - px * 6, cy - py * 6); ctx.lineTo(cx + px * 6, cy + py * 6); ctx.stroke();
    }
    if (j.orphaned) { ctx.strokeStyle = '#f80'; ctx.lineWidth = 2; ctx.strokeRect(c.x - 14, c.y - 14, 28, 28); }
  }

  // Cars.
  for (const car of s.cars) {
    ctx.fillStyle = car.isAmbulance ? '#e00' : '#333';
    ctx.beginPath(); ctx.arc(car.x, car.y, car.isAmbulance ? 7 : 3, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}

build();
setInterval(simStep, 16);
requestAnimationFrame(frame);
