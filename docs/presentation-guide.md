# Greenwave: the presenter's guide

What this guide gives you:

- the problem Greenwave solves, how it works and why it was built this way
- how it answers the **Composition** theme and the **Neptune North** challenge
- exact numbers to quote, a demo script, and answers to likely judge questions

Every figure here comes from the real code and real runs. Nothing is invented. Where something is a limitation, the guide says so and gives you an honest answer for it.

---

## 1. The 30-second pitch

> City traffic lights depend on a central computer. When that computer or its network fails, every junction drops to a dumb fixed timer: traffic backs up and ambulances sit at red lights.
>
> **Greenwave removes the centre.** Each junction is its own small agent. It sees only its own sensors and talks only to the four junctions next to it. They tell each other "a group of cars is coming your way", which creates green waves. They pass an ambulance's request ahead of it hop by hop, clearing a green corridor.
>
> Cut any link, or all of them, and nothing collapses. Each junction keeps deciding for itself. City-wide flow is **composed** from purely local decisions: an orchestra with no conductor.
>
> When the central controller fails, Greenwave gets the ambulance across the city in **57 seconds instead of 106**, and halves the average car wait. With every communication link cut, it still does.

---

## 2. The problem

### The real-world situation

- **Most city signals are centrally coordinated.** A central system collects detector data, decides timings, and sends them out over a network. Examples of this kind of adaptive control are SCOOT in the UK and SCATS in Australia.
- **The centre is a single point of failure.** If the server or the communications network fails, junctions typically fall back to pre-set fixed-time plans or isolated operation. These timers don't react to actual traffic.
- **The cost of failure:**
  - queues build because greens go to empty roads while full roads sit on red
  - emergency vehicles lose time at red lights, because nobody is clearing a path for them

### What we set out to prove

You *can* get coordination without a coordinator:

1. Junctions that see only local information can still beat fixed timers by a wide margin.
2. Talking to neighbours adds measurable coordination (green waves).
3. When communications fail, the system **degrades gracefully** instead of collapsing.
4. Safety (never two conflicting greens) is guaranteed locally, with no one checking from above.

---

## 3. The theme: Composition

Use these three angles. The first is the headline; the other two show depth.

1. **Behaviour is composed (the headline).**
   - No component knows what a "green wave" or an "ambulance corridor" is.
   - Each junction runs one small rule set: serve the busier direction, listen to forecasts from neighbours, give way to an ambulance.
   - Green waves and corridors **emerge** from 16 copies of that rule set, each talking only to its neighbours.
   - That's the orchestra with no conductor: each musician listens to the people next to them, and the music still holds together.

2. **The system is composed of interchangeable parts.**
   - The program is three layers that snap together:
     1. a pure **junction brain**
     2. a **world** (roads, cars, links)
     3. a **display**
   - The *same* brain runs in three places:
     - inside a Web Worker (live demo)
     - inside a deterministic test harness
     - later, on a microcontroller in the physical model
   - Swap the controller and the same world runs Central, Fixed or Greenwave.

3. **Decisions are composed over time.** Each junction composes its decision from:
   - what its sensors see now (queues)
   - what its neighbours say is coming (forecasts)
   - what is urgent (ambulance priority)

   These are layered by a simple scoring rule, with a safety layer underneath that can never be overridden.

---

## 4. The sponsor challenge: Neptune North

> *Design systems that work together in a distributed way, even when communications are interrupted, with no central hub giving instructions.*

| Requirement | How Greenwave meets it | Evidence you can show |
|---|---|---|
| **Work together** | Junctions share PLATOON forecasts that create green waves, and pass PRIORITY requests that clear ambulance corridors. | Turn messages off (`M`): stops per car rises about 25%. Turn on "Show messages" (`O`): pulses travel between junctions. |
| **Distributed** | 16 independent agents, **one Web Worker (separate thread) per junction**. Each runs its own decision loop on its own timer. | DevTools shows 16 worker threads named `junction-0` … `junction-15`. |
| **No central hub** | No code anywhere decides lights for Greenwave junctions. The world only carries messages and sensor readings; it never chooses a light. | The code: `src/brain/junction.js` is the only thing that picks a Greenwave light. |
| **Works when comms are interrupted** | Lost messages simply never arrive. The junction's decision rule loses its forecast term and becomes purely local; there is no mode switch to fail. The ambulance falls back to the siren detector. | Cut all links (`C`) mid-run: Greenwave keeps running, and its ambulance still arrives without stopping. |
| **Judges will probe independence** | An automated test **fails the build** if the brain imports anything outside its own folder, or uses randomness, clocks, timers or browser globals. | `test/brain-isolation.test.js`, and the brain's interface (§6.2). |

