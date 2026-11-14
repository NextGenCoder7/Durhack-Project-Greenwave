# Greenwave — Visual Design Spec

Date: 2026-11-14 · Builds on: `docs/superpowers/specs/2026-11-14-greenwave-design.md`

## 1. Goal

Turn the bare three-panel display into a "stunning but functional" control-room UI that tells the demo story clearly, both at a judging table (1–2 m from a laptop) and on a projector.

The story the UI must make obvious:
1. Central fails, and fixed timers back traffic up.
2. The ambulance still gets through Greenwave with links cut (siren fallback).
3. Cooperation buys fewer stops: turn Greenwave messages off and stops per car rises.
4. Conflicting greens are always 0.

Non-goals:
- new simulation features or behaviour changes (except the `stopped` flag, §6)
- light theme
- mobile layout
- sound

## 2. Constraints

- **Offline, zero dependencies.** No CDN, no web fonts. Uses system fonts only.
- **Display layer only reads `world.snapshot()` and sends world commands.** No simulation logic in the display.
- **Canvas 2D rendering** (decision: chosen over SVG for performance and over WebGL/Pixi for risk).
- **Must stay smooth** (no visible stutter) with three maps at 3× speed on a typical laptop.
- **Every existing control remains available:**
  - spawn ambulance, fail central, cut all, restore all
  - Greenwave messages on/off, show messages
  - speed, reset
  - click a link to cut or restore it

## 3. Views and layout

The two views draw the same three live worlds. Switching view never pauses, resets or desynchronises the simulations.

- **Grid view (default):**
  - three equal map panels side by side: Central, Fixed (central failed), Greenwave
  - each panel has a compact stat strip underneath
- **Focus view:**
  - one large map, with tabs **Central | Fixed | Greenwave** choosing which world it shows
  - beside it, the **comparison scoreboard**: one row per metric, one column per mode
- **View toggle:** a button in the header and the `V` key. Focus tabs also respond to keys `1`, `2`, `3`. Pressing a tab key in grid view switches to focus view on that tab.

**Scoreboard rows** (focus view; the grid-view stat strips show the same rows per panel), in this order:
1. **Ambulance:** journey time, a live timer while driving, "—" before the first ambulance. Shows "stopped N s" as secondary text.
2. **Stops per car (last 60 s).** Secondary text: overall value.
3. **Avg car wait (last 60 s).** Secondary text: overall value.
4. **Conflicting greens:** always rendered in `go` colour when 0, and in `stop` colour if it is ever non-zero.

In each of rows 1–3 the lowest value across the three modes is highlighted. Rows with no data yet have no highlight.

**Header bar:**
- **Left:** "Greenwave" wordmark, sim clock (`t = 123.4 s`), speed.
- **Right:** status pills:
  - `CENTRAL: ONLINE` / `CENTRAL: FAILED`
  - `LINKS CUT: n/24`
  - `GREENWAVE MESSAGES: ON` / `OFF`
  - the view toggle

**Control dock** (bottom), grouped in demo-story order. Each button shows its shortcut key.

| Group | Control | Key |
|---|---|---|
| Incidents | Fail central | `F` |
| Incidents | Spawn ambulance | `A` |
| Network | Cut all links | `C` |
| Network | Restore all links | `R` |
| Network | hint: "click any link to cut / restore it" | — |
| Greenwave | Messages on/off | `M` |
| Greenwave | Show messages (overlay) | `O` |
| Sim | Speed 1× / 3× / 5× | `[` slower, `]` faster |
| Sim | Reset | `Shift+R` |

Shortcuts are ignored while a form control (e.g. the speed select) has keyboard focus.

**Sizing:**
- Layout fills the window, and map canvases size to their containers, keeping the map square.
- Canvases render at device-pixel-ratio resolution.
- Focus-view scoreboard numbers are at least 40 px tall at 1920×1080.

## 4. Visual language (control room)

**Colour tokens** (CSS custom properties, mirrored as constants in the renderer):

| Token | Value | Use |
|---|---|---|
| `bg` | `#0b1220` | page background, faint grid and vignette |
| `panel` | `#111b2e`, border `#1f2d47` | panels, dock, scoreboard |
| `road` | `#1c2a44` | road surface |
| `text` | `#e6f0ff` | primary text |
| `muted` | `#8ea3c4` | secondary text |
| `go` | `#3dffa8` | green signals, best values, 0 conflicts (glowing) |
| `stop` | `#ff5470` | red signals (not glowing), cut links, failures |
| `wait` | `#ffb547` | stopped cars, timer-fallback junctions |
| `data` | `#38bdf8` | live comms links, PLATOON messages |
| `siren` | `#ff3355` | ambulance, PRIORITY messages |

**Typography:**
- Font stack: `Bahnschrift, "Segoe UI", system-ui, sans-serif`.
- Numbers use `font-variant-numeric: tabular-nums`.

