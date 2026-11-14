# Greenwave: explained simply

This guide explains Greenwave as if you have never written a line of code. Read it top to bottom once and you will understand:

- what problem we're solving
- how the traffic lights "think"
- what every part of the website shows
- what happens when you break the boss computer or cut the wires

At the end there's a **cheat sheet of grown-up words**, so you can say the same things in the language judges expect.

---

## Part 1: The story in one minute

Imagine a small town with 16 crossroads, each with a set of traffic lights.

**Today, in real cities:** all the traffic lights are controlled by **one boss computer** in an office. The boss sees every road and tells every light when to go green. That works well, until the boss computer breaks or its wires get cut.

**When the boss breaks:** every traffic light goes back to a dumb **egg timer**: 30 seconds green one way, 30 seconds green the other way, over and over. It doesn't matter if a road is empty or has a huge queue. Cars pile up. An ambulance gets stuck at red lights.

**Greenwave's idea: get rid of the boss.** Give **every traffic light its own little brain**. Each little brain:

- **looks at its own roads** ("how many cars are waiting at me?")
- **chats only with the four traffic lights right next to it** ("hey, I just sent 5 cars your way!")
- **decides for itself** when to turn green

Nobody is in charge. Nothing can "break the boss", because there is no boss. Cut the wires between lights, and each light just carries on using its own eyes.

**The result:** with the boss broken, an ambulance crosses the town in **57 seconds with Greenwave**, compared with **106 seconds on egg timers**. And it still takes 57 seconds even when **every single wire is cut**.

---

## Part 2: The town

- **16 crossroads** in a 4 × 4 square, like a noughts-and-crosses board with an extra row and column.
- **Roads** run between them. Each road has one lane each way.
- **Cars** drive in from the edges, follow a route (mostly straight, sometimes turning), and drive out the other side.
- **One ambulance** can be sent across the town. It follows the same rules as cars: it stops at red lights and can't overtake. So how fast it gets across shows how well the lights helped it.
- **Wires (links)** connect each traffic light to its neighbours, so they can send each other messages. There are 24 wires in total.

Everything is a **pretend town on a computer**, a simulation. But it follows real-world rules: cars keep a safe gap, stop at red, and take a moment to cross the crossroads.

---

## Part 3: Each traffic light's little brain

### What a light can see

Each light can only use **its own senses**. It's like a person standing at the crossroads with their eyes and ears:

| Sense | What it notices |
|---|---|
| 👀 **Queue counter** | "How many cars are waiting at my red light on each road?" |
| 👋 **Leaving counter** | "How many cars just drove away from me, and which way did they go?" |
| 👂 **Siren ears** | "Can I hear an ambulance siren close by (within 80 metres)? Which road is it on?" |
| ✉️ **Messages from neighbours** | Notes passed along the wires from the four lights next to it |

That's all. A light **doesn't know** where it is in the town, how big the town is, or what lights far away are doing. It's like a kid in a classroom who can only whisper to the kids sitting next to them.

### How it decides: count and compare

The two directions take turns:
- **north–south** gets green, or
- **east–west** gets green.

Every quarter of a second, the light asks itself:

> "Which direction has **more cars waiting**, plus **cars my neighbours told me are about to arrive**?"

