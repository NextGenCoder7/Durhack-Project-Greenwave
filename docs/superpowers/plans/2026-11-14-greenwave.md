# Greenwave Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An offline browser simulation of a 4×4 signal grid comparing Central, Fixed and decentralised Greenwave control on identical seeded traffic, with live link cutting and an ambulance corridor.

**Architecture:**
- **Pure junction brain** (`src/brain/`): inputs are its own sensors plus neighbour messages; outputs are lights plus an outbox.
- **Headless seeded world** (`src/world/`): physics, sensors, link layer and metrics.
- **Controllers:** they drive the world. Greenwave runs as an in-process lockstep host for tests and as one Web Worker per junction for the demo.
- **Canvas display:** only draws `snapshot()` and sends commands.

**Tech Stack:** Plain JavaScript ES modules with JSDoc, Node ≥ 20 (`node:test`, `node:http`), browser Canvas 2D, Web Workers. Zero dependencies.

**Spec:** `docs/superpowers/specs/2026-11-14-greenwave-design.md`

## Global Constraints

- Zero npm dependencies. Must run fully offline: `npm test` and `npm run serve`.
- `"type": "module"` everywhere. No build step.
- `src/brain/**` must not import from outside `src/brain/`, and must not use `Math.random`, `Date`, `setTimeout`, `setInterval`, `self`, `window`, `document` or `performance`.
- Directions are `'N' | 'E' | 'S' | 'W'`. **Approach `d`** = cars arriving *from* side `d`. **Exit `d`** = leaving *towards* side `d`. Phase `'NS'` serves approaches N and S; `'EW'` serves E and W.
- Lights are always exactly one of `'NS' | 'EW' | 'ALL_RED'`.
- Grid 4×4, spacing 120 m, entry/exit stubs 120 m, cruise 12 m/s, minimum gap 7 m, box crossing 1.5 s.
- All-red ≥ 2 s, minimum green 6 s, maximum green 45 s, switch margin 2, forecast weight 1 below 5 s falling linearly to 0 at 15 s.
- Queue sensor: within 60 m of the stop line and speed < 1 m/s. Siren radius 80 m. V2I radius 200 m. Brain step period 0.25 s sim. Link latency 0.05 s sim.
- Fixed cycle: 30 s NS / 2 s ALL_RED / 30 s EW / 2 s ALL_RED (64 s), offset 0.
- World tick `dt ≤ 0.1` s. Iterate junctions and cars in a fixed order (no `Set`/`Map` iteration over unordered keys affecting outcomes).
- Commit after every task; commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- No styling work beyond what's needed to see and click things.

## Review Focus

1. **Worker jitter on stage:** async light updates arriving late must not count as conflicts unless they are physically unsafe. A conflict is a direct green→other-green change, or the box holding cars from both axes at once. *Test added in Task 2.*
2. **Large frame gaps** (hidden tab, slow laptop) must not let cars teleport through reds. `world.tick(dt)` throws `RangeError` for `dt > 0.1`, and the runner/display substeps. *Test added in Task 2.*
3. **Pressing "Spawn ambulance" while one is en route** must be ignored (one ambulance at a time), not create a second one or reset the timer. *Test added in Task 5.*
4. **Cut then restore a link:** messages must flow again after restoring. A restored link must not replay messages dropped while it was cut. *Test added in Task 4.*
5. **Entry backs up under heavy traffic:** spawns must wait rather than stacking cars on top of each other at the entry. *Test added in Task 2.*

---

## File Map

| File | Responsibility |
|---|---|
| `package.json`, `server.js`, `.gitignore` | Scripts and the offline static server |
| `src/world/rng.js` | `mulberry32` |
| `src/world/grid.js` | Geometry, ids, neighbours, links, direction helpers |
| `src/world/schedule.js` | Seeded spawn schedule, ambulance route constant |
| `src/world/world.js` | `createWorld`: cars, sensors, lights, links, inboxes, commands, safety counter, snapshot |
| `src/world/metrics.js` | Metric accumulation (wait, rolling wait, throughput, ambulance) |
| `src/world/run.js` | `runHeadless(world, controller, untilT, opts)` |
| `src/brain/phases.js` | Safety state machine + max-pressure helpers (shared with central) |
| `src/brain/junction.js` | `init`, `step`: the Greenwave agent |
| `src/controllers/fixed.js` | Fixed-timer controller + `fixedPhase(now)` |
| `src/controllers/greenwave-lockstep.js` | In-process host for 16 brains |
| `src/controllers/central.js` | Central controller with hub reachability |
| `src/controllers/greenwave-workers.js` | Browser host: 16 Workers |
| `src/worker/junction-worker.js` | Worker wrapper around `brain.step` |
| `src/display/index.html`, `src/display/main.js` | Three panels, controls, drawing |
| `test/*.test.js` | `node:test` suites |

Controller interface (all controllers): `{ name: string, tick(world): void }`. It is called before every `world.tick(dt)`. Controllers set lights only via `world.setLights(j, lights)`.

---

### Task 1: Scaffold, RNG and spawn schedule

**Files:**
- Create: `package.json`, `.gitignore`, `server.js`, `src/world/rng.js`, `src/world/grid.js`, `src/world/schedule.js`
- Test: `test/schedule.test.js`, `test/grid.test.js`

**Interfaces:**
- Produces:
  - `mulberry32(seed: number) => () => number` (in [0,1))
  - `grid.js`:
    - `N = 4`, `SPACING = 120`, `STUB = 120`, `DIRS = ['N','E','S','W']`
    - `opposite(d)`, `left(d)`, `right(d)` (for heading `d`: heading E → left is N)
    - `junctionId(r, c)` = `r*4 + c`, `rc(id) => {r, c}`
    - `junctionPos(id) => {x: 120 + c*120, y: 120 + r*120}` (world is 600×600 m, y down)
    - `neighbour(id, dir) => id | null`
    - `linkKey(a, b)` = `` `${min}-${max}` ``
    - `allLinks() => [[a, b]]` (24 pairs, a < b, row-major order)
    - `PHASE_OF = {N:'NS', S:'NS', E:'EW', W:'EW'}`
  - `schedule.js`:
    - `buildSchedule(seed, {duration = 1800, rate = 1/12} = {}) => Array<{id: number, t: number, entry: {side, index}, route: string[]}>`, sorted by `t` then `id`
    - `entryJunction(entry) => id`, where side W index r → junction (r,0) and side N index c → junction (0,c)
    - `AMBULANCE = {entry: {side:'W', index:1}, route: ['E','E','S','E','E']}`

- [ ] **Step 1:** Run `node --version`. Expected: ≥ v20. If lower, stop and tell the user.
- [ ] **Step 2:** Create `package.json`: `{"name":"greenwave","private":true,"type":"module","scripts":{"test":"node --test","serve":"node server.js"}}`. Create `.gitignore` containing `node_modules/` and `.DS_Store`.
- [ ] **Step 3: Write failing tests.**

```js
// test/grid.test.js
test('24 links, all between neighbours', () => {
  const links = allLinks();
  assert.equal(links.length, 24);
  for (const [a, b] of links) assert.ok(DIRS.some(d => neighbour(a, d) === b));
});
test('neighbour edges', () => {
  assert.equal(neighbour(junctionId(0,0), 'N'), null);
  assert.equal(neighbour(junctionId(1,1), 'E'), junctionId(1,2));
  assert.equal(neighbour(junctionId(1,1), 'S'), junctionId(2,1));
});
test('turn helpers', () => { assert.equal(left('E'), 'N'); assert.equal(right('E'), 'S'); assert.equal(opposite('N'), 'S'); });

// test/schedule.test.js
test('same seed gives identical schedule', () => assert.deepEqual(buildSchedule(42), buildSchedule(42)));
test('different seed differs', () => assert.notDeepEqual(buildSchedule(42), buildSchedule(43)));
test('every route is valid and leaves the grid', () => {
  for (const s of buildSchedule(42)) {
    let j = entryJunction(s.entry), heading = opposite(s.entry.side);
    s.route.forEach((exit, i) => {
      assert.notEqual(exit, opposite(heading));              // no U-turns
      const next = neighbour(j, exit);
      if (i < s.route.length - 1) assert.notEqual(next, null);
      else assert.equal(next, null);                          // last exit leaves grid
      j = next; heading = exit;
    });
  }
});
test('rate roughly matches', () => {
  const n = buildSchedule(1, {duration: 1200, rate: 1/12}).length;
  assert.ok(n > 1200/12*16*0.8 && n < 1200/12*16*1.2);
});
```

- [ ] **Step 4:** Run `npm test`. Expected: FAIL (modules missing).
- [ ] **Step 5: Implement `rng.js`, `grid.js` and `schedule.js`.**
  - Arrivals per entry are a Poisson process: exponential gaps `-ln(1-u)/rate`.
  - Generate all 16 entries from **one** rng in fixed entry order (sides N,E,S,W; index 0..3), then merge-sort by `(t, entry order)` and assign `id` sequentially.
  - Turn choice at each junction: straight 0.7, left 0.15, right 0.15. After 6 junctions, force straight.
- [ ] **Step 6: Implement `server.js`.**
  - `node:http` static server on port 8080 serving the repo root.
  - MIME types for `.html`, `.js`, `.css`, `.json`.
  - `/` redirects to `/src/display/index.html`.
  - Reject paths containing `..`.
- [ ] **Step 7:** Run `npm test`. Expected: all pass.
- [ ] **Step 8:** Commit: `feat: scaffold, seeded rng, grid geometry and spawn schedule`.

---

### Task 2: World physics, sensors, safety and fixed controller

**Files:**
- Create: `src/world/world.js`, `src/world/metrics.js`, `src/world/run.js`, `src/controllers/fixed.js`
- Test: `test/world.test.js`

**Interfaces:**
- Consumes: Task 1 exports.
- Produces:
  - `createWorld({seed, schedule?, rate?}) => world` (schedule defaults to `buildSchedule(seed, {rate})`)
  - `world.now: number`
  - `world.tick(dt)`: throws `RangeError` if `dt > 0.1 + 1e-9`
  - `world.setLights(j, lights)`
  - `world.lights: string[16]` (initially all `'ALL_RED'`)
  - `world.readSensors(j) => {now, queues:{N,E,S,W}, departures:{N,E,S,W}, sirenNear: dir | null}`. This **resets** that junction's departure counts.
  - `world.trueApproaches(j) => {N:[{dist, v, isAmbulance}], ...}`: read-only, for central
  - `world.conflicts: number`
  - `world.metrics() => {exited, avgWait, rollingWait, throughputPerMin, conflicts, ambulance: {state:'none'|'driving'|'arrived', journey, stopped}}`
  - `world.snapshot() => {t, junctions:[{id, lights, orphaned}], cars:[{x, y, heading, isAmbulance}], links:[{a, b, up}], metrics}`
  - `runHeadless(world, controller, untilT, {dt = 0.1, onStep} = {})`
  - `fixedPhase(now) => 'NS'|'EW'|'ALL_RED'`
  - `createFixed() => {name:'fixed', tick(world)}`
- Stubbed here, completed in later tasks: `world.orphaned: boolean[16]` (all false; Task 6 sets it).

**Car model:**
- Each approach segment (junction `j`, approach `d`) holds an array of cars, front first.
- A car is `{id, isAmbulance, route, hop, dist, v, waited, spawnT, inBox: 0}`, where `dist` is metres to the stop line.
- **Speed rule each tick:**
  - space = `dist` (front car, own approach not green), or `+Infinity` (front car, green), or `dist - leader.dist - 7` (follower)
  - `v = clamp(space / 1.0, 0, 12)`, then `dist -= v*dt`, clamped so it never goes below the stop line or the gap
- **Entering the box:** a front car with `dist ≤ 0.5` whose approach is green enters the box with `inBox = 1.5` and its axis recorded.
- **Leaving the box:** when `inBox` reaches 0 it leaves via `route[hop]`:
  - increment `departures[exit]` at `j`
  - if `neighbour(j, exit)` exists, append to that segment at `dist = 120` with approach `opposite(exit)` and `hop++`
  - otherwise the car has exited: record metrics
- **Waiting:** `waited += dt` while `v < 1` and not in the box.
- **Spawning:** a pending spawn at `t ≤ now` joins its entry segment at `dist = 120` only if that segment's last car has `dist ≤ 120 - 7`. Otherwise it stays pending in a FIFO per entry.
- **Conflict counting:** count `+1` when `setLights` changes NS→EW or EW→NS directly. Also count `+1` on any tick where a junction box holds cars from both axes (count once per junction per episode).

- [ ] **Step 1: Write failing tests.**

```js
const run = (seed, ctrl, T, opts) => { const w = createWorld({seed, ...opts}); runHeadless(w, ctrl(), T); return w; };
test('tick rejects dt > 0.1', () => assert.throws(() => createWorld({seed:1}).tick(0.2), RangeError));
test('fixed: same seed, same snapshot at 300s', () =>
  assert.equal(JSON.stringify(run(42, createFixed, 300).snapshot()), JSON.stringify(run(42, createFixed, 300).snapshot())));
test('fixed: zero conflicts over 600s', () => assert.equal(run(42, createFixed, 600).conflicts, 0));
test('fixed: cars exit and wait is positive', () => {
  const m = run(42, createFixed, 600).metrics(); assert.ok(m.exited > 100); assert.ok(m.avgWait > 0);
});
test('direct green-to-green counts a conflict; via all-red does not', () => {
  const w = createWorld({seed:1});
  w.setLights(0,'NS'); w.setLights(0,'ALL_RED'); for (let i=0;i<16;i++) w.tick(0.1); w.setLights(0,'EW');
  assert.equal(w.conflicts, 0);
  w.setLights(0,'NS'); assert.equal(w.conflicts, 1);
});
test('no deadlock under heavy traffic', () => {
  const w = createWorld({seed:5, rate: 1/5}); const c = createFixed(); let last = 0;
  for (let m = 1; m <= 10; m++) { runHeadless(w, c, m*60); const e = w.metrics().exited; assert.ok(e > last, `minute ${m}`); last = e; }
});
test('heavy entry: spawns never overlap', () => {
  const w = createWorld({seed:5, rate: 1/2});
  runHeadless(w, createFixed(), 300, {onStep: w => {
    for (const seg of w._segments()) for (let i = 1; i < seg.length; i++)
      assert.ok(seg[i].dist - seg[i-1].dist >= 7 - 1e-6);
  }});
});
test('sensors: queue counts stopped cars within 60m; departures reset on read', () => {
  const w = createWorld({seed:42}); runHeadless(w, {name:'red', tick(){}}, 120); // all red
  const s = w.readSensors(junctionId(1,0));
  assert.ok(s.queues.W > 0); assert.deepEqual(w.readSensors(junctionId(1,0)).departures, {N:0,E:0,S:0,W:0});
});
```

