// Display layer: draws world snapshots and sends commands. No simulation logic lives here.
import { createWorld } from '../world/world.js';
import { createCentral } from '../controllers/central.js';
import { createFixed } from '../controllers/fixed.js';
import { createGreenwaveWorkers } from '../controllers/greenwave-workers.js';
import { canSpawnAmbulance, linkAt, detectEvents, bestIndex } from './demo-rules.js';
import { showToast } from './toasts.js';
import { createMapRenderer } from './map-renderer.js';
import { createScene3D } from './scene3d.js';
import { mulberry32 } from '../world/rng.js';
import { AMBULANCE, randomAmbulanceTrip } from '../world/schedule.js';
import { renderScoreboard, renderStatStrips } from './scoreboard.js';
import { createPlanner } from './route-planner.js';

const MAX_FRAME_S = 0.25;             // cap real time per sim step (hidden tab, slow laptop)
const SUB_S = 0.1;                    // world.tick limit
const CLICK_TOL_PX = 10;              // how close to a link a click must land
const SPEEDS = [1, 3, 5];
const TAB_LABELS = ['Central', 'Fixed', 'Greenwave'];
// "?" explainers, one per board.
const HELP = {
  central: {
    title: 'Central',
    text: 'One central computer runs all 16 junctions. It sees every car and knows exactly where the em-vehicle is going, so it turns lights green just ahead of it. It is the best case, but fragile: it reaches the junctions over the network links, so any junction it cannot reach (or every junction, if central fails) drops to a plain timer, shown by an amber TIMER ring.',
  },
  fixed: {
    title: 'Fixed (central failed)',
    text: 'What a city falls back to when its central computer fails. Every junction runs the same timer: 30 s green one way, 30 s green the other, with a short all-red between. It ignores traffic and the em-vehicle, so the em-vehicle often waits at red lights.',
  },
  greenwave: {
    title: 'Greenwave',
    text: 'Our system. There is no central computer: each junction decides for itself, using its own sensors and short messages from the junctions next to it ("cars coming", "em-vehicle coming"). The em-vehicle warning hops from junction to junction ahead of it. If links are cut, each junction still hears the siren from 80 m away and turns green.',
  },
};
// Em-vehicle (emergency vehicle) models, picked at random per dispatch. Visual only.
const VEHICLES = [{ kind: 'ambulance', name: 'ambulance' }, { kind: 'fire', name: 'fire engine' }, { kind: 'police', name: 'police car' }];
const PANEL_DEFS = [
  { key: 'central', label: 'Central', make: () => createCentral() },
  { key: 'fixed', label: 'Fixed (central failed)', make: () => createFixed() },
  { key: 'greenwave', label: 'Greenwave', make: speed => createGreenwaveWorkers({ speed }) },
];

const params = new URLSearchParams(location.search);
// ?seed=N pins traffic, city and orientation, and preloads the rehearsed ambulance route as the planned route.
// Without it, every load and every Reset draws a fresh seed. The ambulance route is chosen in the setup card
// before each run: Random (a new route per dispatch) or planned by clicking on the map.
const pinnedSeed = Number(params.get('seed')) || null;
const use2d = params.get('2d') === '1';
const randomSeed = () => 1 + Math.floor(Math.random() * 99999);
let seed = pinnedSeed ?? randomSeed();
const $ = id => document.getElementById(id);

const ui = { view: 'grid', focus: 2, showMessages: false, messagesOn: true, speed: 3, setup: true, routeMode: pinnedSeed ? 'custom' : 'random', follow: false, finished: false };
const planner = createPlanner();
if (pinnedSeed) planner.load(AMBULANCE);
let activeTrip = null;                // the trip of the ambulance currently (or last) dispatched
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
  for (const m of allMaps) for (const r of m.renderers) { r.setCity?.(seed); r.setOrientation?.(yaw); }
  panels = PANEL_DEFS.map(d => ({ key: d.key, label: d.label, ctrl: d.make(ui.speed), world: createWorld({ seed }) }));
  pending = [];
  last = performance.now();
  ui.messagesOn = true;
  activeTrip = null;
  hideFinish();
  enterSetup();
}

// ---------------- Finish: every panel's ambulance has arrived ----------------
function showFinish(amb) {
  ui.finished = true;
  const fastest = amb[bestIndex(amb.map(a => a.journey))].journey.toFixed(1);   // ties all count as fastest
  $('finish-times').replaceChildren(...amb.map(a => {
    const el = document.createElement('div');
    el.className = `finish-time${a.journey.toFixed(1) === fastest ? ' best' : ''}`;
    el.innerHTML = `<small></small><b class="num"></b>`;
    el.querySelector('small').textContent = a.label;
    el.querySelector('b').textContent = `${a.journey.toFixed(1)} s`;
    return el;
  }));
  document.body.classList.add('finished');
}
function hideFinish() { ui.finished = false; document.body.classList.remove('finished'); }

