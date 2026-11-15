// Display layer: draws world snapshots and sends commands. No simulation logic lives here.
import { createWorld } from '../world/world.js';
import { createCentral } from '../controllers/central.js';
import { createFixed } from '../controllers/fixed.js';
import { createGreenwaveWorkers } from '../controllers/greenwave-workers.js';
import { canSpawnAmbulance, linkAt, detectEvents } from './demo-rules.js';
import { showToast } from './toasts.js';
import { createMapRenderer } from './map-renderer.js';
import { createScene3D } from './scene3d.js';
import { mulberry32 } from '../world/rng.js';
import { AMBULANCE, randomAmbulanceTrip } from '../world/schedule.js';
import { renderScoreboard, renderStatStrips } from './scoreboard.js';

const MAX_FRAME_S = 0.25;             // cap real time per sim step (hidden tab, slow laptop)
const SUB_S = 0.1;                    // world.tick limit
const CLICK_TOL_PX = 10;              // how close to a link a click must land
const SPEEDS = [1, 3, 5];
const TAB_LABELS = ['Central', 'Fixed', 'Greenwave'];
const PANEL_DEFS = [
  { key: 'central', label: 'Central', make: () => createCentral() },
  { key: 'fixed', label: 'Fixed (central failed)', make: () => createFixed() },
  { key: 'greenwave', label: 'Greenwave', make: speed => createGreenwaveWorkers({ speed }) },
];

const params = new URLSearchParams(location.search);
// ?seed=N pins traffic, city and orientation (and keeps the rehearsed default ambulance route).
// Without it, every load and every Reset draws a fresh seed, and each ambulance takes a random route.
const pinnedSeed = Number(params.get('seed')) || null;
const use2d = params.get('2d') === '1';
const randomSeed = () => 1 + Math.floor(Math.random() * 99999);
let seed = pinnedSeed ?? randomSeed();
const $ = id => document.getElementById(id);

const ui = { view: 'grid', focus: 2, showMessages: false, messagesOn: true, speed: 3 };
let panels = [];
let arrivals = [];                    // this ambulance's arrivals so far, in arrival order
let prevAmb = null;                   // last frame's ambulance states, for arrival toasts
const toast = (text, kind) => showToast(text, { kind, reducedMotion });
let pending = [];                     // commands applied to all worlds at the same sim time
let last = performance.now();

function build() {
  for (const p of panels) p.ctrl.terminate?.();
  seed = pinnedSeed ?? randomSeed();
  const yaw = mulberry32(seed * 7919 + 1)() * Math.PI * 2;
  for (const m of allMaps) { m.renderer.setCity?.(seed); m.renderer.setOrientation?.(yaw); }
  panels = PANEL_DEFS.map(d => ({ key: d.key, label: d.label, ctrl: d.make(ui.speed), world: createWorld({ seed }) }));
  pending = [];
  last = performance.now();
  ui.messagesOn = true;
}

/** Queue a command; it runs on every panel's world at the start of the next sim step. */
const broadcast = fn => pending.push(fn);

// ---------------- Actions (shared by dock buttons and keyboard) ----------------
const actions = {
  failCentral() { broadcast(w => w.failCentral()); toast('Central controller failed', 'stop'); },
  spawnAmbulance() {
    if (!canSpawnAmbulance(panels.map(p => p.world.snapshot()))) { toast('Ambulance already en route', 'data'); return; }
    const trip = pinnedSeed ? AMBULANCE : randomAmbulanceTrip(mulberry32(Math.floor(Math.random() * 2 ** 32)));
    broadcast(w => w.spawnAmbulance(trip));
    arrivals = [];
    toast('Ambulance dispatched', 'data');
  },
  cutAll() { broadcast(w => w.cutAll()); toast('All links cut', 'stop'); },
  restoreAll() { broadcast(w => w.restoreAll()); toast('All links restored', 'go'); },
  toggleMessages() {
    ui.messagesOn = !ui.messagesOn;
    const on = ui.messagesOn;
    broadcast((w, p) => { if (p.key === 'greenwave') w.setMessaging(on); });
    toast(`Greenwave messages ${on ? 'ON' : 'OFF'}`, on ? 'go' : 'stop');
  },
  toggleShowMessages() { ui.showMessages = !ui.showMessages; },
  toggleView() { setView(ui.view === 'grid' ? 'focus' : 'grid'); },
  setFocus(i) { ui.focus = i; setView('focus'); },
  speedDown() { setSpeed(SPEEDS[Math.max(0, SPEEDS.indexOf(ui.speed) - 1)]); },
  speedUp() { setSpeed(SPEEDS[Math.min(SPEEDS.length - 1, SPEEDS.indexOf(ui.speed) + 1)]); },
  reset() { build(); prevAmb = null; arrivals = []; toast('Simulation reset', 'data'); },
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
  toast(`Link ${a}–${b} ${up ? 'cut' : 'restored'}`, up ? 'stop' : 'go');
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
  $('clock').textContent = `t = ${snaps[0].t.toFixed(1)} s`;
  $('speed-label').textContent = `${ui.speed}×`;
  $('seed-label').textContent = `seed ${seed}`;
  const failed = snaps[0].centralFailed;
  setPill($('pill-central'), failed ? 'CENTRAL: FAILED' : 'CENTRAL: ONLINE', failed ? 'bad' : '');
  const cut = snaps[0].links.filter(l => !l.up).length;
  setPill($('pill-links'), `LINKS CUT: ${cut}/24`, cut ? 'warn' : '');
  const on = snaps[2].messaging;
  setPill($('pill-messages'), `GREENWAVE MESSAGES: ${on ? 'ON' : 'OFF'}`, on ? '' : 'bad');
  const btn = $('btn-messages');
  btn.firstChild.textContent = `Messages: ${on ? 'ON' : 'OFF'}`;
  btn.className = on ? 'on' : 'off';
  $('btn-show').className = ui.showMessages ? 'on' : '';
  $('view-toggle').firstChild.textContent = ui.view === 'grid' ? 'Focus view' : 'Grid view';
}