There are two test-only accessors. `w._segments()` returns every segment's car array, in fixed order. `w._schedule` is the spawn schedule the world was built with (Task 6 compares it across modes).

- [ ] **Step 2:** Run `npm test`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement `metrics.js`.**
  - `createMetrics()` with `onExit(car, now)`, `onAmbulance…` hooks, and `read(now, conflicts)`.
  - `rollingWait` = mean wait of cars exited in the last 60 s (0 if none). `throughputPerMin` = exits in the last 60 s.
- [ ] **Step 4: Implement `world.js`** following the car model above.
  - Snapshot car `x,y`: for a car on approach `d` of `j`, the position is `junctionPos(j)` offset `dist + 6` metres towards side `d`, plus 3 m lateral offset to the driver's left (UK, left-hand traffic). Cars in the box are drawn at `junctionPos(j)`.
  - Snapshot numbers are rounded to 2 dp so the JSON is comparable.
- [ ] **Step 5: Implement `run.js` and `fixed.js`.**
  - `runHeadless` loops `controller.tick(world); world.tick(dt); onStep?.(world)` while `world.now < untilT - 1e-9`.
  - `createFixed().tick` sets `fixedPhase(world.now)` on all 16 junctions.
- [ ] **Step 6:** Run `npm test`. Expected: all pass.
- [ ] **Step 7:** Commit: `feat: headless seeded world with sensors, safety counter and fixed controller`.

---

### Task 3: Junction brain: safety machine and max-pressure

**Files:**
- Create: `src/brain/phases.js`, `src/brain/junction.js`
- Test: `test/brain.test.js`, `test/brain-isolation.test.js`

**Interfaces:**
- Produces (`phases.js`):
  - `ALL_RED_S = 2`, `MIN_GREEN_S = 6`, `MAX_GREEN_S = 45`, `MARGIN = 2`
  - `opposite(d)`, `servingPhase(approach)` (a local copy: the brain may not import grid.js)
  - `initSignal() => {phase:'ALL_RED', since: 0, target:'NS'}`
  - `advance(sig, want, now, {ignoreMinGreen = false} = {}) => sig`:
    - In `ALL_RED`: `target = want`. Go green on `target` once `now - since ≥ 2`.
    - On a green ≠ `want`: go to ALL_RED (`since = now`, `target = want`) if `ignoreMinGreen || now - since ≥ 6`.
    - Otherwise unchanged.
  - `chooseByPressure(phase, scores: {NS, EW}, greenFor) => 'NS'|'EW'`: returns other if `scores[other] > scores[phase] + 2`, or if `greenFor ≥ 45 && scores[other] > 0`, else `phase`. In `ALL_RED`, return the higher score (ties → `'NS'`).
  - `forecastWeight(eta)`: 1 if eta < 5, `(15 - eta)/10` for 5 ≤ eta < 15, 0 if eta ≥ 15. Negative eta counts as 1.
- Produces (`junction.js`):
  - `init() => state`, where `state = {sig, forecasts: [{approach, count, at}], priority: null, seen: [], lastSiren: null}`
  - `step(state, inputs) => {state, lights, outbox}`
    - `inputs = {now, queues, departures, inbox, sirenNear}`
    - `outbox = [{to, msg}]`
    - `msg` is `{type:'PLATOON', approach, count, etaSec}` or `{type:'PRIORITY', id, seq, approach, route, etaSec, hopsLeft}`
- In this task, `step` handles only PLATOON and pressure. Task 5 adds PRIORITY and siren.
- `step` must not mutate its input `state`: return a new object.

- [ ] **Step 1: Write failing tests** in `brain.test.js`. Use `mulberry32` from `../src/world/rng.js` in the test only.