**Map elements:**
- **Roads:** wide `road`-coloured strokes. Junctions are small rounded plates.
- **Signals:** one bar per approach on its stop line.
  - Green: long bar in `go` with glow.
  - Red: short bar in `stop`, no glow.
  - The shape differs as well as the colour.
- **Comms links:** a thin `data` line along each road between adjacent junctions.
  - **Cut:** `stop` dashed line, with a small ✕ at the midpoint.
  - **Messages off** (Greenwave world only): dim dotted line.
  - **Hover:** the link under the cursor brightens and the cursor becomes a pointer. Hit-testing uses the existing `linkAt`.
- **Cars:** small dots. Moving cars are pale steel (`#9fb3d1`); stopped cars (`stopped: true`) are `wait`.
- **Ambulance:**
  - a white core with a halo that alternates `siren` red and blue (`#4d7cff`) about twice per second
  - a faint dashed ring of 80 m radius (the siren detection range) around it
- **Message overlay** (when "show messages" is on):
  - PLATOON: small `data` pulses moving along the link.
  - PRIORITY: larger `siren` pulses with a short trail.
  - Position along the link comes from the message `age` (0–1 s).
- **Orphaned junctions** (Central world): a pulsing `wait` outline and a small "TIMER" tag.

**Event toasts:** a stack in the top-right that fades after about 3 s, with at most 3 visible at once. They appear for:
- Central failed
- link `a–b` cut / restored
- all links cut / restored
- Greenwave messages off / on
- ambulance spawned
- ambulance arrived: `Ambulance arrived: Greenwave 58.7 s · Central 75.7 s · Fixed 74.0 s`, listing whichever modes have arrived so far. It fires once per mode as each arrives.

**Motion:**
- Pulses, siren alternation and toast fades only.
- With `prefers-reduced-motion: reduce`, pulses and the siren alternation are static and toasts appear and disappear without animation.

## 5. Code structure

| File | Responsibility |
|---|---|
| `src/display/index.html` | Page shell: header, view area, scoreboard, dock, toast area |
| `src/display/styles.css` | Tokens, both view layouts, dock, scoreboard, toasts, reduced motion |
| `src/display/main.js` | Startup, sim loop (timer-driven, unchanged), command queue, keyboard shortcuts, view and tab switching, hover tracking |
| `src/display/map-renderer.js` | `createMapRenderer(canvas) → { resize(), draw(snapshot, { showMessages, hoverLink, time, reducedMotion }) }`. Caches the static road and grid layer in an offscreen canvas, rebuilt on resize |
| `src/display/scoreboard.js` | Renders the comparison table and the per-panel stat strips from the three snapshots |
| `src/display/toasts.js` | `showToast(text)` |
| `src/display/demo-rules.js` | Pure helpers: existing `canSpawnAmbulance` and `linkAt`, plus `bestIndex(values)` and `detectEvents(prev, now)` |

- **`bestIndex(values: (number|null)[]) → number | null`:** index of the lowest non-null value. `null` if all values are null. Ties go to the lowest index.
- **`detectEvents(prev, now)`:** takes per-mode ambulance states, `[{ label, state, journey }]`, and returns `[{ type: 'arrived', label, journey }]` for each mode whose state changed from `driving` to `arrived`.

Hidden canvases (grid canvases in focus view, and vice versa) are not drawn.

## 6. World change

`world.snapshot().cars[i]` gains `stopped: boolean`: the car is on an approach and its speed is below 1 m/s. That is the same threshold as the queue sensor, waiting time and stop counting. Cars in the junction box are never stopped.

## 7. Testing

**`node:test` (headless):**
- `stopped` is true for a car queued at a red light and false for a car driving through on green.
- `bestIndex`:
  - lowest wins
  - ties go to the first index
  - nulls are ignored
  - all-null returns null
- `detectEvents`:
  - driving → arrived gives exactly one event with that journey
  - none → driving, and arrived → arrived, give none
  - two modes arriving in the same call give two events
- Existing tests (84) stay green, including the same-seed snapshot tests.

**Manual, in Chrome:**
- both views at 1920×1080 and 1366×768, with screenshots
- smooth at 3× with all three maps
- every shortcut works
- hover and click-to-cut work in both views
- toasts appear
- conflicts show 0

## 8. Build order (commit after each, on branch `feat/visual-design`)

1. World `stopped` flag.
2. Shell: HTML/CSS tokens, header with status pills, grouped dock with shortcut labels, keyboard handling (existing drawing reused).
3. Map renderer: full control-room look, link hover, siren ring, message pulses, orphaned outline.
4. Views: grid/focus toggle, focus tabs, comparison scoreboard and stat strips with best-value highlighting.
5. Toasts (including `detectEvents`), resize handling, reduced motion, final Chrome pass.

Merge to `main` after a final review.