**The line to use:** *"There is literally no code path from one junction's decision to another's except a message over a link. If the link is cut, the message is gone. That's the test the judges care about, and we enforce it automatically."*

---

## 5. Architecture: three layers

```
┌──────────────────────────────────────────────────────────────┐
│ DISPLAY  (src/display)       draws snapshots, sends commands │
│   main.js · map-renderer.js · scoreboard.js · toasts.js      │
└──────────────▲───────────────────────────────┬───────────────┘
        snapshot() (read-only)       commands (cut link, fail central…)
┌──────────────┴───────────────────────────────▼───────────────┐
│ WORLD  (src/world)        physics, sensors, links, metrics   │
│   roads · cars · seeded traffic · the "wire" between junctions│
└──────────────▲───────────────────────────────┬───────────────┘
      lights + outgoing messages         sensor readings + inbox
┌──────────────┴───────────────────────────────▼───────────────┐
│ JUNCTION BRAIN  (src/brain)      pure decision logic, ×16     │
│   step(state, inputs) → { state, lights, outbox }            │
└──────────────────────────────────────────────────────────────┘
```

**Why three layers?**

- **Portability.** The brain must later run on microcontrollers in a physical model, so it can't depend on a browser. It's pure logic: data in, data out.
- **Testability.** The world runs headless, without a screen, and is seeded. So the same traffic replays identically, and tests can run thousands of simulated seconds in about a second.
- **Honesty of the demo.** The display only *draws* what the world reports. What you see is what the simulation did, not an animation.

### Who decides what

| Component | Decides | Never does |
|---|---|---|
| Junction brain | Its own light (`NS`, `EW` or `ALL_RED`) and the messages it sends | Read another junction's state, or anything global |
| World | Where cars are, what sensors read, whether a message gets through a link | Choose any light |
| Controller (Central / Fixed / Greenwave host) | Runs its decision-maker and applies the lights | Greenwave's host doesn't decide; it only relays |
| Display | What to draw | Change the simulation, except through commands |

---

## 6. The junction brain (`src/brain/`)

This is the heart of the project. Know this section well.

### 6.1 Signals and phases

- Each junction has **two phases**:
  - `NS`: north–south traffic gets green
  - `EW`: east–west traffic gets green
- Between them is **`ALL_RED`**: every approach red.
- Turning cars go on their own approach's green, and roads are single lane each way.

**Why two phases?** It's the simplest model that still has real conflicts to manage, and it keeps the brain small enough to port to a microcontroller. Protected turn phases add complexity without changing the story.

### 6.2 The interface: what makes it independent

```
step(state, inputs) → { state, lights, outbox }

inputs  = { now, queues:{N,E,S,W}, departures:{N,E,S,W}, inbox:[messages], sirenNear }
outputs = { lights: 'NS' | 'EW' | 'ALL_RED', outbox: [{ to: 'N'|'E'|'S'|'W', msg }] }
```

**Inputs:**
- `queues`: how many cars are stopped within 60m of each stop line (its own sensors).
- `departures`: how many cars just left through each exit (its own loop detectors).
- `inbox`: messages that arrived from neighbours.
- `sirenNear`: which approach an ambulance siren is heard on (within 80m), if any.

**Outputs:**
- `lights`: exactly **one value**, so two conflicting greens literally cannot be expressed.
- `outbox`: messages addressed only by **direction** (north, east, south, west).

**Things to point out to judges:**

- The brain does not know its own ID, its grid position, how big the city is, or who its neighbours are. It only knows "the junction to my north".
- It is a **pure function**: the same state and inputs always give the same result. It uses no clock, no randomness and no global variables, and the isolation test enforces that.
- The state is tiny:
  - the current signal
  - a list of forecasts
  - the current ambulance priority
  - recently seen message IDs

  It fits easily on a microcontroller.

