// Display layer: draws world snapshots and sends commands. No simulation logic lives here.
import { createWorld } from '../world/world.js';
import { createCentral } from '../controllers/central.js';
import { createFixed } from '../controllers/fixed.js';
import { createGreenwaveWorkers } from '../controllers/greenwave-workers.js';
import { canSpawnAmbulance, linkAt } from './demo-rules.js';
import { junctionPos, dirVec, DIRS, PHASE_OF, WORLD_SIZE } from '../world/grid.js';

const MAX_FRAME_S = 0.25;             // cap real time per sim step (hidden tab, slow laptop)
const SUB_S = 0.1;                    // world.tick limit
const CLICK_TOL_PX = 10;              // how close to a link a click must land
const SPEEDS = [1, 3, 5];
const PANEL_DEFS = [
  { key: 'central', label: 'Central', make: () => createCentral() },
  { key: 'fixed', label: 'Fixed (central failed)', make: () => createFixed() },
  { key: 'greenwave', label: 'Greenwave', make: speed => createGreenwaveWorkers({ speed }) },
];

const params = new URLSearchParams(location.search);
const seed = Number(params.get('seed')) || 42;
const $ = id => document.getElementById(id);

const ui = { view: 'grid', focus: 2, showMessages: false, messagesOn: true, speed: 3 };
let panels = [];
let pending = [];                     // commands applied to all worlds at the same sim time
let last = performance.now();

function build() {
  for (const p of panels) p.ctrl.terminate?.();
  panels = PANEL_DEFS.map(d => ({ key: d.key, label: d.label, ctrl: d.make(ui.speed), world: createWorld({ seed }) }));
  pending = [];
  last = performance.now();
  ui.messagesOn = true;
}

/** Queue a command; it runs on every panel's world at the start of the next sim step. */
const broadcast = fn => pending.push(fn);

// ---------------- Actions (shared by dock buttons and keyboard) ----------------
const actions = {
  failCentral() { broadcast(w => w.failCentral()); },
  spawnAmbulance() { if (canSpawnAmbulance(panels.map(p => p.world))) broadcast(w => w.spawnAmbulance()); },
  cutAll() { broadcast(w => w.cutAll()); },
  restoreAll() { broadcast(w => w.restoreAll()); },
  toggleMessages() {
    ui.messagesOn = !ui.messagesOn;
    const on = ui.messagesOn;
    broadcast((w, p) => { if (p.key === 'greenwave') w.setMessaging(on); });
  },
  toggleShowMessages() { ui.showMessages = !ui.showMessages; },
  toggleView() { setView(ui.view === 'grid' ? 'focus' : 'grid'); },
  setFocus(i) { ui.focus = i; setView('focus'); },
  speedDown() { setSpeed(SPEEDS[Math.max(0, SPEEDS.indexOf(ui.speed) - 1)]); },
  speedUp() { setSpeed(SPEEDS[Math.min(SPEEDS.length - 1, SPEEDS.indexOf(ui.speed) + 1)]); },
  reset() { build(); },
};

function setSpeed(s) {
  ui.speed = s;
  for (const p of panels) p.ctrl.setSpeed?.(s);
}

function setView(v) {
  ui.view = v;
  document.body.classList.toggle('view-grid', v === 'grid');
  document.body.classList.toggle('view-focus', v === 'focus');
  for (const b of document.querySelectorAll('.focus-tabs button')) b.classList.toggle('active', Number(b.dataset.focus) === ui.focus);
}

function cutOrRestore(link) {
  const { a, b, up } = link;
  broadcast(w => (up ? w.cutLink(a, b) : w.restoreLink(a, b)));
}

// Dock and header buttons.
for (const b of document.querySelectorAll('[data-action]')) {
  b.addEventListener('click', () => { actions[b.dataset.action](); b.blur(); });
}
for (const b of document.querySelectorAll('[data-focus]')) {
  b.addEventListener('click', () => { actions.setFocus(Number(b.dataset.focus)); b.blur(); });
}

// Keyboard shortcuts. Ignored while typing in a form field or with Ctrl/Alt/Meta held.
const KEYS = {
  f: 'failCentral', a: 'spawnAmbulance', c: 'cutAll', r: 'restoreAll',
  m: 'toggleMessages', o: 'toggleShowMessages', v: 'toggleView', '[': 'speedDown', ']': 'speedUp',
};
document.addEventListener('keydown', e => {
  if (e.ctrlKey || e.altKey || e.metaKey || e.repeat) return;
  if (document.activeElement?.matches('input, select, textarea')) return;
  const k = e.key.toLowerCase();
  if (k === 'r' && e.shiftKey) { actions.reset(); e.preventDefault(); return; }
  if (['1', '2', '3'].includes(e.key)) { actions.setFocus(Number(e.key) - 1); e.preventDefault(); return; }
  if (KEYS[k] && !e.shiftKey) { actions[KEYS[k]](); e.preventDefault(); }
});