// ---------------- 3D camera: recentre and ambulance view ----------------
function setFollow(on) {
  ui.follow = on;
  for (const m of allMaps) for (const r of m.renderers) r.setFollow?.(on);
}

// ---------------- Setup: choose the ambulance route, then start ----------------
function enterSetup() { ui.setup = true; hideHelp(); renderSetup(); }
function setRouteMode(mode) { ui.routeMode = mode; renderSetup(); }
function renderSetup() {
  document.body.classList.toggle('setup', ui.setup);
  for (const b of document.querySelectorAll('[data-route]')) b.classList.toggle('active', b.dataset.route === ui.routeMode);
  const custom = ui.routeMode === 'custom';
  $('setup-status').textContent = custom
    ? planner.describe()
    : 'Each em-vehicle takes a new random route across the city';
  $('setup-edit').hidden = !custom;
  $('btn-start').disabled = custom && !planner.started;
  $('dispatch-mode').textContent = custom ? 'planned route' : 'random route';
  // While the route is being chosen, the setup card is the only thing that can be pressed.
  for (const b of document.querySelectorAll('button')) if (!$('setup').contains(b) && !$('finish').contains(b)) b.disabled = ui.setup;
}

/** The trip for the next dispatch, per the chosen mode. */
function nextTrip() {
  if (ui.routeMode === 'custom' && planner.started) return planner.trip();
  return randomAmbulanceTrip(mulberry32(Math.floor(Math.random() * 2 ** 32)));
}

/** Queue a command; it runs on every panel's world at the start of the next sim step. */
const broadcast = fn => pending.push(fn);

// ---------------- Actions (shared by dock buttons and keyboard) ----------------
const actions = {
  failCentral() { broadcast(w => w.failCentral()); toast('Central controller failed', 'stop'); },
  spawnAmbulance() {
    if (ui.setup) { toast('Start the simulation first (Enter)', 'data'); return; }
    if (!canSpawnAmbulance(panels.map(p => p.world.snapshot()))) { toast('Em-vehicle already en route', 'data'); return; }
    hideFinish();
    const trip = nextTrip();
    activeTrip = trip;
    broadcast(w => w.spawnAmbulance(trip));
    const v = VEHICLES[Math.floor(Math.random() * VEHICLES.length)];   // looks only: same physics for all three
    for (const m of allMaps) for (const r of m.renderers) r.setVehicleKind?.(v.kind);
    arrivals = [];
    toast(`Em-vehicle dispatched: ${v.name} (${ui.routeMode === 'custom' ? 'planned' : 'random'} route)`, 'data');
  },
  start() {
    if (!ui.setup) return;
    if (ui.routeMode === 'custom') {
      if (!planner.started) { toast('Click the road where the em-vehicle enters first', 'data'); return; }
      if (!planner.done) toast('Route continues straight on to the edge', 'data');
    }
    ui.setup = false; last = performance.now(); renderSetup();
    toast('Simulation started — press A to dispatch the em-vehicle', 'go');
  },
  runAgain() { actions.reset(); },
  dismissFinish() { hideFinish(); },
  recentre() {
    setFollow(false);
    for (const m of allMaps) for (const r of m.renderers) r.resetView?.();
  },
  toggleFollow() {
    if (ui.render !== '3d') { toast('Em-vehicle view is a 3D camera: switch to 3D first (D)', 'data'); return; }
    setFollow(!ui.follow);
    if (ui.follow && !lastSnaps.some(s => s.metrics.ambulance.state === 'driving')) toast('Em-vehicle view: follows the next em-vehicle you dispatch (A)', 'data');
    else toast(`Em-vehicle view ${ui.follow ? 'on' : 'off'}`, 'data');
  },
  routeRandom() { setRouteMode('random'); },
  routeCustom() { setRouteMode('custom'); },
  routeUndo() { planner.undo(); renderSetup(); },
  routeClear() { planner.clear(); renderSetup(); },
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
  toggleRender() {
    if (!has3d) { toast('3D view needs WebGL, which this browser does not offer', 'data'); return; }
    setRender(ui.render === '3d' ? '2d' : '3d');
    toast(`${ui.render.toUpperCase()} view`, 'data');
  },
  setFocus(i) { ui.focus = i; hideHelp(); setView('focus'); },
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

// ---------------- "?" explainers ----------------
const helpPop = $('help-pop');
let helpOpen = null;                  // { btn, pinned } while a popover is showing
const helpKey = btn => (btn.dataset.help === 'focus' ? PANEL_DEFS[ui.focus].key : btn.dataset.help);
function showHelp(btn, pinned) {
  const h = HELP[helpKey(btn)];
  $('help-title').textContent = h.title; $('help-text').textContent = h.text;
  helpPop.hidden = false;
  const r = btn.getBoundingClientRect(), w = helpPop.offsetWidth;
  helpPop.style.top = `${r.bottom + 8}px`;
  helpPop.style.left = `${Math.max(16, Math.min(window.innerWidth - w - 16, r.right - w))}px`;
  if (helpOpen && helpOpen.btn !== btn) helpOpen.btn.setAttribute('aria-expanded', 'false');
  btn.setAttribute('aria-expanded', 'true');
  helpOpen = { btn, pinned };
}
function hideHelp() {
  if (!helpOpen) return;
  helpOpen.btn.setAttribute('aria-expanded', 'false');
  helpPop.hidden = true; helpOpen = null;
}
for (const btn of document.querySelectorAll('.help')) {
  btn.addEventListener('click', e => {
    e.stopPropagation();
    if (helpOpen?.btn === btn && helpOpen.pinned) hideHelp(); else showHelp(btn, true);
  });
  btn.addEventListener('mouseenter', () => { if (!btn.disabled && !helpOpen?.pinned) showHelp(btn, false); });
  btn.addEventListener('mouseleave', () => { if (helpOpen && !helpOpen.pinned) hideHelp(); });
}
document.addEventListener('click', e => { if (helpOpen && !helpPop.contains(e.target)) hideHelp(); });
window.addEventListener('resize', hideHelp);

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
  h: 'recentre', g: 'toggleFollow', d: 'toggleRender',
};
document.addEventListener('keydown', e => {
  if (e.ctrlKey || e.altKey || e.metaKey || e.repeat) return;
  if (document.activeElement?.matches('input, select, textarea')) return;
  const k = e.key.toLowerCase();
  if (k === 'r' && e.shiftKey && !ui.setup) { actions.reset(); e.preventDefault(); return; }
  if (ui.setup && e.key === 'Enter') { actions.start(); e.preventDefault(); return; }
  if (ui.finished && e.key === 'Enter') { actions.runAgain(); e.preventDefault(); return; }
  if (helpOpen && e.key === 'Escape') { hideHelp(); e.preventDefault(); return; }
  if (ui.finished && e.key === 'Escape') { actions.dismissFinish(); e.preventDefault(); return; }
  if (ui.setup && ui.routeMode === 'custom' && e.key === 'Backspace') { actions.routeUndo(); e.preventDefault(); return; }
  // While the route is being chosen, every other shortcut (including Shift+R) is locked.
  if (ui.setup) {
    if ((KEYS[k] || ['1', '2', '3'].includes(e.key)) && !e.shiftKey || (k === 'r' && e.shiftKey)) toast('Choose the em-vehicle route first, then press Enter', 'data');
    return;
  }
  if (['1', '2', '3'].includes(e.key)) { actions.setFocus(Number(e.key) - 1); e.preventDefault(); return; }
  if (KEYS[k] && !e.shiftKey) { actions[KEYS[k]](); e.preventDefault(); }
});

// ---------------- Simulation loop (timer-driven, independent of frame rate) ----------------
function simStep() {
  const now = performance.now();
  if (ui.setup) { last = now; return; }                // paused until the presenter presses Start
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
  // Message key: only the Greenwave board sends messages, so it sits on that map while they are shown.
  for (const k of document.querySelectorAll('.msg-key')) {
    const show = ui.showMessages && (k.id !== 'focus-msg-key' || ui.focus === 2);
    if (k.hidden === show) k.hidden = !show;
  }
  $('view-toggle').firstChild.textContent = ui.view === 'grid' ? 'Focus view' : 'Grid view';
  $('btn-follow').className = ui.follow ? 'on' : '';
}

// ---------------- Maps ----------------
const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
let reducedMotion = reducedMotionQuery.matches;
reducedMotionQuery.addEventListener('change', e => { reducedMotion = e.matches; });

// Every map box holds a 3D canvas (three.js) and a 2D canvas (flat control-room map); the 2D/3D toggle (D)
// shows one and hides the other. A canvas can't swap its WebGL context for a 2D one, hence two canvases.
// 3D is the default; ?2d=1 starts in 2D, and without WebGL only 2D is offered.
function makeMap(canvas3d, panelIndex) {
  const canvas2d = document.createElement('canvas');
  canvas3d.after(canvas2d);
  const r3 = createScene3D(canvas3d);
  const modes = { '3d': r3 && { canvas: canvas3d, renderer: r3 }, '2d': { canvas: canvas2d, renderer: createMapRenderer(canvas2d) } };
  return {
    modes, panelIndex,
    get canvas() { return (modes[ui.render] || modes['2d']).canvas; },
    get renderer() { return (modes[ui.render] || modes['2d']).renderer; },
    /** Both renderers: city, orientation, vehicle look and camera resets must reach the hidden one too. */
    get renderers() { return [modes['3d']?.renderer, modes['2d'].renderer].filter(Boolean); },
  };
}
const gridMaps = [...document.querySelectorAll('#grid-view canvas')].map((canvas, i) => makeMap(canvas, () => i));
const focusMap = makeMap(document.getElementById('focus-canvas'), () => ui.focus);
const allMaps = [...gridMaps, focusMap];
const has3d = allMaps.every(m => m.modes['3d']);
ui.render = has3d && !use2d ? '3d' : '2d';
if (!has3d) $('render-toggle').hidden = true;                // no WebGL: 2D only