### 6.3 The safety state machine (`phases.js`)

These rules are applied *before* anything else and cannot be bypassed:

| Rule | Value | Why |
|---|---|---|
| Green only ever changes to `ALL_RED` | — | A direct green→green switch is impossible |
| `ALL_RED` lasts at least | **2 s** | A car takes 1.5 s to cross the junction, so the box is empty before the other direction goes |
| Minimum green | **6 s** | Stops rapid flickering that would waste time and confuse drivers |
| Maximum green | **45 s** (if anyone is waiting the other way) | Nobody is starved forever |

**Safety is guaranteed in two independent ways:**

1. **By construction:** the brain can only output one phase, and the state machine forces all-red between greens.
2. **By physical observation:** the world separately counts a **conflict** whenever it sees:
   - a direct green-to-green change, or
   - cars from both directions inside the same junction box at once

   That counter is on screen, and it has been **0 in every test, every mode, every cut pattern and every live run**.

### 6.4 How a junction decides (every 0.25 s)

**Step 1: Is an ambulance coming?** If a priority request is active, give green to the ambulance's approach immediately. The minimum green is skipped, but never the all-red. Details are in §7.2.

**Step 2: Otherwise, max-pressure scoring.**

```
score(phase) = cars queued on that phase's approaches
             + Σ forecast cars × weight(how soon they arrive)
```

- **The forecast weight:**
  - 1 if the cars arrive within 5s
  - fading to 0 at 15s
  - far-off forecasts count less
- **The switching rule:**
  - switch when the other phase's score beats the current one by **more than 2**, and minimum green has passed
  - also switch at 45s if anyone at all is waiting the other way

**Step 3: Tell the neighbours.** For every car that just left towards a neighbour, send that neighbour a PLATOON forecast: "*n* cars reaching your west approach in about 10s". That's 120m between junctions at 12 m/s.

**Why "max-pressure"?** It's a well-known decentralised signal-control idea: serve whichever direction has more demand. It needs only local information, it's simple to reason about, and it's easy to port. The margin of 2 adds **hysteresis**, so the junction doesn't flip-flop when demand is nearly equal.

### 6.5 Approaches we rejected (and why)

| Alternative | Why not |
|---|---|
| **Fixed cycles with negotiated offsets** (the textbook green wave) | Junctions agree time offsets so greens line up along a corridor. It adapts slowly to real traffic. When links are cut, the offsets drift and need re-negotiation logic, and that is exactly where it would fail. |
| **Machine learning / reinforcement learning** | Couldn't be trained and validated in a hackathon. Judges can't inspect *why* it decided something, and safety would be much harder to argue. |
| **A central optimiser with backups** | That's still a centre. Moving the single point of failure isn't removing it. |

Max-pressure plus forecasts degrades **gracefully**. When a link is cut, the forecast term just becomes zero and the junction is a pure local controller. No failure mode needs detecting, so there's nothing to get wrong.

---

## 7. Neighbour messages

### 7.1 PLATOON: "cars are coming your way" (green waves)

- **When it's sent:** whenever a junction lets cars through towards a neighbour.
- **Contents:** `{ approach, count, etaSec }`.
- **What the receiver does:** adds the cars to its score for that approach, weighted by how soon they arrive. It may go green *just before* the group arrives, so the group doesn't have to stop.
- **The result:** green waves form without anyone planning them.

**Measured effect** (5 seeds, 600s, default traffic):

| | Stops per car | Avg wait |
|---|---|---|
| Greenwave, messages on | **1.61** | **12.9 s** |
| Greenwave, all links cut | 2.16 | 15.1 s |

That's about **25% fewer stops** and about 15% less waiting, purely from neighbours talking.

### 7.2 PRIORITY: the ambulance corridor

**1. The first junction is told directly.**
- The ambulance radios its **first** junction directly, with a short-range radio request, when it is within 200m.
- The request carries the ambulance's remaining route as directions, e.g. `[E, E, S, E, E]`.

**2. The request is forwarded hop by hop.** A junction that receives a request:
- records priority for the ambulance's approach, as an absolute arrival time
- forwards it to the next junction on the route
- adds 10s to the arrival estimate and removes one step from the route
- stops forwarding after **3 hops**, so it doesn't clear the whole city too early