```js
const S = (o={}) => ({now:0, queues:{N:0,E:0,S:0,W:0}, departures:{N:0,E:0,S:0,W:0}, inbox:[], sirenNear:null, ...o});
test('property: valid lights, all-red ≥2s between greens, min green 6s (10k steps)', () => {
  const r = mulberry32(9); let st = init(), prevGreen = null, allRedFrom = null, greenFrom = 0;
  for (let i = 0; i < 10000; i++) {
    const now = i * 0.25, q = () => Math.floor(r()*12);
    const inbox = r() < 0.2 ? [{type:'PLATOON', approach:'NESW'[Math.floor(r()*4)], count: q(), etaSec: r()*20}] : [];
    const out = step(st, S({now, queues:{N:q(),E:q(),S:q(),W:q()}, inbox})); st = out.state;
    assert.ok(['NS','EW','ALL_RED'].includes(out.lights));
    if (out.lights === 'ALL_RED') { if (allRedFrom === null) allRedFrom = now; }
    else {
      if (prevGreen !== null && out.lights !== prevGreen) assert.ok(now - allRedFrom >= 2 - 1e-9);
      if (out.lights !== prevGreen) { if (prevGreen !== null) assert.ok(allRedFrom - greenFrom >= 6 - 1e-9); greenFrom = now; }
      prevGreen = out.lights; allRedFrom = null;
    }
  }
});
test('switches to the heavier axis after min green', () => { /* NS green with E/W queues 10, N/S 0 → ALL_RED at t≥6, EW by t≥8 */ });
test('platoon forecast tips the decision', () => { /* equal queues; PLATOON on W, count 6, eta 3 → EW wins */ });
test('departures produce PLATOON to that exit', () => {
  const out = step(init(), S({departures:{N:0,E:4,S:0,W:0}}));
  assert.deepEqual(out.outbox, [{to:'E', msg:{type:'PLATOON', approach:'W', count:4, etaSec:10}}]);
});
test('forecasts expire 3s after due', () => { /* PLATOON eta 1 at t=0; at t=4.25 state.forecasts is empty */ });
test('does not mutate input state', () => { const s = init(); const copy = structuredClone(s); step(s, S({queues:{N:5,E:0,S:0,W:0}})); assert.deepEqual(s, copy); });
```

Write out the three commented tests fully with the values shown.

`brain-isolation.test.js`: read every file in `src/brain/`. Assert that every `import ... from '...'` specifier starts with `./`. Assert that the source matches none of `/Math\.random|\bDate\b|setTimeout|setInterval|\bself\b|\bwindow\b|\bdocument\b|performance/`.

- [ ] **Step 2:** Run `npm test`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement `phases.js` and `junction.js`.**
  - Step order:
    1. Ingest inbox (PLATOON → forecast `at = now + etaSec`).
    2. Expire forecasts with `at < now - 3`.
    3. Compute scores: queues on the phase's approaches plus Σ `count × forecastWeight(at - now)`.
    4. `want = chooseByPressure(...)`, then `sig = advance(sig, want, now)`.
    5. Build the outbox from departures in `DIRS` order.
  - `lights = sig.phase`.
- [ ] **Step 4:** Run `npm test`. Expected: all pass.
- [ ] **Step 5:** Commit: `feat: pure junction brain with safety state machine and max-pressure`.

---

### Task 4: Link layer and Greenwave lockstep host

**Files:**
- Modify: `src/world/world.js`
- Create: `src/controllers/greenwave-lockstep.js`
- Test: `test/links.test.js`, `test/greenwave.test.js`

**Interfaces:**
- Consumes: `init`/`step` (Task 3); `world` API (Task 2).
- Produces:
  - `world.send(fromJ, dir, msg)`: if `neighbour(fromJ, dir)` exists and the link is up, queue `{deliverAt: now + 0.05, to, msg}`, otherwise drop it. Record `{a: fromJ, b: to, type: msg.type, t: now}` in `world.recentMessages` (kept for 1 s of sim time).
  - `world.takeInbox(j) => msg[]`: returns delivered messages with `deliverAt ≤ now`, in send order, and removes them.
  - `world.deliverDirect(j, msg)`: immediate, ignores links (used by V2I in Task 5).
  - `world.cutLink(a, b)`, `world.restoreLink(a, b)`, `world.cutAll()`, `world.restoreAll()`, `world.linkUp(a, b) => boolean`.
  - A message in flight on a link when it is cut is dropped at delivery time.
  - `createGreenwaveLockstep() => {name:'greenwave', tick(world)}`:
    - holds 16 brain states
    - when `world.now ≥ nextStep` (period 0.25), for `j = 0..15` in order: `inputs = {...world.readSensors(j), inbox: world.takeInbox(j)}`, call `step`, `setLights`, and `send` each outbox entry
- `snapshot().links` now reflects up/down.

- [ ] **Step 1: Write failing tests.**

```js
test('message over an up link arrives after latency; cut link drops it', () => {
  const w = createWorld({seed:1}); w.send(0, 'E', {type:'PLATOON'}); assert.deepEqual(w.takeInbox(1), []);
  w.tick(0.1); assert.equal(w.takeInbox(1).length, 1);
  w.cutLink(0, 1); w.send(0, 'E', {type:'PLATOON'}); w.tick(0.1); assert.deepEqual(w.takeInbox(1), []);
});
test('restore resumes flow without replaying dropped messages', () => {
  const w = createWorld({seed:1}); w.cutLink(0,1); w.send(0,'E',{type:'X'}); w.restoreLink(0,1); w.tick(0.1);
  assert.deepEqual(w.takeInbox(1), []);
  w.send(0,'E',{type:'Y'}); w.tick(0.1); assert.deepEqual(w.takeInbox(1).map(m=>m.type), ['Y']);
});
test('send off the grid edge is dropped', () => { const w = createWorld({seed:1}); w.send(0,'N',{type:'X'}); w.tick(0.1); /* no throw */ });
test('greenwave: deterministic, zero conflicts, beats fixed on wait', () => {
  const a = createWorld({seed:42}); runHeadless(a, createGreenwaveLockstep(), 600);
  const b = createWorld({seed:42}); runHeadless(b, createGreenwaveLockstep(), 600);
  assert.equal(JSON.stringify(a.snapshot()), JSON.stringify(b.snapshot()));
  assert.equal(a.conflicts, 0);
  const f = createWorld({seed:42}); runHeadless(f, createFixed(), 600);
  assert.ok(a.metrics().avgWait < f.metrics().avgWait);
});
test('greenwave: random link cuts, zero conflicts', () => {
  const w = createWorld({seed:42}), r = mulberry32(7), links = allLinks();
  runHeadless(w, createGreenwaveLockstep(), 600, {onStep: w => {
    if (Math.abs(w.now % 30) < 1e-6) { const [a,b] = links[Math.floor(r()*24)]; w.cutLink(a,b); }
  }});
  assert.equal(w.conflicts, 0);
});
```

Use an integer step counter in `onStep` instead of `w.now % 30` if floating-point drift makes the condition unreliable.

- [ ] **Step 2:** Run `npm test`. Expected: the new tests FAIL.
- [ ] **Step 3:** Implement the link layer in `world.js`, then `greenwave-lockstep.js`.
- [ ] **Step 4:** Run `npm test`. Expected: all pass. If "beats fixed on wait" fails, tune nothing silently. Report the numbers and investigate with superpowers:systematic-debugging.
- [ ] **Step 5:** Commit: `feat: link layer and in-process greenwave host`.

---

### Task 5: Ambulance, hop-by-hop PRIORITY, refresh and siren fallback

**Files:**
- Modify: `src/world/world.js`, `src/brain/junction.js`
- Test: `test/ambulance.test.js`, add to `test/brain.test.js`

**Interfaces:**
- Produces:
  - `world.spawnAmbulance()`: spawns `AMBULANCE` at `now` with `isAmbulance: true`, skipping the entry FIFO (it is placed behind the last car or at 120 m). A no-op if an ambulance is already driving.
  - **V2I:** each tick, if the ambulance is on approach `d` of `j` with `dist ≤ 200` and has not yet messaged `j`, call `world.deliverDirect(j, {type:'PRIORITY', id:'amb', seq: 2*hop, approach: d, route: route.slice(hop+1), etaSec: dist/12, hopsLeft: 3})`.
  - `readSensors(j).sirenNear` = approach `d` if the ambulance is on `d` of `j` with `dist ≤ 80`.
  - Ambulance metrics: `journey` = `now - spawnT` (frozen on exit); `stopped` = its `waited`.
- **Brain `state.priority`** is `{id, approach, arriveAt, route, seq} | null`.
- **On PRIORITY in the inbox:**
  - Drop it if `etaSec < -3`.
  - If the key `` `${id}:${seq}` `` is in `state.seen`, ignore it. Otherwise push the key (keep the last 32).
  - Set `priority = {id, approach, arriveAt: now + etaSec, route, seq: max(prev?.seq ?? -1, seq)}`.
  - If `hopsLeft > 0 && route.length`, forward to `route[0]` with `{...msg, approach: opposite(route[0]), route: route.slice(1), etaSec: etaSec + 10, hopsLeft: hopsLeft - 1}`.
- **Siren:** if `sirenNear` is set and there is no priority on that approach, set `priority = {id:'siren', approach: sirenNear, arriveAt: now, route: [], seq: -1}`.
- **Active** if `priority && (priority.arriveAt - now ≤ 15 || sirenNear === priority.approach)`. When active, `want = servingPhase(priority.approach)` and call `advance(..., {ignoreMinGreen: true})`.
- **Clear and refresh:**
  - If `lastSiren === priority.approach && sirenNear === null`, the ambulance has passed: clear priority. If `priority.route.length`, send `{type:'PRIORITY', id, seq: priority.seq + 1, approach: opposite(route[0]), route: route.slice(1), etaSec: 10, hopsLeft: 3}` to `route[0]`.
  - Also clear when `now > arriveAt + 20`.
  - Update `lastSiren = sirenNear` each step.

- [ ] **Step 1: Write failing brain tests.**
  - `PRIORITY` (approach W, eta 5) received while NS is green at t=1 (below min green) → ALL_RED at t=1 and EW at t=3.25 or earlier.
  - The same message forwards exactly one `PRIORITY` to `route[0]` with eta +10, route popped and `hopsLeft - 1`. Resending the same `(id, seq)` produces no forward.
  - `sirenNear: 'N'` with an empty inbox while EW is green → NS within 2.25 s.
  - Siren goes N → null → priority cleared and a refresh is sent to `route[0]` with `seq + 1`.
  - Priority with eta 5 and no siren ever → cleared after t > 25.
  - Priority with eta 40 → not active yet (pressure still decides).
- [ ] **Step 2: Write failing world tests.**

```js
const amb = (makeCtrl, seed, cutAll) => {
  const w = createWorld({seed}), c = makeCtrl();
  if (cutAll) w.cutAll();
  runHeadless(w, c, 120); w.spawnAmbulance(); runHeadless(w, c, 400);
  return w.metrics().ambulance;
};
```

  - `'greenwave ambulance arrives with all links cut, within 2× free-flow (115s)'`: state `'arrived'` and `journey ≤ 115` for seeds 1–5.
  - `'greenwave with cuts beats fixed on average ambulance journey'`: mean over seeds 1–5.
  - `'second spawnAmbulance while driving is ignored'`: spawn, tick 5 s, spawn again. There is exactly one `isAmbulance` car in the snapshot and `journey` was not reset.
  - `'zero conflicts with ambulance and all links cut'`.
- [ ] **Step 3:** Run `npm test`. Expected: the new tests FAIL.
- [ ] **Step 4:** Implement the world parts, then the brain parts.
- [ ] **Step 5:** Run `npm test`. Expected: all pass, including the Task 3 property test.
- [ ] **Step 6:** Commit: `feat: ambulance with hop-by-hop priority corridor and siren fallback`.

---

### Task 6: Central controller with hub reachability

**Files:**
- Create: `src/controllers/central.js`
- Modify: `src/world/world.js` (`failCentral()`, `centralFailed`)
- Test: `test/central.test.js`, `test/modes.test.js`

**Interfaces:**
- Consumes: `advance`, `chooseByPressure`, `forecastWeight`, `servingPhase` from `src/brain/phases.js`; `fixedPhase` from `fixed.js`; `world.trueApproaches`, `world.linkUp`, `world.orphaned`.
- Produces:
  - `world.failCentral()` sets `world.centralFailed = true`. `reset` is handled by creating a new world.
  - `world.ambulanceInfo() => null | {junctions: [{j, approach, eta}]}`: the remaining route junctions with true eta = remaining distance / 12. Only central uses this.
  - `reachableFromHub(world) => boolean[16]`: BFS from junction 0 over up links. All false if `centralFailed`.
  - `createCentral() => {name:'central', tick(world)}`, run every 0.25 s.
- **Central tick:**
  1. `reach = reachableFromHub(world)`, then write `world.orphaned[j] = !reach[j]`.
  2. **Reachable junctions:**
     - scores = stopped cars within 60 m on the phase's approaches, plus Σ `forecastWeight(dist/12)` for moving cars within 15 s
     - if the ambulance eta at `j` is ≤ 15, `want = servingPhase(approach)` with `ignoreMinGreen`
     - otherwise `want = chooseByPressure(...)`
  3. **Orphaned junctions:** `want` = the green of the current fixed-cycle period, or the next one during the fixed cycle's all-red, using `advance(..., {ignoreMinGreen: true})`.
  4. `setLights(j, sig.phase)`.
- Greenwave and fixed leave `orphaned` all false.

- [ ] **Step 1: Write failing tests.**
  - `reachableFromHub`: all true initially. Cutting links 0-1 and 0-4 → all false. Cutting only 0-1 → all true. After `failCentral` → all false.
  - `central: zero conflicts across failCentral mid-run` (fail at t=200, run to 600).
  - `central beats fixed on avgWait (seed 42, 600 s)`.
  - `central ambulance journey ≤ greenwave ambulance journey, links up (seed 42)`. This is an honest-baseline sanity check; if it fails, report it rather than weakening the test.
  - `modes.test.js`: for each of fixed, central and greenwave, two runs on seed 42 to 300 s with an ambulance at 120 s give identical snapshots. All three worlds see an identical schedule (`deepEqual` of `buildSchedule(42)` across worlds' `_schedule`).
- [ ] **Step 2:** Run `npm test`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npm test`. Expected: all pass.
- [ ] **Step 5:** Commit: `feat: central controller with hub reachability and fallback to fixed`. **This completes the correct simulation.**

---

### Task 7: Worker host (one Worker per junction, free-running)

**Files:**
- Create: `src/worker/junction-worker.js`, `src/controllers/greenwave-workers.js`

**Interfaces:**
- Consumes: `init`, `step` (brain); `world.readSensors`, `takeInbox`, `send`, `setLights`.
- Produces:
  - `createGreenwaveWorkers({speed}) => {name:'greenwave', tick(world), setSpeed(s), terminate()}`
  - **Worker protocol:**
    - main → worker: `{type:'sensors', sensors, inbox}`
    - worker → main: `{lights, outbox}`
- **Host:**
  - on first `tick` it spawns 16 `new Worker(new URL('../worker/junction-worker.js', import.meta.url), {type:'module', name:`junction-${j}`})`
  - each `tick` (throttled to every 100 ms real), for each j it posts the sensors and inbox
  - `onmessage` → `world.setLights(j, lights)` and `world.send(j, to, msg)` for each outbox entry
- **Worker:**
  - keeps its own brain `state`
  - accumulates `departures` and `inbox` across sensor pushes
  - its own `setInterval(stepBrain, 250 / speed)` (real ms) calls `step` with the latest sensors (`now` = latest pushed sim time) and the accumulated inputs, then clears them
  - posts the result only if lights changed or the outbox is non-empty
- The worker host has no automated test; the spec verifies it by running the demo.

- [ ] **Step 1:** Implement both files.
- [ ] **Step 2:** Add a temporary check script, `src/display/worker-check.html`, that runs one world with the worker host at 3× for 120 s of sim time. It then prints `metrics()` and `conflicts` to the page. Run `npm run serve` and open `http://localhost:8080/src/display/worker-check.html`. Expected: `conflicts: 0`, `exited > 50`, and DevTools → Sources shows 16 `junction-N` worker threads. Use the run skill or the Chrome tools to check this.
- [ ] **Step 3:** Delete `worker-check.html`. Commit: `feat: free-running web worker host, one worker per junction`.

---

### Task 8: Bare three-panel display

**Files:**
- Create: `src/display/index.html`, `src/display/main.js`

**Interfaces:**
- Consumes:
  - `createWorld`
  - `createCentral`, `createFixed`, `createGreenwaveWorkers`
  - `world.snapshot()` and the commands `cutLink`, `restoreLink`, `cutAll`, `restoreAll`, `failCentral`, `spawnAmbulance`
- **Panels:** `[{label:'Central', ctrl: createCentral()}, {label:'Fixed (central failed)', ctrl: createFixed()}, {label:'Greenwave', ctrl: createGreenwaveWorkers({speed})}]`, all with `seed` from `?seed=` (default 42).
- **Loop (`requestAnimationFrame`):**
  - `simDt = min(realDt, 0.25) × speed`, consumed in substeps of ≤ 0.1
  - each substep, for every panel: `ctrl.tick(world); world.tick(sub)`, so all three worlds stay at the same `now`
- **Commands:**
  - Buttons: Spawn ambulance, Fail central, Cut all, Restore all, Reset, plus a speed select (1×/3×/5×, default 3×).
  - Each command calls the same method on all three worlds within the same frame, between substeps. Commands go only through the worlds, so all three stay in step.
  - Reset terminates the workers and rebuilds the panels.
- **Click to cut:** clicking a canvas finds the nearest link midpoint within 12 px and toggles it on all three worlds.
- **Drawing (unstyled):**
  - grey road lines
  - a 4 px stop-line tick per approach: green if its phase is lit, otherwise red
  - orphaned junctions outlined in orange
  - cars as 2 px dots; the ambulance as a 5 px red dot
  - links up drawn thin; links cut drawn red and dashed
- **Header per panel:** label, ambulance (`journey`/`stopped`, or "—"), avg wait, rolling wait, throughput/min, conflicts.

- [ ] **Step 1:** Implement.
- [ ] **Step 2:** Run `npm run serve`, open `http://localhost:8080/`, and step through the spec demo script:
  1. 20 s of traffic: all three panels move.
  2. Fail central: the Central panel shows orange outlines and its wait rises.
  3. Spawn ambulance: three red dots.
  4. Cut 3 links on its path, then Cut all: the Greenwave ambulance arrives.
  5. DevTools shows 16 worker threads.
  6. Conflicts stay 0 everywhere.

  Take a screenshot and record the figures in the commit message body.
- [ ] **Step 3:** Commit: `feat: three-panel comparison display with live link cutting`. **This completes the three-mode comparison.**

---

### Task 9: Message-arrow overlay (first to cut if short on time)

**Files:**
- Modify: `src/display/main.js`, `src/world/world.js` (include `recentMessages` in `snapshot().messages` as `[{a, b, type, age}]`)

- [ ] **Step 1:** Add `messages` to the snapshot, then run `npm test`. Expected: the same-seed tests still pass, because `recentMessages` is deterministic in lockstep.
- [ ] **Step 2:** Add a checkbox "Show messages". Draw each message as a short arrow from a to b, positioned along the link by `age` (0–1 s): blue for `PLATOON`, red for `PRIORITY`.
- [ ] **Step 3:** Check manually: cutting a link stops arrows on it, and the ambulance shows a red arrow chain ahead of it.
- [ ] **Step 4:** Commit: `feat: neighbour message overlay`.

---

### After this plan

The visual design pass uses the frontend-design skill as a separate step, as the spec requires. It is not part of this plan.

**Cut list if short on time** (dropped first to last): Task 9; then `rollingWait`/`throughputPerMin` (keep the fields at 0); then hub reachability (`reachableFromHub` returns `!centralFailed` for all junctions).
