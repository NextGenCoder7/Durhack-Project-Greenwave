# Greenwave

**Traffic lights with no central brain.** Greenwave is a browser-based 3D simulation of a city in which every junction runs its own traffic lights and talks only to its immediate neighbours. Because there is no central controller, nothing central can fail, and the city keeps moving when links between junctions are cut.

Built at DurHack 2026 for the Neptune North challenge: design systems that work together in a distributed way, even when communications are interrupted, with no central hub giving instructions.

**Live demo:** https://nextgencoder7.github.io/Durhack-Project-Greenwave/

## The problem

City traffic signals usually depend on a central system. When it or its network fails, junctions fall back to fixed timers, traffic backs up, and emergency vehicles lose time at red lights.

## How it works

- **Independent junctions.** Each junction only knows its own sensors (the queue on each approach) and messages from adjacent junctions. There is no shared state.
- **Green waves.** Junctions tell their neighbours what is coming ("a group of cars reaches you in 12 seconds"), and the neighbours time their greens to match.
- **Emergency corridors.** An emergency vehicle's priority request passes hop by hop ahead of it, clearing a green corridor.
- **Resilience.** Cut any link, or all of them. A cut-off junction falls back to its own sensors and to hearing a siren within a short radius.
- **Safety.** Every junction enforces one rule locally at all times: it never shows two conflicting greens.

The demo runs three cities side by side on the same traffic: **Central** (one controller that sees everything), **Fixed** (what happens when the central system fails) and **Greenwave**.

## Running it

You need Node.js 18 or later. There are no dependencies to install.

```sh
npm run serve   # http://localhost:8080
npm test        # run the test suite
```

The server only listens on localhost. To present from another device, set `HOST=0.0.0.0`.

URL options:

| Option    | Effect                                                     |
|-----------|------------------------------------------------------------|
| `?seed=42` | Fixes the traffic, city layout and emergency-vehicle route |
| `?2d=1`    | Starts in the flat 2D map instead of the 3D view (switch any time with `D`) |

## Controls

Choose the emergency vehicle's route on the setup card, then press **Enter** to start. While the setup card is open, every other button and shortcut is locked, so the only choices are Random or Choose on map (plus Undo and Clear for a planned route). You can still drag the camera and switch between 3D and 2D (`D`), so a route can be planned on either view.

| Key | Action | Key | Action |
|-----|--------|-----|--------|
| `A` | Dispatch an emergency vehicle | `M` | Turn Greenwave messages on or off |
| `F` | Fail the central system | `O` | Show or hide messages |
| `C` | Cut all links | `V` | Switch between grid and focus view |
| `R` | Restore all links | `1` `2` `3` | Focus a city |
| `G` | Follow the emergency vehicle | `[` `]` | Slow down / speed up |
| `H` | Recentre the camera | `Shift`+`R` | Reset |
| `D` | Switch between 3D and 2D view | | |

Click any link on the map to cut it once the simulation is running. `G` and `H` move the 3D camera, so they are hidden in 2D view.

## Project layout

```
src/brain/        junction decision logic and safety state machine
src/controllers/  Greenwave, central and fixed-timer controllers
src/worker/       Web Worker host: one worker per junction
src/world/        seeded traffic simulation
src/display/      3D/2D view, setup card and scoreboard (three.js)
test/             node --test suite
```

## License

MIT. See [LICENSE](LICENSE).