**3. The junction switches.** It acts once the ambulance is **within 15s**. It switches to the ambulance's approach, skipping minimum green but never all-red.

**4. The corridor rolls forward.** When the siren passes, so the ambulance has crossed, the junction:
- clears its priority
- sends a fresh request onward with an updated arrival time

**5. Safety nets:**
- Duplicate messages are ignored, using an ambulance ID plus sequence number.
- Stale messages are dropped.
- Priority times out 20s after the expected arrival, so a lost ambulance can't freeze a junction forever.

**When links are cut,** the request stops at the gap. The next junction falls back to its own **siren detector** (80m, about 6.7s of warning). That's enough to go through all-red and turn green before the ambulance arrives.

### 7.3 Why only the *first* junction gets the radio request

- The original spec had the ambulance radio *every* junction directly as it approached.
- With 120m blocks and a 200m radio range, every junction would always get a direct radio warning.
- So hop-by-hop forwarding *and* the siren fallback would never matter: dead code that contradicts the design.
- Radioing only the first junction makes the corridor genuinely distributed.

### 7.4 Being honest about the corridor

- **The finding.** In our model, the corridor doesn't make the ambulance measurably faster than the siren fallback. With all links cut, Greenwave's ambulance still arrives in about 57s with zero stopped time. We measured why: in every mode, the ambulance is never held at a red light. Any time it loses comes from cars ahead of it, never from signals.
- **How to frame it:** "The corridor is the first line of defence; the siren is the second. Our results show that even when the first line is cut completely, the second keeps the ambulance moving. That's resilience: losing communication costs the ambulance nothing."
- **Why the siren is enough:** cars in the model accelerate instantly, so a queue clears almost immediately once the light changes. With realistic acceleration, early warning would matter more. See §12.

---

## 8. The world (`src/world/`)

### 8.1 The city

- **Grid:** 4×4 junctions, 120m apart, plus 120m entry and exit roads at the edges. The whole world is 600m × 600m.
- **Cars:** 16 entry points. Each car gets a route at spawn: mostly straight, sometimes left or right, never a U-turn.
- **Movement:**
  - cruise at 12 m/s (about 27 mph)
  - keep a 7m gap
  - stop at the line on red
  - once in the junction box, always finish crossing (1.5s)
- **Blocking:** a car won't enter the junction if its exit road is full, so the junction itself never gets blocked.
- **The ambulance:** follows the same rules. It obeys signals and can't overtake, so its journey time honestly reflects how well the signals served it.

### 8.2 Identical traffic in every panel (determinism)

- At start-up, a seeded random generator (`mulberry32`) builds the **entire spawn schedule up front**: every car, when it appears, and its route.
- All three panels read the same schedule, so they face **exactly the same demand**.
- Nothing that happens in the simulation can change the schedule. A red light in one panel can't change which cars appear.
- Tests check that the same seed gives the **same result**, snapshot-for-snapshot, in every mode.

### 8.3 Links: the wire between junctions

- There are 24 links, one between each pair of adjacent junctions.
- A message over an up link arrives after a short delay (0.05s). Over a cut link it's silently dropped.
- Messages already in flight when a link is cut are dropped too.
- Restoring a link doesn't replay lost messages, just like a real network.
- **Greenwave messages off** (`M`) drops every neighbour message for the Greenwave panel only, without touching which links are up. A test proves it behaves exactly like cutting every link.

### 8.4 Sensors: all local

| Sensor | Reads |
|---|---|
| Queue detector | Cars stopped within 60 m of the stop line, per approach |
| Departure counter | Cars leaving through each exit since the last reading |
| Siren detector | Whether the ambulance is within 80 m on an approach |

---

## 9. The three modes (baselines)

| Panel | What it does | Why it's there |
|---|---|---|
| **Central** | One optimiser with **perfect, instant knowledge** of every car and the ambulance's full route. It pre-clears every junction ahead of the ambulance. It reaches junctions over the same link mesh from a hub at the top-left junction. | The honest strong baseline: what today's best-case central system looks like *while it works*. |
| **Fixed (central failed)** | A 30s NS / 2s all-red / 30s EW / 2s all-red cycle, all junctions in sync. | What cities fall back to when the centre fails. |
| **Greenwave** | 16 independent agents, one Web Worker each, talking only to neighbours. | Our system. |

