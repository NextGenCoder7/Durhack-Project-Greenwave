# Greenwave Visual Design Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the bare three-panel display with the control-room UI: grid/focus views, comparison scoreboard, grouped dock with keyboard shortcuts, restyled maps and event toasts.

**Architecture:**
- Display-only work. The display still reads only `world.snapshot()` and sends world commands.
- `main.js` orchestrates (sim loop, commands, keys, views).
- `map-renderer.js` draws one world onto one canvas.
- `scoreboard.js` and `toasts.js` render DOM.
- Pure, testable helpers live in `demo-rules.js`.
- One world change: a `stopped` flag on snapshot cars.

**Tech Stack:** Plain JS ES modules, Canvas 2D, CSS custom properties, `node:test`. Zero dependencies, offline.

**Spec:** `docs/superpowers/specs/2026-11-14-greenwave-visual-design.md` (base spec: `docs/superpowers/specs/2026-11-14-greenwave-design.md`)

## Global Constraints

- Zero dependencies, no CDN, no web fonts. Font stack `Bahnschrift, "Segoe UI", system-ui, sans-serif`. Numbers use `font-variant-numeric: tabular-nums`.
- **Colour tokens (exact):**
  - `bg #0b1220`, `panel #111b2e`, `border #1f2d47`, `road #1c2a44`
  - `text #e6f0ff`, `muted #8ea3c4`
  - `go #3dffa8`, `stop #ff5470`, `wait #ffb547`, `data #38bdf8`, `siren #ff3355`
  - siren blue `#4d7cff`, moving car `#9fb3d1`
- The display never contains simulation logic. Commands go through the existing queued `broadcast` so all three worlds change at the same sim time.
- The sim loop stays timer-driven (`setInterval(simStep, 16)`). Only drawing uses `requestAnimationFrame`.
- **Shortcuts (exact):**
  - `F` fail central, `A` ambulance, `C` cut all, `R` restore all, `Shift+R` reset
  - `M` Greenwave messages, `O` show messages, `V` toggle view
  - `1`/`2`/`3` focus tab (switches to focus view)
  - `[` / `]` speed down/up through 1×/3×/5×
  - Ignored while an `input`/`select`/`button` has keyboard focus, or when Ctrl, Alt or Meta is held.
- **Scoreboard row order:** Ambulance, Stops per car (last 60 s), Avg car wait (last 60 s), Conflicting greens.
- Work on branch `feat/visual-design`. Commit after every task. Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Run tests with `npm test`. Node is at `C:\Program Files\nodejs`; in bash, prefix `PATH="/c/Program Files/nodejs:$PATH"`. The dev server is `npm run serve` (127.0.0.1:8080).

## Review Focus

1. **Window resize mid-demo:** maps must re-fit and stay crisp, and click/hover hit-testing must use the new transform. *Manual check in Task 3 step 5.*
2. **Focus view hit-testing:** hovering or clicking the big canvas must target the *focused* world's links, and cutting must still broadcast to all three worlds. *Manual check in Task 4 step 6.*
3. **Reset during a run:** no spurious "ambulance arrived" toast; workers terminated; view and tab preserved. *Test in Task 5 (`detectEvents` with a reset `prev`), plus manual check.*
4. **Keyboard shortcuts while a form control is focused**, e.g. the speed select: they must not fire. *Manual check in Task 2 step 5.*
5. **High device-pixel-ratio screens** (this laptop is 1.65): canvases must be sharp, not blurry or oversized. *Manual check in Task 3 step 5.*

---

## File Map

| File | Change |
|---|---|
| `src/world/world.js` | `snapshot().cars[i].stopped` |
| `src/display/index.html` | Rewrite: header, `#views` (grid + focus), dock, `#toasts` |
| `src/display/styles.css` | New: tokens, layouts, dock, scoreboard, pills, toasts, reduced motion |
| `src/display/main.js` | Rewrite around panels, views, keys, hover; drawing moves out |
| `src/display/map-renderer.js` | New |
| `src/display/scoreboard.js` | New |
| `src/display/toasts.js` | New |
| `src/display/demo-rules.js` | Add `bestIndex`, `detectEvents` |
| `test/world.test.js`, `test/demo-rules.test.js` | Add tests |

---

### Task 1: `stopped` flag on snapshot cars

**Files:**
- Modify: `src/world/world.js` (the `snapshot()` car push)
- Test: `test/stops.test.js`, which already has the one-car fixtures

**Interfaces:**
- Produces: `snapshot().cars[i] = { x, y, heading, isAmbulance, stopped }`
  - `stopped` = the car is on an approach segment and `v < 1`
  - cars in the junction box are `stopped: false`

- [ ] **Step 1: Create the branch.** Run `git checkout -b feat/visual-design`.
- [ ] **Step 2: Write the failing tests** in `test/stops.test.js` (reuse `ONE_CAR` and `lightsCtrl`):

```js
test('snapshot marks a car queued at a red light as stopped', () => {
  const w = createWorld({ schedule: ONE_CAR });
  runHeadless(w, lightsCtrl(() => 'ALL_RED'), 20);
  assert.deepEqual(w.snapshot().cars.map(c => c.stopped), [true]);
});
test('snapshot marks a car driving on green as not stopped', () => {
  const w = createWorld({ schedule: ONE_CAR });
  runHeadless(w, lightsCtrl(() => 'EW'), 5);
  assert.deepEqual(w.snapshot().cars.map(c => c.stopped), [false]);
});
```

- [ ] **Step 3:** Run `npm test`. Expected: the 2 new tests FAIL (`undefined`).
- [ ] **Step 4: Implement.** In `snapshot()`, add `stopped: c.v < 1` for segment cars and `stopped: false` for box cars.
- [ ] **Step 5:** Run `npm test`. Expected: all pass (86).
- [ ] **Step 6:** Commit: `feat: stopped flag on snapshot cars`.

---

### Task 2: Shell, tokens, header pills, dock and keyboard

**Files:**
- Rewrite: `src/display/index.html`, `src/display/main.js`
- Create: `src/display/styles.css`

**Interfaces:**
- Consumes:
  - `createWorld`, `createCentral`, `createFixed`, `createGreenwaveWorkers`
  - `canSpawnAmbulance`, `linkAt`
  - world commands: `cutLink`, `restoreLink`, `cutAll`, `restoreAll`, `failCentral`, `spawnAmbulance`, `setMessaging`
- Produces (inside `main.js`; later tasks extend these):
  - `panels: [{ key: 'central'|'fixed'|'greenwave', label, ctrl, world }]` in that order; labels "Central", "Fixed (central failed)", "Greenwave"
  - `ui = { view: 'grid'|'focus', focus: 0|1|2, showMessages: bool, messagesOn: bool, speed: 1|3|5 }`
  - `broadcast(fn: (world, panel) => void)`: queued, applied to every panel at the start of the next `simStep`
  - `actions` object, one function per control, used by both buttons and keys:
    - `failCentral`, `spawnAmbulance`, `cutAll`, `restoreAll`
    - `toggleMessages`, `toggleShowMessages`, `toggleView`, `setFocus(i)`
    - `speedDown`, `speedUp`, `reset`
  - `updateHeader()`: refreshes the clock, speed and status pills every animation frame:
    - `CENTRAL: ONLINE|FAILED` from `panels[0].world.centralFailed`
    - `LINKS CUT: n/24` from `panels[0].world.snapshot().links`
    - `GREENWAVE MESSAGES: ON|OFF` from `panels[2].world.messaging`

**DOM** (ids the later tasks rely on):
- `#clock`, `#speed-label`, `#pill-central`, `#pill-links`, `#pill-messages`, `#view-toggle`
- `#views` containing:
  - `#grid-view`: three `.map-panel` elements, each with an `h2`, a `canvas` and a `.stat-strip`
  - `#focus-view`: `.focus-tabs` with three buttons, a `canvas#focus-canvas` and `table#scoreboard`
- `#dock` with buttons `data-action="<action name>"`, each containing a `<kbd>` with its key
- `#toasts`

`body.view-grid` / `body.view-focus` controls which of `#grid-view` and `#focus-view` shows.

- [ ] **Step 1: Write `styles.css`.**
  - The tokens from Global Constraints as `:root` custom properties; `body` background `var(--bg)` with a faint grid (`background-image` linear gradients) and a radial vignette.
  - Header and dock are flex rows. The dock uses grouped `fieldset`-style boxes labelled Incidents / Network / Greenwave / Sim.
  - Pills: rounded, `go` border when healthy, `stop` when failed or off, `wait` when links are cut (n > 0).
  - `#grid-view` is a 3-column CSS grid. `#focus-view` is a 2-column grid: map ~62%, scoreboard ~38%.
  - Map containers are square (`aspect-ratio: 1`) and size to the available height/width.
  - Scoreboard numbers at least 40 px at 1920×1080 (`font-size: clamp(24px, 3.2vw, 56px)`).
  - `@media (prefers-reduced-motion: reduce)` disables transitions and animations.