- If the other direction is **clearly busier** (more than 2 cars' worth), it switches.
- If it's nearly even, it **stays as it is**. Otherwise it would flip back and forth like a confused referee.
- It never lets anyone wait forever. After 45 seconds of green, if anyone at all is waiting the other way, it switches.

### Passing notes: how green waves happen

When a light lets cars go, it whispers to the next light down the road:

> ✉️ "**5 cars are heading your way. They'll reach you in about 10 seconds.**"

The next light adds those cars to its count. So it can **turn green just before they arrive**, and the group of cars sails through without stopping. Then that light whispers to *its* neighbour, and so on.

Nobody planned it, but you get a **green wave**: a run of lights turning green one after another as a group of cars drives along. It's like a Mexican wave in a football stadium. No one is in charge; each person just reacts to the person next to them.

### The ambulance: passing the message ahead

1. As the ambulance approaches the first light, it **radios that light**: "I'm coming, and here's my route."
2. That light **passes the message along the wire** to the next light on the route: "Ambulance coming, about 10 seconds behind me."
3. That light passes it on again, up to 3 lights ahead.
4. Each light **turns green for the ambulance just before it arrives**.
5. When the ambulance has gone past, the light **sends a fresh message ahead**, so the green path keeps rolling in front of the ambulance.

It's like a relay race, where each runner hands the baton forward before the ambulance gets there.

**If a wire is cut,** the message can't get through. But the light past the cut still has its **siren ears**: when the ambulance gets within 80 metres (about 7 seconds away), it hears the siren and turns green anyway. That's the backup plan.

### How do the lights know which way the ambulance is going?

**They don't. The ambulance tells them.** No light knows the route in advance, and no central computer plans it.

- The ambulance carries its own planned route from its satnav, as a list of turns: "east, east, south, east, east".
- It radios that list to the **first** light.
- That light reads only the **first** turn ("east"), so it knows which neighbour is next.
- It passes the message along that wire with the list one shorter: "east, south, east, east".
- Every light does the same: read your own turn, pass the rest on.

It's like a parcel with the delivery address written on it: each sorting office only reads the line meant for it. A light only ever learns "an ambulance is coming from that side, and it's going that way next". It never sees the whole route or the whole city.

**What if the driver changes route?** Say a road is blocked, or the driver takes a different turn:
- **Lights warned about the wrong road give up on their own.** If the ambulance doesn't arrive, they drop the warning 20 seconds after it was expected.
- **Warnings only go 3 lights ahead,** so only a few lights can be wrongly warned.
- **The light on the road the ambulance actually takes hears the siren** at 80m and turns green anyway.

The cost is a few lights briefly holding green for nobody. The ambulance still gets through.

### The golden safety rule

> **A light must never show green both ways at once.** That would cause crashes.

Greenwave makes that impossible in two ways:

1. **A light can only hold one choice at a time:** north–south green, east–west green, or all red. There's simply no way to say "both green".
2. **Every time it changes direction, all lights go red for 2 seconds first.** A car takes 1.5 seconds to cross the crossroads, so the middle is always empty before the other side goes.

The computer also **watches for crashes** separately, and counts them. That number is on the screen ("Conflicting greens"), and it has been **0 in every test and every run**.

---

## Part 4: What you see on the website

Open the website and you'll see this layout:

```
┌──────────────────────────────────────────────────────────────────┐
│ Greenwave  t = 32.1 s  3×        [CENTRAL: ONLINE] [LINKS CUT: 0/24]│  ← top bar
│                                  [GREENWAVE MESSAGES: ON] [Focus view]│
├────────────────┬────────────────┬────────────────────────────────┤
│   Central      │ Fixed (central │   Greenwave                    │
│   (map)        │  failed) (map) │   (map)                        │  ← three towns
│                │                │                                │
│ [numbers]      │ [numbers]      │ [numbers]                      │
├────────────────┴────────────────┴────────────────────────────────┤
│ INCIDENTS     NETWORK          GREENWAVE          SIM            │  ← buttons
└──────────────────────────────────────────────────────────────────┘
```

### The three towns

There are **three copies of the same town, side by side**. They get **exactly the same cars at exactly the same times**, so the comparison is fair. Only the way the traffic lights are run is different:

| Town | How its lights work | What it stands for |
|---|---|---|
| **Central** (left) | One boss computer that sees **everything** and controls every light. It's even given superpowers: it knows where every car is instantly, and the ambulance's whole route in advance. | Today's best-case city, **while the boss computer is working**. |
| **Fixed (central failed)** (middle) | Egg timers: 30 s green one way, 2 s all red, 30 s the other way, forever. | What a city falls back to **when the boss computer breaks**. |
| **Greenwave** (right) | 16 little brains, each deciding for itself and chatting to its neighbours. | **Our idea.** |

### What the shapes and colours on the map mean

| You see | It means |
|---|---|
| Dark grey bands | Roads |
| Small dark squares | Crossroads (where the traffic lights are) |
| **Long glowing green bar** at a crossroads | Green light for the road on that side |
| **Short red bar** | Red light for the road on that side |
| **Pale dot** | A moving car |
| **Amber/orange dot** | A **stopped** car, waiting in a queue. More amber = more waiting. |
| **White dot with a flashing red/blue glow** | The ambulance |
| **Faint dashed circle around the ambulance** | How far its siren can be heard (80 metres) |
| **Thin blue line** between crossroads | A working wire (link) |
| **Red dashed line with a red ✕** | A **cut** wire |
| **Grey dotted line** | Greenwave's messages are switched **off** |
| **Little blue dots sliding along wires** | "Cars coming your way" messages (only when **Show messages** is on) |
| **Little red dots with a tail** | "Ambulance coming" messages |
| **Orange box labelled TIMER** | In the Central town: this light has lost contact with the boss, so it's using the egg timer |

### The numbers under each town

| Box | What it means | Lower is better? |
|---|---|---|
| **Ambulance** | How long the ambulance has taken so far (it shows "…" while still driving). Underneath: how many seconds it spent **stopped**. | Yes |
| **Stops / car** | On average, how many times each car had to stop on its trip, over the last minute. Underneath: the overall average. | Yes |
| **Avg wait** | On average, how many seconds each car spent stopped, over the last minute. | Yes |
| **Conflicts** | How many times two directions had green at once. **Always 0.** | Must be 0 |

The **best number in each row glows green**. A "—" means no data yet: no car has finished a trip, or the ambulance hasn't been sent.

### The top bar

- **t = 32.1 s**: how long the pretend town has been running.
- **3×**: the speed. 3× means the town runs three times faster than real life.
- **CENTRAL: ONLINE / FAILED**: is the boss computer working?
- **LINKS CUT: 0/24**: how many of the 24 wires are cut.
- **GREENWAVE MESSAGES: ON / OFF**: are Greenwave's lights allowed to chat?
- **Focus view / Grid view**: switches the layout (see below).

### The buttons (and their keyboard keys)

| Button | Key | What it does |
|---|---|---|
| **Fail central** | `F` | Breaks the boss computer |
| **Spawn ambulance** | `A` | Sends an ambulance across all three towns at once. Only one ambulance at a time. |
| **Cut all links** | `C` | Cuts every wire in all three towns |
| **Restore all** | `R` | Fixes every wire |
| *Click a wire on any map* | — | Cuts that one wire (in all three towns). Click again to fix it. |
| **Messages: ON/OFF** | `M` | Stops Greenwave's lights chatting (Greenwave town only) |
| **Show messages** | `O` | Draws the messages as little moving dots |
| **Slower / Faster** | `[` `]` | Changes speed: 1×, 3× or 5× |
| **Reset** | `Shift+R` | Starts everything again |

### Focus view

Press `V` to swap to **focus view**:
- **one big map**, so people at the back of the room can see it
- tabs choose which town it shows: `1` Central, `2` Fixed, `3` Greenwave
- next to it, a **scoreboard** showing all three towns' numbers side by side

Press `V` again to go back to the three small maps.

### Pop-up messages

Little banners pop up in the top-right corner to say what just happened: "Central controller failed", "Link 5–6 cut", "Ambulance arrived: Greenwave 57.3 s · Central 107.4 s · Fixed 108.3 s". They disappear after 3 seconds.

---

## Part 5: What the big buttons actually do

### ⚠️ First, a common mix-up: Greenwave is *not* "the boss being down"

It's easy to think the Greenwave town is showing what happens when the boss computer breaks. **It isn't.** The Greenwave town **never has a boss computer at all**. It runs exactly the same whether you press "Fail central" or not.

| Town | Has a boss computer? | What it represents |
|---|---|---|
| **Central** (left) | Yes, until you press **Fail central** (`F`) | A normal city today. Pressing `F` *is* the "boss goes down" moment, for this town only. |
| **Fixed** (middle) | No; its boss is already broken | What a normal city looks like **after** the boss has gone down: egg timers. It's there from the start so the "broken" picture is always on screen next to the others. |
| **Greenwave** (right) | **Never had one** | A city designed so there's nothing to go down. Each light decides for itself. |

So:

- **"Fail central" only changes the Central town.** Greenwave doesn't notice, because it has nothing to fail.
- **The only thing you *can* break in Greenwave is the wires between neighbours.** You do that by cutting links (`C`, or clicking a wire) or switching messages off (`M`). The demo shows it keeps working even then.

**How to say it in the pitch:**
> "Pressing Fail central breaks the normal city. Greenwave doesn't flinch, because it has no centre to break. The only thing you *can* break in Greenwave is the wires between neighbours, so I'll cut all of those too, and it still works."

### 💥 "Fail central": breaking the boss computer

| Town | What happens | What you'll see |
|---|---|---|
| **Central** | The boss stops working. Every light drops to the **egg timer**. | Orange **TIMER** boxes appear on every crossroads. Amber queues grow. Waiting time climbs. |
| **Fixed** | Nothing changes. It was already using egg timers (it *is* "the boss has failed"). | No change. |
| **Greenwave** | **Nothing changes**, because Greenwave never had a boss. | Carries on exactly as before. |

**The point:** in a normal city, one broken computer makes the whole town dumb. In Greenwave there's no single thing to break.

### ✂️ "Cut all links" (or clicking a wire): cutting the wires

| Town | What happens | What you'll see |
|---|---|---|
| **Central** | The boss talks to the lights *through* the wires, starting from the top-left crossroads. A light that can't be reached any more loses the boss and drops to the egg timer. Cutting one wire usually doesn't matter, because messages can go the long way round. Cut enough and parts of the town go dumb. Cut all of them and the whole town is on egg timers. | TIMER boxes appear wherever the boss can't reach. |
| **Fixed** | Nothing. Egg timers don't use wires. | Red ✕ marks, but no difference in behaviour. |
| **Greenwave** | The lights **can't chat** any more. No "cars coming" notes, no "ambulance coming" notes. But **every light keeps working on its own**: it still counts its own queues and still hears sirens. | Red ✕ marks. The town keeps flowing. The ambulance still gets through, because each light hears its siren. |

**The point:** Greenwave doesn't need the wires to stay working. The wires make it **better**, not **possible**. Losing them makes it a bit worse, not broken.

### 🔇 "Messages OFF": stopping Greenwave's chatting

This does the same as cutting every wire, but **only in the Greenwave town**. The other two towns are left alone, and any wires you cut by hand stay cut.

It's the cleanest way to show **what the chatting is worth**. Watch Greenwave's **Stops / car** number over the next minute: it goes **up**, because without "cars coming" notes, the green waves stop happening and cars have to stop more often. Switch messages back on and it comes back down.

---

## Part 6: The results in plain words

Averages over 5 different days of traffic in the pretend town:

| Town | Ambulance trip | Average wait per car |
|---|---|---|
| Central, boss working | 57 seconds | 12 seconds |
| **Central, boss broken (egg timers)** | **106 seconds** | **29 seconds** |
| **Greenwave** | **57 seconds** | **13 seconds** |
| **Greenwave, every wire cut** | **57 seconds** | **15 seconds** |

What this means:

- When the boss breaks, **the ambulance takes almost twice as long** on egg timers. On Greenwave it doesn't slow down at all, **even with every wire cut**.
- Cars wait **less than half as long** on Greenwave as on egg timers.
- Greenwave is **almost as good as a perfect, working boss computer**, without having one.
- **Chatting helps:** with messages on, Greenwave cars stop about **25% less often** (1.6 stops per car instead of 2.2).
- **No crashes, ever:** conflicting greens is 0 in every run.

**⚠️ One number that can catch you out: stops per car.**
- **What you'll see:** egg timers sometimes show *fewer* stops per car than Greenwave. That row may glow green for Central or Fixed.
- **Why:** egg timers hold green for a long 30 seconds, so cars stop less *often*, but when they do stop they wait **much longer** (about 29 seconds vs 13).
- **How to use it:** compare **Greenwave with messages on vs off**. To compare against egg timers, point at **ambulance time** and **average wait**.

**Live numbers wobble a little.** The live Greenwave town runs each light separately and for real, so its numbers change slightly each run. That's normal. Read the real numbers from the pop-up banners during the demo.

---

## Part 7: The demo, step by step

Before you start:
- type `npm run serve` in the project folder
- open **http://localhost:8080/**
- close other big programs (the laptop has run low on memory before)
- try it once on the real projector

| Step | You press | You say | They see |
|---|---|---|---|
| 1 | nothing (wait 20 s) | "Three copies of the same town with the same cars. Left: a boss computer. Middle: what happens when it breaks. Right: Greenwave, with no boss at all." | Cars flowing in all three towns. |
| 2 | `F` | "The boss computer in the normal city just broke. Greenwave doesn't flinch, because it never had one." | TIMER boxes on Central; queues start growing. Greenwave carries on unchanged. |
| 3 | `A` | "An emergency: ambulance sent across all three towns." | A flashing ambulance in each town. |
| 4 | `O` | "Those little red dots are the lights warning each other that the ambulance is coming." | Red dots running ahead of the ambulance. |
| 5 | click a few wires, then `C` | "Now I'm cutting the wires. All of them. The Greenwave lights can't talk to anyone." | Red ✕ everywhere. |
| 6 | wait | "Greenwave's ambulance: 57 seconds, never stopped. The broken city: about twice as long." | Arrival banners with the times. |
| 7 | `R`, then `M` | "So what does chatting buy us? I'll switch it off… watch stops per car go up. That's the green wave disappearing." | Greenwave's stops number rises over the next minute. |
| 8 | `V`, then `3` | "And look at the bottom row: zero crashes, in every town. Every light enforces safety itself." | Big map and scoreboard. |

---

## Part 8: The theme, "Composition"

**The simple version:** a big result **built up from lots of small pieces**.

- **The orchestra with no conductor.** Each musician only listens to the people next to them, but together they play one piece of music. Each traffic light only listens to its neighbours, but together they create green waves and ambulance paths across the whole town. Nobody plans the big picture; it **emerges**.
- **The program is built from Lego-like blocks:** a little-brain block, a town block and a screen block. The *same* little-brain block works in the website, in our tests, and later in real model traffic lights built with tiny computer chips.
- **Each decision is built from layers:**
  - safety first (never two greens)
  - then "is an ambulance coming?"
  - then "which way has more cars, counting what my neighbours told me?"

---

## Part 9: The sponsor's challenge (Neptune North)

The challenge asks for systems that:

1. **work together**
2. **without a boss** giving instructions
3. **and keep working when messages can't get through**

| They asked for | Greenwave does it by… | You can prove it by… |
|---|---|---|
| Working together | Lights warn each other about cars and ambulances | Messages OFF → stops per car rises |
| No boss | Each light decides for itself; nothing else ever picks a light's colour | Each light runs as its **own separate program** on the computer (16 of them) |
| Keep working when messages fail | A light without messages just uses its own eyes and ears | Cut all wires → Greenwave carries on and the ambulance still gets through |
| (Judges will check the lights really are independent) | A test stops the program from being built if a light's brain ever peeks at anything except its own senses and its messages | Point at the test in the code |

---

## Part 10: Tricky questions, simple answers

**"Are the lights really independent?"**
> Yes. Each light runs as its own separate program. All it ever receives is what its own sensors see and notes from its four neighbours. It doesn't even know where it is in the town. We have an automatic check that fails if that's ever broken.

**"Isn't the computer running the town secretly the boss?"**
> No. That part only plays the role of the real world: it moves the cars, tells each light what its sensors would see, and carries notes along the wires. It never chooses a light's colour. In the real world, that's just roads, cars and cables.

**"What happens when a wire is cut?"**
> The note is lost, that's all. The light was adding "cars my neighbours warned me about" to its count. Now that part is zero, so it just uses its own queue counts. There's no special emergency mode that could go wrong.

**"How do the lights know the ambulance's route? In real life they wouldn't."**
> They don't know it. The ambulance does, from its satnav, and it hands the route to the first light. Each light reads just its own turn and passes the rest on. Real emergency-vehicle systems already let ambulances signal traffic lights as they approach; we pass the request on light to light. The route comes from the vehicle, not a central computer. If the driver changes plan, the wrongly warned lights time out on their own, and the light on the real road hears the siren anyway.

**"How do you stop crashes without someone checking?"**
> A light can only hold one choice at a time, so "both green" can't happen. And it always goes all-red for 2 seconds before switching, which is longer than a car needs to cross. We also count crashes separately, and it's been zero every time.

**"Why not just build a stronger boss computer?"**
> Backups make breaking less likely, but they don't change what happens when it does break. And cut wires can still cut lights off from the boss. With Greenwave, breaking things is boring: every light already knows how to cope alone.

**"Is it fair to compare?"**
> All three towns get exactly the same cars at the same times. And we gave our boss computer superpowers it wouldn't have in real life. We still come close to it while it works, and beat it easily when it breaks.

**"Would this work in a bigger city?"**
> Yes. Each light only ever talks to four neighbours, however big the city gets. A boss computer has to handle every light in the city.

**"What would you do next?"**
> Put the little brain onto real tiny computer chips in a model town. Make cars speed up gradually like real cars. Add turning arrows.

---

## Part 11: Weak spots, and how to answer honestly

| Weak spot | What to say |
|---|---|
| Cars speed up instantly (real cars take a few seconds) | "That's a simplification. Real cars take time to get moving, which makes stopping cost more. So green waves would help even more in real life." |
| The ambulance doesn't go *faster* with messages than with just siren ears | "In our town the siren backup is good enough on its own. That's the point: losing the wires costs the ambulance nothing." |
| Egg timers sometimes have fewer stops per car | "Fewer stops, but each one is much longer. Our cars wait less than half as long." |
| In very, very heavy traffic, Greenwave's lead shrinks | "We tuned it for normal traffic. Rush-hour gridlock needs longer greens, which is just a setting." |
| It's a simulation, not real lights | "The little brain was built to move onto real chips. It doesn't depend on the website at all." |
| If the ambulance turns off its planned route, the warning ahead still follows the *planned* route (our lights hear the siren but can't see which exit it took) | "Wrongly warned lights time out by themselves, and the siren backup covers the real road. A real version would add exit sensors, so each light passes the warning along the road the ambulance actually took." |
| Only one ambulance at a time | "Messages carry an ambulance name tag, so it could handle several. We kept the demo simple." |

---

## Part 12: Grown-up words cheat sheet

Use these to sound expert. Left: what you understand. Right: what to say.

| What it means | Say this |
|---|---|
| No boss computer | **Decentralised** / **no central controller** / **no single point of failure** |
| Each light has its own little brain | Each junction is an **autonomous agent** |
| Each light runs as its own separate program | **One Web Worker (thread) per junction** |
| Lights only talk to the four next to them | **Nearest-neighbour communication** |
| The wires between lights | **Communication links** |
| Cutting wires | **Simulating network partitions** / **link failures** |
| Egg timers | **Fixed-time control** / **fixed-time fallback plans** |
| Counting cars to decide who goes | **Max-pressure control** |
| Only switching if the other side is clearly busier | **Hysteresis** |
| "5 cars coming your way in 10 seconds" | A **platoon forecast** (a PLATOON message) |
| Lights turning green one after another for a group of cars | A **green wave** (an **emergent** behaviour) |
| Passing the ambulance warning ahead | A **hop-by-hop priority corridor** (a PRIORITY message) |
| The ambulance radioing the first light | **V2I**: vehicle-to-infrastructure communication |
| Ambulances telling traffic lights they're coming | **Emergency vehicle pre-emption** |
| The route travelling inside the message, each light reading its own turn | **Source routing**: the route is carried in the message |
| Siren ears as a backup | **Local siren detection fallback** |
| It gets a bit worse, not broken, when wires fail | **Graceful degradation** |
| Never two greens; 2 seconds all-red | **Locally enforced safety invariant**; **all-red clearance interval** |
| Same cars every time, so the comparison is fair | **Seeded, deterministic traffic** / **reproducible** |
| The automatic check that lights don't peek | An **isolation test** enforcing **no shared global state** |
| The little brain doesn't depend on the website | A **pure, portable** decision function, ready for **microcontrollers** |
| Big result from small pieces | **Emergent behaviour from local rules**, which is **composition** |