**How Central fails:**
- **Fail central** (`F`) takes the controller down, and every Central junction drops to fixed timers. You'll see the amber **TIMER** outlines appear.
- Cutting links can also orphan Central junctions. A junction with no path back to the hub drops to its timer.
- A mesh is redundant, so single cuts barely hurt Central, but cut enough links and whole regions go dark.

**Why make Central honest (even better than us when working)?** Judges respect a fair comparison. Our claim isn't "we beat a working central system". It's: **"we come close to a working central system, and we don't fall over when it would."**

---

## 10. Results to quote

Averages over 5 seeds, ambulance dispatched at t = 120s, 600s simulated, default traffic:

| Mode | Ambulance journey | Avg car wait | Stops per car | Conflicting greens |
|---|---|---|---|---|
| Central (working) | 57.3 s | 11.8 s | 1.31 | 0 |
| Central **failed** → fixed timers | **106.2 s** | **29.5 s** | ≈1.64 (same timers as Fixed) | 0 |
| Fixed timers | 106.0 s | 29.4 s | 1.64 | 0 |
| **Greenwave** | **57.1 s** | **12.9 s** | 1.61 | 0 |
| **Greenwave, all links cut** | **57.1 s** | **15.1 s** | 2.16 | 0 |

**What to say:**

- "When the central system fails, the ambulance takes **106 seconds** on fixed timers. On Greenwave it takes **57**, and it's still 57 **with every link cut**."
- "Car waiting time roughly **halves**: 29 seconds down to 13."
- "We get within about a second of a working central system's wait time, with no centre at all."
- "Neighbour messages cut stops per car by about a quarter (Greenwave on vs off)."
- "Zero conflicting greens, ever."

**Two things to know about the numbers:**

- **Stops per car does not beat fixed timers.** Fixed timers hold 30-second greens, so cars stop *less often* but wait much *longer* each time (29s vs 13s). Use stops per car to compare **Greenwave with messages on versus off**. Use **ambulance time and average wait** to compare against fixed timers. On the scoreboard, the stops row often highlights Fixed or Central. That's expected, so don't be caught out by it.
- **Live demo numbers vary slightly.** The live Greenwave panel runs real asynchronous workers, so its figures vary a little from run to run. One live run gave 57.4s against 77.0s. The table above comes from the deterministic test host.

---

## 11. The demo

### 11.1 The screen

- **Header:**
  - status pills: `CENTRAL: ONLINE/FAILED`, `LINKS CUT: n/24`, `GREENWAVE MESSAGES: ON/OFF`
  - the sim clock
  - the speed
- **Grid view:** three live maps side by side, each with a stat strip.
- **Focus view:** one large map, switched with tabs, plus a comparison scoreboard. The best value in each row glows green.
- **Map key:**

  | What you see | Meaning |
  |---|---|
  | Long green glowing bar | Green light |
  | Short red bar | Red light |
  | Amber dot | Stopped car |
  | Pale dot | Moving car |
  | White dot with red/blue halo and dashed ring | The ambulance; the ring is its 80m siren range |
  | Thin cyan line | Comms link |
  | Red dashed line with ✕ | Cut link |
  | Dotted grey line | Messages off |
  | Cyan / red pulses | PLATOON / PRIORITY messages |
  | Amber TIMER outline | Junction running on fixed timer |

- **Toasts** in the top-right announce each event, including all three ambulance arrival times.

### 11.2 Keyboard shortcuts

| Key | Action | Key | Action |
|---|---|---|---|
| `F` | Fail central | `M` | Greenwave messages on/off |
| `A` | Dispatch ambulance | `O` | Show messages (pulses) |
| `C` | Cut all links | `V` | Grid ↔ focus view |
| `R` | Restore all links | `1` `2` `3` | Focus Central / Fixed / Greenwave |
| click a link | Cut / restore that link | `[` `]` | Slower / faster (1×, 3×, 5×) |
| `Shift+R` | Reset | | |

### 11.3 Demo script (about 2 minutes)

1. **Set the scene (20s).** "Three copies of the same city, the same cars, the same seed. Left: a working central system. Middle: what happens when it fails: fixed timers. Right: Greenwave, no centre at all."
2. **Press `F`.** "The central controller just failed." The TIMER outlines appear and Central's wait starts climbing. "This is the real-world failure mode."
3. **Press `A`.** "Ambulance dispatched in all three cities."
4. **Press `O`.** "Those red pulses are the ambulance's request, passed junction to junction ahead of it."
5. **Click links on its path, then press `C`.** "Now I'm cutting the network, all of it. Greenwave junctions can't talk to anyone."
6. **Wait for the arrival toasts.** "Greenwave: 57 seconds, never stopped. The failed central system: much longer." *Read the actual numbers from the toast.*
7. **Press `R`, wait a moment, then press `M`.** "So what does talking buy us? Turn off neighbour messages… watch stops per car rise in the next minute. That's the green wave disappearing. Turn it back on and it recovers."
8. **Press `V`, then `3`.** Show the focus view and scoreboard. "Zero conflicting greens in every panel. Safety is enforced inside each junction, not by a supervisor."
9. **If a judge asks about independence,** open DevTools and show the 16 junction worker threads.

**Before presenting:**
- Start the server with `npm run serve`, then open http://localhost:8080/.
- Rehearse once on the actual projector or 1920×1080 screen. That layout hasn't been checked on the dev laptop.
- Close heavy apps. The laptop has run low on memory before.

---

## 12. Engineering quality (for the technical judges)