- [ ] **Step 2: Write `index.html`** with the DOM above. Link `styles.css` and load `main.js` as a module. No inline styles.
- [ ] **Step 3: Rewrite `main.js`** around `panels`, `ui`, `broadcast` and `actions`.
  - Keep `simStep` and the frame cap exactly as they are.
  - Temporarily keep the existing per-panel drawing code, pointed at the three grid canvases, sized to their containers with device-pixel-ratio scaling. Task 3 replaces it.
  - **Keyboard:** one `keydown` listener mapping the shortcuts to `actions`. It returns early if `document.activeElement` matches `input, select, button, textarea`, or if `e.ctrlKey || e.altKey || e.metaKey`.
  - `toggleMessages` broadcasts `setMessaging` to the Greenwave panel only, as the current code does.
  - `reset` keeps `ui.view`, `ui.focus` and `ui.speed`, and resets `ui.messagesOn = true`.
- [ ] **Step 4:** Run `npm test`. Expected: all pass. Run `node --check src/display/main.js`. Expected: no output.
- [ ] **Step 5: Manual check in Chrome** at `http://localhost:8080/` (restart `npm run serve` if it isn't running):
  1. Every dock button works.
  2. Every shortcut works.
  3. With the speed select focused, pressing `F` does **not** fail central.
  4. The pills change with fail central, cut all and messages off.
  5. The cars still move on all three maps.

  Take a screenshot.
- [ ] **Step 6:** Commit: `feat: control-room shell with status pills, grouped dock and keyboard shortcuts`.

---

### Task 3: Map renderer

**Files:**
- Create: `src/display/map-renderer.js`
- Modify: `src/display/main.js` (replace the temporary drawing; add hover)

**Interfaces:**
- Consumes: `junctionPos`, `dirVec`, `DIRS`, `PHASE_OF`, `WORLD_SIZE` from `../world/grid.js`; snapshot shape (`junctions`, `cars` with `stopped`, `links`, `messages`, `messaging`).
- Produces: `createMapRenderer(canvas) → { resize(), draw(snapshot, opts), toWorld(clientX, clientY) → { x, y } }`
  - `opts = { showMessages: bool, hoverLink: { a, b } | null, time: ms, reducedMotion: bool }`
  - `resize()`:
    - sets `canvas.width/height = cssSize × devicePixelRatio`
    - computes the uniform scale `px per metre = cssSize / WORLD_SIZE`
    - rebuilds the offscreen static layer: background, grid and roads
  - `toWorld` converts client coordinates to world metres using the current transform. `main.js` feeds it to `linkAt`.
- Ruling vs spec §5: the spec lists only `resize` and `draw`. `toWorld` is added so hit-testing follows resizes (Review Focus 1).

**Draw order, per spec §4:**
1. Static layer blit.
2. Comms links:
   - up: `data` 1.5 px
   - cut: `stop` 3 px dashed `[8,6]`, plus a 6 px ✕ at the midpoint
   - `messaging === false`: `#4a5a78` dotted `[2,5]`
   - hovered: width ×2 and full alpha
3. Junction plates: 22 m rounded squares in `panel`.
4. Signals per approach:
   - lit: 14 m bar in `go`, `shadowBlur` 10 with `shadowColor` `go`
   - not lit: 6 m bar in `stop`, no blur
5. Orphaned junctions: `wait` outline whose alpha pulses `0.5 + 0.5·sin(time/300)` (static 1 if `reducedMotion`), plus a "TIMER" label in 9 px muted text.
6. Messages, if `showMessages`:
   - PLATOON: a 3 m `data` dot at `age` along a→b
   - PRIORITY: a 5 m `siren` dot with a 3-dot fading trail behind it
7. Cars:
   - 3 m dots, `wait` if stopped, else `#9fb3d1`
   - ambulance:
     - 80 m dashed ring in `siren` at 0.35 alpha
     - halo of radius 12 m alternating `siren` / `#4d7cff` every 250 ms (static `siren` if `reducedMotion`), `shadowBlur` 16
     - 5 m white core

**Hover tracking in `main.js`:**
- `mousemove` on each map canvas → `toWorld` → `linkAt(x, y, snapshot.links, 10 px ÷ pxPerMetre)`.
- Store `{ panelIndex, link }`; draw the hover only on that canvas.
- Clicks reuse the same lookup and broadcast cut/restore to every world.
- `resize()` runs for every visible renderer on `window.resize`, and on view switch (Task 4).

- [ ] **Step 1: Implement `map-renderer.js`.**
- [ ] **Step 2: Wire it into `main.js`.**
  - Create three renderers for the grid canvases.
  - Delete the temporary drawing code.
  - Compute `reducedMotion` once via `matchMedia('(prefers-reduced-motion: reduce)')`, updating it on `change`.
- [ ] **Step 3:** Run `npm test` and `node --check src/display/main.js src/display/map-renderer.js`. Expected: all pass, no output.
- [ ] **Step 4: Manual check in Chrome.**
  1. Spawn the ambulance: siren ring and alternating halo are visible.
  2. Queues show amber.
  3. Cut a link by clicking: red dash and ✕ appear in all three panels.
  4. Hovering highlights the link.
  5. Fail central: TIMER outlines appear on Central.
  6. Messages off: Greenwave's links turn dotted.
  7. Show messages: cyan and red pulses move.
- [ ] **Step 5: Manual Review Focus checks.**
  1. Resize the window narrower, then wider: maps re-fit and stay crisp at DPR 1.65, and click-to-cut still hits the link under the cursor.
  2. Watch for 30 s at 3×: no visible stutter. Optionally log the average frame time over 5 s; expect under 16 ms.
- [ ] **Step 6:** Commit: `feat: control-room map renderer with link hover, siren ring and message pulses`.

---

### Task 4: Grid/focus views and comparison scoreboard

**Files:**
- Create: `src/display/scoreboard.js`
- Modify: `src/display/demo-rules.js`, `src/display/main.js`
- Test: `test/demo-rules.test.js`

**Interfaces:**
- Produces:
  - `bestIndex(values: (number|null)[]) → number|null` in `demo-rules.js`
  - `scoreboard.js`:
    - `renderScoreboard(tableEl, snapshots: Snapshot[3], labels: string[3])`
    - `renderStatStrip(el, snapshot, highlight: { amb: bool, stops: bool, wait: bool })`
- **Row values:**
  - **Ambulance:** `journey` when `state !== 'none'`, else `null`. Display "—" when null; append " …" while driving; secondary text "stopped N s".
  - **Stops:** `rollingStopsPerCar`, `null` when `exited === 0`. Secondary text: overall `stopsPerCar`.
  - **Wait:** `rollingWait`, `null` when `exited === 0`. Secondary text: overall `avgWait`.
  - **Conflicts:** `conflicts`. Rendered in `go` when 0, `stop` otherwise. Not part of best-value highlighting.
- **Highlight:** the cell at `bestIndex(row)` gets class `best` (`go` colour plus glow) in rows 1–3.
- **Rendering performance:** `renderScoreboard` and `renderStatStrip` update `textContent` and `className` only when the value changes. Cache the last rendered string per cell.

- [ ] **Step 1: Write the failing tests** in `test/demo-rules.test.js`:

```js
import { bestIndex } from '../src/display/demo-rules.js';
test('bestIndex: lowest value wins', () => assert.equal(bestIndex([57.1, 106, 58.7]), 0));
test('bestIndex: ties go to the first index', () => assert.equal(bestIndex([2, 1.5, 1.5]), 1));
test('bestIndex: nulls are ignored', () => assert.equal(bestIndex([null, 3, 2]), 2));
test('bestIndex: all null gives null', () => assert.equal(bestIndex([null, null, null]), null));
```

- [ ] **Step 2:** Run `npm test`. Expected: FAIL (`bestIndex` is not exported).
- [ ] **Step 3: Implement `bestIndex`.** Run `npm test`. Expected: all pass.
- [ ] **Step 4: Implement `scoreboard.js`** and wire the views into `main.js`.
  - `toggleView` and `setFocus(i)` set `body.view-grid` / `body.view-focus` and `.focus-tabs .active`, then call `resize()` on the newly visible renderer(s).
  - A fourth renderer draws on `#focus-canvas`. Each frame it draws `panels[ui.focus].world.snapshot()`.
  - Hover and click on `#focus-canvas` use the focused world's links, and click still broadcasts to all worlds.
  - Each frame takes **one** snapshot per world and passes it to the map renderers, the scoreboard (focus view) or the stat strips (grid view), and the header. Only visible renderers draw.
- [ ] **Step 5:** Run `npm test` and `node --check` on the changed display files. Expected: all pass.
- [ ] **Step 6: Manual check in Chrome.**
  1. `V` toggles views without the sim clock resetting.
  2. `1`/`2`/`3` switch the focused map.
  3. Scoreboard numbers are readable from 2 m. At 1920×1080 the numbers are at least 40 px; check with `getComputedStyle`.
  4. The best values are highlighted.
  5. **Review Focus 2:** in focus view on Greenwave, click a link. The cut appears in Greenwave and (after switching tabs) in Central and Fixed.

  Take screenshots of both views at 1920×1080 and 1366×768 (use `resize_window`).
- [ ] **Step 7:** Commit: `feat: grid and focus views with comparison scoreboard`.

---

### Task 5: Event toasts, reset safety and final pass

**Files:**
- Create: `src/display/toasts.js`
- Modify: `src/display/demo-rules.js`, `src/display/main.js`
- Test: `test/demo-rules.test.js`

**Interfaces:**
- Produces:
  - `detectEvents(prev, now)`, where `prev`/`now` are `[{ label, state, journey }]` (one per panel, same order). Returns `[{ type: 'arrived', label, journey }]` for each index whose state went from `'driving'` to `'arrived'`. Returns `[]` when `prev` is `null`.
  - `showToast(text, { reducedMotion })` in `toasts.js`: appends to `#toasts`, keeps at most 3 (the oldest is removed), and removes each after 3000 ms. Fade via a CSS class, skipped when `reducedMotion`.
- **Toast triggers in `main.js`:**
  - `actions.failCentral` → "Central controller failed"
  - `cutAll` / `restoreAll` → "All links cut" / "All links restored"
  - link click → "Link a–b cut" / "Link a–b restored"
  - `toggleMessages` → "Greenwave messages OFF" / "Greenwave messages ON"
  - `spawnAmbulance`, when allowed → "Ambulance dispatched"
  - each frame, `detectEvents(prevAmb, nowAmb)` → "Ambulance arrived: <label> <journey 1 dp> s", then `prevAmb = nowAmb`
  - `reset` sets `prevAmb = null`, so no spurious arrival toast (Review Focus 3)

- [ ] **Step 1: Write the failing tests:**

```js
import { detectEvents } from '../src/display/demo-rules.js';
const A = (state, journey = 0) => ({ label: 'Greenwave', state, journey });
test('detectEvents: driving -> arrived gives one event', () =>
  assert.deepEqual(detectEvents([A('driving', 50)], [A('arrived', 58.7)]), [{ type: 'arrived', label: 'Greenwave', journey: 58.7 }]));
test('detectEvents: none -> driving and arrived -> arrived give none', () => {
  assert.deepEqual(detectEvents([A('none')], [A('driving', 1)]), []);
  assert.deepEqual(detectEvents([A('arrived', 58.7)], [A('arrived', 58.7)]), []);
});
test('detectEvents: two modes arriving together give two events', () =>
  assert.equal(detectEvents([A('driving'), A('driving')], [A('arrived', 57), A('arrived', 74)]).length, 2));
test('detectEvents: null prev (after reset) gives none', () =>
  assert.deepEqual(detectEvents(null, [A('arrived', 58.7)]), []));
```

- [ ] **Step 2:** Run `npm test`. Expected: FAIL (not exported).
- [ ] **Step 3: Implement `detectEvents`.** Run `npm test`. Expected: all pass.
- [ ] **Step 4: Implement `toasts.js`** and wire the triggers. Toast styling lives in `styles.css`: `panel` background, a left border coloured by kind (`stop` for failures and cuts, `go` for restores and arrivals, `data` for messages), and a 300 ms fade.
- [ ] **Step 5:** Run `npm test` and `node --check` on the display files. Expected: all pass.
- [ ] **Step 6: Final pass in Chrome** at 1920×1080, running the full demo script:
  1. 20 s of traffic.
  2. `F`: toast appears; Central shows TIMER outlines.
  3. `A`: ambulance in all three panels.
  4. Click three links on its route, then `C`.
  5. The arrival toasts list each mode's time.
  6. `M`: Greenwave's stops per car (last 60 s) rises within a minute.
  7. `Shift+R`: no arrival toast appears after the reset; the view and tab are kept.

  Confirm conflicts are 0 throughout. Take screenshots of both views.
- [ ] **Step 7:** Commit: `feat: event toasts and final visual pass`.

---

### After this plan

Run the final whole-branch review, then merge `feat/visual-design` into `main` and push, as with the simulation.