// ---------------- Maps ----------------
const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
let reducedMotion = reducedMotionQuery.matches;
reducedMotionQuery.addEventListener('change', e => { reducedMotion = e.matches; });

// 3D by default; the 2D control-room renderer is the fallback (?2d=1, or no WebGL).
const makeRenderer = canvas => (!use2d && createScene3D(canvas)) || createMapRenderer(canvas);
const gridMaps = [...document.querySelectorAll('#grid-view canvas')].map((canvas, i) => ({ canvas, renderer: makeRenderer(canvas), panelIndex: () => i }));
const focusCanvas = document.getElementById('focus-canvas');
const focusMap = { canvas: focusCanvas, renderer: makeRenderer(focusCanvas), panelIndex: () => ui.focus };
const allMaps = [...gridMaps, focusMap];
const strips = [...document.querySelectorAll('#grid-view .stat-strip')];
let lastSnaps = [];
let hover = null;                    // { canvas, link } for the link under the cursor

function linkUnder(map, e) {
  const s = lastSnaps[map.panelIndex()];
  if (!s) return null;
  const { x, y } = map.renderer.toWorld(e.clientX, e.clientY);
  return linkAt(x, y, s.links, CLICK_TOL_PX / map.renderer.pxPerMetre);
}

// Moving one 3D camera moves them all, so the three panels stay directly comparable.
for (const map of allMaps) {
  map.renderer.onViewChange?.(view => { for (const m of allMaps) if (m !== map) m.renderer.setView(view); });
}

const DRAG_PX = 5;                   // a press that moves further than this is a camera drag, not a link click
for (const map of allMaps) {
  let down = null;
  map.canvas.addEventListener('pointerdown', e => { down = { x: e.clientX, y: e.clientY }; });
  const wasDrag = e => down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > DRAG_PX;
  map.canvas.addEventListener('mousemove', e => {
    const link = linkUnder(map, e);
    hover = link ? { canvas: map.canvas, link } : null;
    map.canvas.style.cursor = link ? 'pointer' : 'default';
  });
  map.canvas.addEventListener('mouseleave', () => { if (hover?.canvas === map.canvas) hover = null; });
  map.canvas.addEventListener('click', e => { if (wasDrag(e)) return; const link = linkUnder(map, e); if (link) cutOrRestore(link); });
  map.canvas.addEventListener('contextmenu', e => e.preventDefault());   // right drag pans
  new ResizeObserver(() => map.renderer.resize()).observe(map.canvas.parentElement);
}

function drawMap(map, time) {
  map.renderer.draw(lastSnaps[map.panelIndex()], {
    showMessages: ui.showMessages,
    hoverLink: hover?.canvas === map.canvas ? hover.link : null,
    time,
    reducedMotion,
  });
}

function frame(time) {
  lastSnaps = panels.map(p => p.world.snapshot());   // one snapshot per world per frame
  const nowAmb = lastSnaps.map((s, i) => ({ label: TAB_LABELS[i], ...s.metrics.ambulance }));
  for (const ev of detectEvents(prevAmb, nowAmb)) {
    arrivals.push(`${ev.label} ${ev.journey.toFixed(1)} s`);
    toast(`Ambulance arrived: ${arrivals.join(' · ')}`, 'go');
  }
  prevAmb = nowAmb;
  if (ui.view === 'grid') {
    for (const m of gridMaps) drawMap(m, time);
    renderStatStrips(strips, lastSnaps);
  } else {
    drawMap(focusMap, time);
    renderScoreboard(document.getElementById('scoreboard'), lastSnaps, TAB_LABELS);
  }
  updateHeader(lastSnaps);
  requestAnimationFrame(frame);
}

build();
setView('grid');
setInterval(simStep, 16);
requestAnimationFrame(frame);