- **95 automated tests** (`npm test`, Node's built-in runner, zero dependencies). They cover:
  - **safety:** a 10,000-step randomised test of the brain, plus 0 conflicts in every mode under random link cuts
  - **the ambulance:** it gets through with all links cut, within 2× free-flow time, on 5 seeds, and faster than fixed timers
  - **determinism:** same seed, same snapshot, in every mode
  - **independence:** the brain-isolation test
  - **the pitch claim:** "messages reduce stops" is a test, so a later change that broke green waves would fail the build
- **Test-driven:** every feature's test was written and seen to fail before the code was written.
- **Two hosts for one brain:**
  - **Live:** one Web Worker per junction, free-running on its own timer. That's realistic and asynchronous, but not exactly repeatable.
  - **Tests:** an in-process lockstep host. Same brain code, fully deterministic.

  So the demo is honest *and* the tests are reproducible.
- **Zero dependencies, fully offline.** Plain JavaScript modules, no build step and a 30-line static server. Nothing to download at the venue.
- **The server binds to localhost only,** so nobody on the hackathon Wi-Fi can reach it.
- **Rendering:**
  - Canvas 2D, with the static roads drawn once and cached
  - the simulation runs on a timer, separate from screen refresh, so a slow frame never slows the simulation
  - each frame advances the simulation by at most 0.1s per step, so cars can't "teleport" through red lights after a lag spike

---

## 13. Honest limitations, and how to answer them

| Limitation | What to say |
|---|---|
| Cars accelerate instantly | "A deliberate simplification. Realistic acceleration makes stops more expensive, which would make green waves *more* valuable. It's the next thing we'd add, and we've already prototyped it." |
| Two phases, single lanes, no protected turns | "Enough to model real conflicts. The brain's interface doesn't change if you add phases; only the scoring does." |
| Ambulance corridor doesn't beat the siren in our numbers | "In our model the siren fallback is good enough on its own. That's the resilience result: losing comms costs the ambulance nothing. Under heavier traffic or slower acceleration, early warning matters more." |
| Greenwave makes more stops than fixed timers when cut off | "Fixed timers stop you less often but for much longer. Our cars wait less than half as long. Stops per car shows what *talking* adds within Greenwave." |
| Under very heavy traffic, Greenwave's advantage shrinks | "Our tuning targets normal city load. Heavy saturation needs longer minimum greens, which is a parameter, not an architecture change." |
| Simulation, not hardware | "The brain is a pure function with no browser code, built to be ported to microcontrollers. That separation was a requirement from the start." |
| Only one ambulance at a time | "Messages carry an ambulance ID, so the protocol supports several; we limited the demo to one." |

---

## 14. Likely judge questions

**"Are the junctions *really* independent?"**
> Each junction runs in its own Web Worker thread. The only things it receives are its own sensor readings and messages from adjacent links. Its code can't import anything outside its folder, and can't use clocks, randomness or global state. An automated test enforces that. It doesn't even know its own position in the grid; it knows "my northern neighbour".

**"Isn't the world/main thread a hidden central controller?"**
> No. The world plays the part of physics and wires. It moves cars, reports what each junction's sensors would see, and carries messages over links that can be cut. It never chooses a light. In the physical model, that role is played by real cars, real sensors and real cables.

**"What happens when a link fails?"**
> The message is simply lost. The junction's decision rule has a term for neighbours' forecasts. With no forecasts arriving, that term is zero, and the junction becomes a pure local controller. There's no failure detection and no mode switch, so there's nothing that can fail.

**"How do you guarantee safety without a supervisor?"**
> Two ways. The junction can only output one phase at a time, so two conflicting greens can't even be represented. And every change between greens must pass through at least 2 seconds of all-red, which is longer than the 1.5 seconds a car takes to cross. The world independently watches for any car conflict inside a junction. That counter has been zero in every run.

**"Why not just make the central system more reliable?"**
> Redundancy reduces the chance of failure. It doesn't change what happens when failure comes, and a network partition can still cut junctions off. Greenwave makes failure boring: every junction already knows how to run on its own.

**"Why did you pick this algorithm?"**
> Max-pressure needs only local data and is simple to verify. Adding neighbours' forecasts gives coordination for free. It degrades smoothly when comms fail. Negotiated timing offsets break when links are cut, and machine learning couldn't be trained, verified or explained in a weekend.

**"How do you know your comparison is fair?"**
> All three cities get the identical, pre-generated traffic from the same seed. Our central baseline has perfect, instant knowledge, which is better than real systems. We beat the *failed* centre by a wide margin and come close to the *working* one.

**"Does it scale?"**
> Each junction only ever talks to four neighbours, so the work per junction is constant no matter how big the city gets. A central system has to handle every junction. Our 4×4 grid is a demo size, not a limit.

**"What would you do next?"**
> Port the brain to microcontrollers for the physical model. Add realistic acceleration. Add more signal phases. And tune minimum greens for heavy traffic.

---

## 15. File map (if you're asked to show code)

| File | What's in it |
|---|---|
| `src/brain/junction.js` | The agent: `step()`, forecasts, priority, siren, refresh |
| `src/brain/phases.js` | Safety state machine, max-pressure choice, forecast weight |
| `src/world/world.js` | Cars, sensors, links, ambulance, conflict counter, snapshot |
| `src/world/schedule.js` | Seeded traffic schedule and the ambulance route |
| `src/controllers/greenwave-workers.js` + `src/worker/junction-worker.js` | One Web Worker per junction (live demo) |
| `src/controllers/greenwave-lockstep.js` | Same brains in-process (tests) |
| `src/controllers/central.js` | The central baseline, with hub reachability |
| `src/controllers/fixed.js` | The fixed-timer fallback |
| `src/display/*` | The control-room UI |
| `test/brain-isolation.test.js` | The independence guarantee |
| `docs/superpowers/specs/` | Design specs, with every decision written down |

---

## 16. Glossary

| Term | Meaning |
|---|---|
| **Approach** | A road coming *into* a junction, named by the side it comes from (N, E, S, W) |
| **Phase** | Which directions have green: `NS`, `EW`, or `ALL_RED` |
| **All-red** | Every light red, for at least 2 s, to clear the junction before switching |
| **Max-pressure** | Serve the direction with the most waiting (and soon-arriving) cars |
| **Hysteresis** | Only switch when the other side is clearly busier, to avoid flip-flopping |
| **Platoon** | A group of cars travelling together |
| **Green wave** | Successive junctions turning green as a platoon arrives, so it doesn't stop |
| **Corridor** | A chain of junctions turning green ahead of an ambulance |
| **V2I** | Vehicle-to-infrastructure radio: the ambulance talking to its first junction |
| **Orphaned junction** | A Central-mode junction with no network path to the hub, so it runs on its timer |
| **Seed** | The number that fixes the random traffic, so a run can be repeated exactly |
| **Lockstep host** | Runs all 16 brains in a fixed order each step: deterministic, used by tests |
| **Web Worker** | A separate browser thread; one per junction in the live demo |
