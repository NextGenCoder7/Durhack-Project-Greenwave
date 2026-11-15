// Ambulance route planner: the presenter clicks an entry road, then junctions, then an exit road.
// Pure logic in world metres (no DOM), so it can be tested headlessly.
import { N, DIRS, STUB, junctionPos, dirVec, neighbour, opposite, left, right } from '../world/grid.js';
import { entryJunction } from '../world/schedule.js';

/** Point on the edge road stub between junction j and the world edge on side `side`. */
function stubPoint(j, side, frac = 0.5) {
  const p = junctionPos(j), v = dirVec(side);
  return { x: p.x + v.x * STUB * frac, y: p.y + v.y * STUB * frac };
}

/** The 16 entry roads, each with a clickable point halfway along its stub. */
export function entries() {
  const out = [];
  for (const side of DIRS) for (let index = 0; index < N; index++) {
    const entry = { side, index };
    out.push({ entry, ...stubPoint(entryJunction(entry), side) });
  }
  return out;
}

export function createPlanner() {
  let entry = null;        // { side, index }
  let route = [];          // exit directions, as in the schedule

  /** Walk the route so far: current junction, heading, and whether it has left the grid. */
  function walk() {
    if (!entry) return null;
    let j = entryJunction(entry), heading = opposite(entry.side);
    for (const exit of route) {
      const n = neighbour(j, exit);
      if (n === null) return { j, heading: exit, done: true };
      j = n; heading = exit;
    }
    return { j, heading, done: false };
  }

  const planner = {
    get entry() { return entry; },
    get route() { return route.slice(); },
    get started() { return entry !== null; },
    get done() { return !!walk()?.done; },

    /** Clickable targets for the next step: { kind: 'entry'|'junction'|'exit', x, y, ... }. */
    targets() {
      const w = walk();
      if (!w) return entries().map(e => ({ kind: 'entry', ...e }));
      if (w.done) return [];
      return [w.heading, left(w.heading), right(w.heading)].map(dir => {
        const n = neighbour(w.j, dir);
        return n === null ? { kind: 'exit', dir, ...stubPoint(w.j, dir) } : { kind: 'junction', dir, j: n, ...junctionPos(n) };
      });
    },

    /** Apply the nearest target within `tol` metres of (x, y). Returns the applied target or null. */
    click(x, y, tol = 45) {
      let best = null, bestD = tol;
      for (const t of planner.targets()) {
        const d = Math.hypot(t.x - x, t.y - y);
        if (d <= bestD) { bestD = d; best = t; }
      }
      if (!best) return null;
      if (best.kind === 'entry') { entry = best.entry; route = []; }
      else route.push(best.dir);
      return best;
    },

    undo() { if (route.length) route.pop(); else entry = null; },
    clear() { entry = null; route = []; },
    load(trip) { entry = { ...trip.entry }; route = trip.route.slice(); },

    /** The finished trip; an unfinished route carries straight on until it leaves the grid. */
    trip() {
      const w = walk();
      if (!w) return null;
      const out = route.slice();
      if (!w.done) {
        let j = w.j;
        while (true) { out.push(w.heading); j = neighbour(j, w.heading); if (j === null) break; }
      }
      return { entry: { ...entry }, route: out };
    },

    /** Polyline in world metres: world edge -> junction centres -> world edge (or last junction if unfinished). */
    path(trip = null) {
      const e = trip ? trip.entry : entry, r = trip ? trip.route : route;
      if (!e) return [];
      let j = entryJunction(e);
      const pts = [stubPoint(j, e.side, 1), junctionPos(j)];
      for (const exit of r) {
        const n = neighbour(j, exit);
        if (n === null) { pts.push(stubPoint(j, exit, 1)); break; }
        j = n; pts.push(junctionPos(j));
      }
      return pts;
    },

    describe() {
      if (!entry) return 'Click the road where the ambulance enters';
      const hops = route.length;
      if (planner.done) return `Route ready: ${hops} junction${hops === 1 ? '' : 's'}, edge to edge. Press Start.`;
      const n = hops + 1;
      return `Click the next ring: a junction, or an edge road to exit (${n} junction${n === 1 ? '' : 's'} so far)`;
    },
  };
  return planner;
}
