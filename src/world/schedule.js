import { mulberry32 } from './rng.js';
import { N, DIRS, junctionId, neighbour, opposite, left, right } from './grid.js';

/** Junction a vehicle entering from `entry` reaches first. */
export function entryJunction({ side, index }) {
  if (side === 'W') return junctionId(index, 0);
  if (side === 'E') return junctionId(index, N - 1);
  if (side === 'N') return junctionId(0, index);
  return junctionId(N - 1, index);
}

export const AMBULANCE = { entry: { side: 'W', index: 1 }, route: ['E', 'E', 'S', 'E', 'E'] };

function makeRoute(rng, entry) {
  let j = entryJunction(entry), heading = opposite(entry.side);
  const route = [];
  while (true) {
    let exit = heading;
    if (route.length < 6) {
      const u = rng();
      if (u >= 0.7 && u < 0.85) exit = left(heading);
      else if (u >= 0.85) exit = right(heading);
    }
    route.push(exit);
    const next = neighbour(j, exit);
    if (next === null) return route;
    j = next; heading = exit;
  }
}

/** Deterministic spawn schedule for the whole run, built before simulation. */
export function buildSchedule(seed, { duration = 1800, rate = 1 / 12 } = {}) {
  const rng = mulberry32(seed);
  const all = [];
  let order = 0;
  for (const side of DIRS) {
    for (let index = 0; index < N; index++) {
      const entry = { side, index };
      const eo = order++;
      let t = 0;
      while (true) {
        t += -Math.log(1 - rng()) / rate;
        if (t >= duration) break;
        all.push({ t, eo, entry, route: makeRoute(rng, entry) });
      }
    }
  }
  all.sort((a, b) => a.t - b.t || a.eo - b.eo);
  return all.map(({ t, entry, route }, id) => ({ id, t, entry, route }));
}
