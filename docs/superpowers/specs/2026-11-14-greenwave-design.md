# Greenwave — Design Spec

Date: 2026-11-14 · Event: DurHack 2026 (under 20 hours remaining) · Sponsor challenge: Neptune North

## 1. Goal

A browser-based, offline simulation of a 4×4 grid of traffic signals where every junction is an independent agent that talks only to its immediate neighbours. There is no central controller, so the system keeps working when links fail. The deliverable is a strong live demo comparing three modes on identical traffic:

1. **Central** — a working central controller.
2. **Fixed** — failed central controller (fixed timers).
3. **Greenwave** — decentralised neighbour-to-neighbour agents.

Success criteria:
- Live figures for ambulance journey time and average car wait in each mode.
- Links can be cut live (individually or all) while an ambulance is en route, and the Greenwave ambulance still gets through.
- A judge can verify junction independence: one worker per junction, messages only between neighbours, brain code with no access to global state.
- A junction never shows two conflicting greens, enforced locally and counted by the world (always 0).

Non-goals: styling (a separate frontend-design step), multiple simultaneous ambulances, multi-lane roads, protected turn phases, hardware.

## 2. Decisions

| Decision | Choice |
|---|---|
| Brain algorithm | Local max-pressure + neighbour platoon forecasts + priority pre-emption |
| Worker timing | Free-running, real time (demo). The same pure brain also runs in an in-process lockstep host for deterministic tests |
| Link cuts | Applied to all three panels at the same sim time |
| Central network | Hub attached to junction (0,0); reaches junctions by multi-hop over the same mesh; plus a separate "Fail central" control |
| Language | Plain JavaScript ES modules + JSDoc, no build step, `node:test`, zero dependencies |
| Signal model | Two phases (`NS`, `EW`) plus `ALL_RED`; turning cars go on their approach's green; single lane each way |
| Central baseline | Honest optimiser with perfect knowledge (may beat Greenwave on car wait; the pitch is "near-central performance that survives failure") |

## 3. Architecture

Three layers, strictly separated so the brain can be ported to microcontrollers later.

```
src/
  brain/        junction.js          pure: step(state, inputs) -> { state, lights, outbox }
  world/        rng.js, schedule.js, grid.js, cars.js, links.js, world.js, metrics.js
  controllers/  greenwave-workers.js one Worker per junction, free-running (browser demo)
                greenwave-lockstep.js same brains, called in-process (tests / headless)
                central.js, fixed.js
  worker/       junction-worker.js   thin wrapper: onmessage -> brain.step -> postMessage
  display/      index.html, main.js  canvas drawing of world snapshots + controls
server.js       zero-dependency static file server (offline)
test/           node:test suites for brain and world
```

### 3.1 Brain (`src/brain/`)

- Pure functions only. No DOM, timers, `Math.random`, `Date`, `self`/`window`, and no imports from outside `src/brain/`. A test enforces this.
- Knows neighbours only by direction (`N`, `E`, `S`, `W`), never by ID or grid position.
- Interface:
  - `init(config) -> state`
  - `step(state, inputs) -> { state, lights, outbox }`
  - `inputs = { now, queues: {N,E,S,W}, departures: {N,E,S,W}, inbox: [msg], sirenNear: dir | null }`
    - `queues[d]`: cars queued on the approach arriving from direction `d`.
    - `departures[d]`: cars that left via the exit towards `d` since the previous step.
  - `lights ∈ {'NS', 'EW', 'ALL_RED'}`, a single value, so conflicting greens are unrepresentable.
  - `outbox = [{ to: dir, msg }]`
- State: `{ phase, phaseSince, target, forecasts[], priority | null, seenPriority }`.

### 3.2 World (`src/world/`)

Headless and seeded, runs in Node and the browser. It owns physics, sensors, the link layer ("the wire") and metrics. It never decides light states.

### 3.3 Display (`src/display/`)

Draws `snapshot()` output and sends commands. It contains no simulation logic.

## 4. World model

### 4.1 Geometry
- 4×4 junctions, 120 m spacing, with entry/exit stubs on edge junctions giving 16 boundary entries/exits.
- Each road direction is a single-lane 1D segment with a stop line at the downstream end.

### 4.2 Spawn schedule (identical traffic)
- `mulberry32(seed)` generates the **complete spawn schedule up front**: `[{ t, entry, route }]`, where `route` is a sequence of exit directions (mostly straight, some turns), ending at a boundary exit.
- The schedule is fixed before simulation, so simulation events cannot perturb it. All three worlds use the same schedule.
- The ambulance uses a fixed route crossing the grid (W edge → E edge with two turns), spawned by command (`spawnAmbulance()`) at the same sim time in all worlds. Tests spawn it at a fixed time.

### 4.3 Car movement
- Continuous position along the segment. Cruise speed is 12 m/s, minimum gap 7 m, and a car never exceeds the speed that lets it stop behind the car ahead.
- A car stops at the stop line unless its approach's phase is green. A car already in the junction box always completes its crossing (≈1.5 s).
- No overtaking. The ambulance follows the same rules (it obeys signals and cannot pass queues) and additionally emits a siren.

### 4.4 Sensors (local to each junction)
- `queues[d]`: cars within 60 m of the stop line on approach `d` with speed < 1 m/s.
- `departures[d]`: a loop-detector count of cars leaving via exit `d`.
- `sirenNear`: the approach on which the ambulance is within 80 m of the stop line, else `null`.
- Ambulance V2I: when the ambulance is 200 m from its next junction and has not yet sent a request to it, it delivers a `PRIORITY` message directly to that junction (short-range radio, independent of links).

### 4.5 Links and network
- 24 bidirectional neighbour links, each `up` or `down`.
- A message over an up link is delivered after ~50 ms real time (lockstep host: next step). Over a down link it is silently dropped.
- **Central mode:** the controller is a hub attached to junction (0,0). Each junction is reachable if a path of up links exists from (0,0). Unreachable ("orphaned") junctions run a fixed timer. `failCentral()` orphans every junction.

### 4.6 Time
- Sim time = wall clock × speed multiplier (default 3×).
- The world pushes sensor readings to each worker every ~100 ms real time. Each worker runs its own decision loop every 250 ms sim-equivalent, using `now` from the latest sensor push.
- The world applies a worker's latest `lights` whenever it arrives. If a worker goes quiet its last state holds (safe, because it is a single phase).

## 5. Junction brain logic

### 5.1 Safety state machine
- Green may only change to `ALL_RED`, which holds for ≥ 2 s before the target phase goes green.
- Minimum green is 6 s (skipped only when priority is active). Maximum green is 45 s if the other phase has any demand.

### 5.2 Decision (each step)
1. If in `ALL_RED` and 2 s have elapsed → go green on `target`.
2. **Priority active** → target = the phase serving `priority.approach`. Change immediately (via all-red), ignoring minimum green.
   - A received `PRIORITY` is stored with absolute arrival time `arriveAt = now + etaSec`. It becomes active once `arriveAt - now ≤ 15 s`. `sirenNear` activates priority immediately for that approach.
   - It clears when `sirenNear` transitions from that approach to `null` (the ambulance has passed), or when `now > arriveAt + 20 s` (so a lost ambulance cannot freeze a junction).
3. **Otherwise, max-pressure + forecasts:**
   - `score(phase) = Σ queues on phase approaches + Σ forecast.count × w(eta)`, where `w = 1` for `eta < 5 s`, linear down to 0 at 15 s.
   - Switch when `score(other) > score(current) + 2` and green has lasted ≥ 6 s, or when 45 s is reached and `score(other) > 0`.
4. **Outbox:** for each exit `d` with `departures[d] > 0`, send `PLATOON { approach: opposite(d), count, etaSec: 10 }` to `d`. Also send any `PRIORITY` forwards (§5.3).
- Forecasts are stored with absolute arrival time and expire once more than 3 s overdue.
- When links are cut, forecasts stop arriving, the forecast term goes to zero and the junction behaves as a pure local max-pressure controller. No mode switch is needed.

### 5.3 Messages
- `PLATOON { approach, count, etaSec }`
- `PRIORITY { id, seq, approach, route, etaSec, hopsLeft }`, where `route` lists the exit directions remaining after the receiving junction.
- On receiving `PRIORITY`: ignore it if `(id, seq)` was already seen or `etaSec < -3`. Otherwise record priority for `approach`. If `hopsLeft > 0` and `route` is non-empty, forward to `route[0]` with `approach = opposite(route[0])`, `route = route.slice(1)`, `etaSec += 10` and `hopsLeft -= 1`.
- The ambulance's initial V2I request has `hopsLeft = 3`.
- **Refresh:** when a junction detects the ambulance passing (its `sirenNear` clears), it sends a new `PRIORITY` (`seq + 1`, `etaSec = 10`, `hopsLeft = 3`) to its next route hop, so the corridor rolls forward with the ambulance.
- With a link cut, the request stops at the gap. The next junction falls back to siren detection (≈ 6.7 s warning at 80 m).

## 6. Controllers

