# Durhack-Project-Greenwave
Website: https://nextgencoder7.github.io/Durhack-Project-Greenwave/

We are building a prpject called Greenwave for DurHack 2026. It is a browser-based simulation of a city’s traffic signals in which every junction makes its own decisions and talks only to its immediate neighbours. There is no central controller, so the system keeps working when links between junctions fail.

Real-world problem: City signals rely on a central system. When it or its network fails, junctions fall back to fixed timers, traffic backs up, and ambulances lose time at red lights.

Sponsor challenge: 
Neptune North - design systems that work together in a distributed way, even when communications are interrupted, with no central hub giving instructions.

Theme (Composition): City-wide traffic flow is composed from many small local decisions, like an orchestra with no conductor.

How it works:
A grid of junctions (start with 4×4) with cars spawning at the edges and driving routes through it.
Each junction is an independent agent with its own state. It may only read its own sensors (the queue length on each approach) and messages from adjacent junctions. No shared global state. 
Junctions tell neighbours what is coming: “a group of cars reaches you in 12 seconds”. 
Neighbours time their greens to match, which forms green waves.
An ambulance sends a priority request that passes hop by hop ahead of it, clearing a green corridor.
I can click any link to cut it, or cut all of them. A cut-off junction falls back to its own queue sensors and to “hearing” a siren within a short radius.
One safety rule is enforced locally at all times: a junction never shows two conflicting greens.