function setRender(mode) {
  if (mode === '3d' && !has3d) return;
  if (mode === '2d') setFollow(false);
  ui.render = mode;
  hover = null;
  const is3d = mode === '3d';
  document.querySelector('.view3d').hidden = !is3d;           // Recentre / em-vehicle view are 3D camera controls
  document.body.classList.toggle('r3d', is3d);               // 3D canvases fill their boxes (any shape)
  for (const m of allMaps) {
    m.modes['3d'] && (m.modes['3d'].canvas.hidden = !is3d);
    m.modes['2d'].canvas.hidden = is3d;
    m.renderer.resize();
  }
  $('render-toggle').firstChild.textContent = is3d ? '2D view' : '3D view';
}
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
// Moving the camera yourself leaves em-vehicle view (the button unticks).
for (const map of allMaps) {
  const r3 = map.modes['3d']?.renderer;
  if (!r3) continue;
  r3.onUserMove(() => { if (ui.follow) { setFollow(false); toast('Em-vehicle view off', 'data'); } });
  r3.onViewChange(view => { for (const m of allMaps) if (m !== map) m.modes['3d'].renderer.setView(view); });
}

/** Map clicks plan the ambulance route (instead of cutting links) during setup in "choose on map" mode. */
const planning = () => ui.setup && ui.routeMode === 'custom';

const DRAG_PX = 5;                   // a press that moves further than this is a camera drag, not a link click
// Listeners go on both canvases of each map; only the visible one ever receives events.
for (const map of allMaps) for (const { canvas, renderer } of Object.values(map.modes).filter(Boolean)) {
  let down = null;
  canvas.addEventListener('pointerdown', e => { down = { x: e.clientX, y: e.clientY }; });
  const wasDrag = e => down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > DRAG_PX;
  canvas.addEventListener('mousemove', e => {
    if (planning()) { hover = null; canvas.style.cursor = 'crosshair'; return; }
    if (ui.setup) { hover = null; canvas.style.cursor = 'default'; return; }   // links can't be cut until the run starts
    const link = linkUnder(map, e);
    hover = link ? { canvas, link } : null;
    canvas.style.cursor = link ? 'pointer' : 'default';
  });
  canvas.addEventListener('mouseleave', () => { if (hover?.canvas === canvas) hover = null; });
  canvas.addEventListener('click', e => {
    if (wasDrag(e)) return;
    if (planning()) {
      const { x, y } = (renderer.toGround ?? renderer.toWorld)(e.clientX, e.clientY);
      if (planner.click(x, y)) renderSetup();
      return;
    }
    if (ui.setup) return;
    const link = linkUnder(map, e); if (link) cutOrRestore(link);
  });
  canvas.addEventListener('contextmenu', e => e.preventDefault());   // right drag pans
}
for (const map of allMaps) new ResizeObserver(() => map.renderer.resize()).observe(map.canvas.parentElement);

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
    toast(`Em-vehicle arrived: ${arrivals.join(' · ')}`, 'go');
  }
  // All three ambulances home: offer a fresh run (back to the route menu).
  const allArrived = a => a && a.every(x => x.state === 'arrived');
  // pending.length: a dispatch queued this instant hasn't reached the worlds yet, so they only look finished.
  if (!ui.setup && !ui.finished && !pending.length && allArrived(nowAmb) && prevAmb && !allArrived(prevAmb)) showFinish(nowAmb);
  if (ui.finished && nowAmb.some(x => x.state === 'driving')) hideFinish();   // a new run is under way
  prevAmb = nowAmb;
  // Route overlay: the route being planned (with clickable targets), or the dispatched ambulance's route, dimmed.
  const driving = nowAmb.some(a => a.state === 'driving');
  const routePts = planning() ? planner.path() : driving && activeTrip ? planner.path(activeTrip) : null;
  const targets = planning() ? planner.targets() : null;
  const finished = planning() ? planner.done : true;   // a dispatched trip always runs edge to edge
  for (const m of allMaps) { m.renderer.setRoute?.(routePts, { dim: !planning(), finished }); m.renderer.setTargets?.(targets); }
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

setRender(ui.render);
build();
setView('grid');
setInterval(simStep, 16);
requestAnimationFrame(frame);