- **Greenwave (workers):** 16 `Worker`s, each wrapping `brain.step`. The world relays outboxes over the link layer. This is what runs in the browser demo.
- **Greenwave (lockstep):** the same brain called in-process each 250 ms of sim time, with messages delivered on the next step. Deterministic, used by tests and headless runs.
- **Central:** one controller using the same max-pressure scoring, but on true car positions with zero latency. It knows the ambulance's full route and ETA and pre-clears each reachable junction on the route 15 s ahead. Orphaned junctions run fixed timers.
- **Fixed:** 30 s `NS` / 2 s `ALL_RED` / 30 s `EW` / 2 s `ALL_RED`, all offsets zero.

The world also asserts the safety rule each tick (as a second check) and counts violations.

## 7. Metrics (computed by the world)

- **Ambulance journey time:** sim seconds from spawn to exit, plus seconds stopped. Live while driving, frozen on arrival.
- **Average car wait:** mean stopped time (speed < 1 m/s) over exited cars, plus a rolling 60 s value.
- **Throughput:** exited cars per minute.
- **Conflicting greens:** cumulative count (expected 0, shown on screen).

## 8. Display

- `world.snapshot() -> { t, junctions: [{ id, lights, orphaned }], cars: [{ x, y, heading, isAmbulance }], links: [{ a, b, up }], metrics }`
- Commands broadcast to all three worlds at the same sim time: `cutLink(a, b)`, `restoreLink(a, b)`, `cutAll()`, `restoreAll()`, `failCentral()`, `spawnAmbulance()`, `reset(seed)`.
- Unstyled first version: three canvases side by side, each headed with the mode name and live metrics. Grey roads, dot cars, a larger red ambulance, coloured stop-line ticks for lights, and clickable link segments (red and dashed when cut).
- Optional overlay: message arrows crossing links (blue `PLATOON`, red `PRIORITY`). Arrows stop on cut links.

### Demo script (~2 minutes)
1. Normal traffic, 20 s: central ≈ Greenwave, fixed is worse.
2. Fail central: the central panel degrades to fixed timers.
3. Spawn the ambulance in all three panels.
4. While it's en route: cut 3–4 links on its path, then cut all. The Greenwave ambulance still arrives.
5. A judge picks a junction: DevTools shows a separate worker thread per junction, and the message log shows neighbour-only traffic.

## 9. Testing

`node --test`, zero dependencies, brain and world only. The worker host and display are verified by running the demo.

**Brain**
- Property test (seeded, 10k steps, random inputs): `lights` is always valid, every green change passes through ≥ 2 s `ALL_RED`, and minimum green holds unless priority is active.
- `PRIORITY` makes the target phase green within all-red + one step. It forwards one hop with eta + 10 and the route popped. Duplicates are ignored and the timeout clears priority.
- `sirenNear` alone (empty inbox) triggers priority.
- Isolation: a static check that `src/brain/` has no imports outside itself and contains no `Math.random`, `Date`, `setTimeout`, `setInterval`, `self` or `window`.

**World (via lockstep host)**
- Same seed gives the same result: two runs of seed 42 in each mode give identical snapshots and metrics at t = 300 s. The spawn schedule is identical across modes.
- Safety: the world's conflicting-green counter is 0 after 600 s in every mode, with random link cuts.
- Ambulance with all links cut (Greenwave-lockstep): it exits within 2× free-flow time and faster than the fixed-timer ambulance on the same seed.
- No deadlock: under heavy traffic for 600 s, throughput is > 0 in every rolling minute, in every mode.

## 10. Build order (commit after each step)

1. Scaffold: folders, `package.json` (`test` and `serve` scripts), `server.js`, `.gitignore`.
2. `rng` + spawn schedule, with the determinism test.
3. World geometry, cars and sensors with the fixed controller, plus safety, no-deadlock and same-seed tests.
4. Brain: max-pressure + safety state machine, plus brain tests and the isolation test.
5. Links, messages and the lockstep host: Greenwave runs headless and its tests pass.
6. Ambulance, hop-by-hop `PRIORITY`, refresh and siren fallback, plus the ambulance-with-cuts test.
7. Central controller + hub reachability, with the same-seed test across all modes.
8. Metrics. **End of "correct simulation".**
9. Worker host (one worker per junction, free-running).
10. Bare three-panel display with metrics, click-to-cut and controls. **End of "three-mode comparison".**
11. Message-arrow overlay.
12. (Separate step) Visual design with the frontend-design skill.

**Cut list if short on time** (dropped first to last): the message-arrow overlay, then throughput and the rolling-wait metric, then hub reachability (central then fails only as a whole via `failCentral()`).