// ---------------- Simulation loop (timer-driven, independent of frame rate) ----------------
function simStep() {
  const now = performance.now();
  let sim = Math.min((now - last) / 1000, MAX_FRAME_S) * ui.speed;
  last = now;
  for (const fn of pending) for (const p of panels) fn(p.world, p);
  pending = [];
  while (sim > 1e-9) {
    const dt = Math.min(SUB_S, sim);
    for (const p of panels) { p.ctrl.tick(p.world); p.world.tick(dt); }
    sim -= dt;
  }
}

// ---------------- Header ----------------
function setPill(el, text, cls) {
  if (el.textContent !== text) el.textContent = text;
  el.className = `pill ${cls}`;
}

function updateHeader(snaps) {
  $('clock').textContent = `t = ${panels[0].world.now.toFixed(1)} s`;
  $('speed-label').textContent = `${ui.speed}×`;
  const failed = panels[0].world.centralFailed;
  setPill($('pill-central'), failed ? 'CENTRAL: FAILED' : 'CENTRAL: ONLINE', failed ? 'bad' : '');
  const cut = snaps[0].links.filter(l => !l.up).length;
  setPill($('pill-links'), `LINKS CUT: ${cut}/24`, cut ? 'warn' : '');
  const on = panels[2].world.messaging;
  setPill($('pill-messages'), `GREENWAVE MESSAGES: ${on ? 'ON' : 'OFF'}`, on ? '' : 'bad');
  const btn = $('btn-messages');
  btn.firstChild.textContent = `Messages: ${on ? 'ON' : 'OFF'}`;
  btn.className = on ? 'on' : 'off';
  $('btn-show').className = ui.showMessages ? 'on' : '';
  $('view-toggle').firstChild.textContent = ui.view === 'grid' ? 'Focus view' : 'Grid view';
}

// ---------------- Temporary drawing (replaced by map-renderer.js in Task 3) ----------------
const gridCanvases = [...document.querySelectorAll('#grid-view canvas')];

function fitCanvas(canvas) {
  const size = Math.floor(Math.min(canvas.parentElement.clientWidth, canvas.parentElement.clientHeight));
  const dpr = window.devicePixelRatio || 1;
  if (canvas.width !== Math.round(size * dpr)) {
    canvas.width = canvas.height = Math.round(size * dpr);
    canvas.style.width = canvas.style.height = `${size}px`;
  }
  return { size, dpr };
}

function drawTemp(canvas, s) {
  const { size, dpr } = fitCanvas(canvas);
  const ctx = canvas.getContext('2d');
  const S = (size / WORLD_SIZE) * dpr;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(S, 0, 0, S, 0, 0);
  ctx.strokeStyle = '#1c2a44'; ctx.lineWidth = 14;
  for (let i = 0; i < 4; i++) {
    const { x, y } = junctionPos(i * 5);
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(WORLD_SIZE, y); ctx.moveTo(x, 0); ctx.lineTo(x, WORLD_SIZE); ctx.stroke();
  }
  for (const l of s.links) {
    const a = junctionPos(l.a), b = junctionPos(l.b);
    ctx.strokeStyle = l.up ? '#38bdf8' : '#ff5470'; ctx.lineWidth = l.up ? 1 : 3;
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
  }
  for (const j of s.junctions) {
    const c = junctionPos(j.id);
    for (const d of DIRS) {
      const v = dirVec(d);
      ctx.fillStyle = j.lights === PHASE_OF[d] ? '#3dffa8' : '#ff5470';
      ctx.fillRect(c.x + v.x * 10 - 3, c.y + v.y * 10 - 3, 6, 6);
    }
  }
  for (const car of s.cars) {
    ctx.fillStyle = car.isAmbulance ? '#ff3355' : car.stopped ? '#ffb547' : '#9fb3d1';
    ctx.beginPath(); ctx.arc(car.x, car.y, car.isAmbulance ? 7 : 3, 0, Math.PI * 2); ctx.fill();
  }
}

gridCanvases.forEach((canvas, i) => {
  canvas.addEventListener('click', e => {
    const r = canvas.getBoundingClientRect();
    const S = r.width / WORLD_SIZE;
    const link = linkAt((e.clientX - r.left) / S, (e.clientY - r.top) / S, panels[i].world.snapshot().links, CLICK_TOL_PX / S);
    if (link) cutOrRestore(link);
  });
});

function frame() {
  const snaps = panels.map(p => p.world.snapshot());
  if (ui.view === 'grid') snaps.forEach((s, i) => drawTemp(gridCanvases[i], s));
  updateHeader(snaps);
  requestAnimationFrame(frame);
}

build();
setView('grid');
setInterval(simStep, 16);
requestAnimationFrame(frame);
