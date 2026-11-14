# Durhack-Project-Greenwave

We are building a prpject called Greenwave for DurHack 2026. It is a browser-based simulation of a city’s traffic signals in which every junction makes its own decisions and talks only to its immediate neighbours. There is no central controller, so the system keeps working when links between junctions fail.

Real-world problem: City signals rely on a central system. When it or its network fails, junctions fall back to fixed timers, traffic backs up, and ambulances lose time at red lights.

Sponsor challenge: Neptune North: design systems that work together in a distributed way, even when communications are interrupted, with no central hub giving instructions.

Theme (Composition): City-wide traffic flow is composed from many small local decisions, like an orchestra with no conductor.

How it works:

