// Headless, seeded world: physics, sensors, lights, links and metrics. It never decides lights.
import { N, DIRS, SPACING, STUB, PHASE_OF, opposite, left, neighbour, junctionPos, dirVec, allLinks } from './grid.js';
import { buildSchedule, entryJunction } from './schedule.js';
import { createMetrics } from './metrics.js';

export const VMAX = 12;          // m/s
export const GAP = 7;            // m, minimum gap
export const BOX_S = 1.5;        // s to cross a junction
export const QUEUE_RANGE = 60;   // m
export const MAX_DT = 0.1;       // s
const LIGHTS = ['NS', 'EW', 'ALL_RED'];
const NJ = N * N;

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const r2 = v => Math.round(v * 100) / 100;

export function createWorld({ seed, schedule, rate } = {}) {
  const sched = schedule || buildSchedule(seed, rate ? { rate } : {});
  const metrics = createMetrics();
  // Segment index j*4 + direction index: cars on approach d of junction j, front first.
  const segs = Array.from({ length: NJ * 4 }, () => []);
  const seg = (j, d) => segs[j * 4 + DIRS.indexOf(d)];
  const boxes = Array.from({ length: NJ }, () => []);
  const departures = Array.from({ length: NJ }, () => ({ N: 0, E: 0, S: 0, W: 0 }));
  const pending = Array.from({ length: 16 }, () => []);
  const conflictActive = Array(NJ).fill(false);
  let next = 0;

  const hasRoom = s => s.length === 0 || s[s.length - 1].dist <= SPACING - GAP;

  const world = {
    now: 0,
    lights: Array(NJ).fill('ALL_RED'),
    orphaned: Array(NJ).fill(false),
    conflicts: 0,
    _schedule: sched,
    _segments: () => segs,

    setLights(j, l) {
      if (!LIGHTS.includes(l)) throw new Error(`invalid lights ${l}`);
      const prev = world.lights[j];
      if ((prev === 'NS' && l === 'EW') || (prev === 'EW' && l === 'NS')) world.conflicts++;
      world.lights[j] = l;
    },

    readSensors(j) {
      const queues = {};
      for (const d of DIRS) queues[d] = seg(j, d).filter(c => c.dist <= QUEUE_RANGE && c.v < 1).length;
      const dep = { ...departures[j] };
      departures[j] = { N: 0, E: 0, S: 0, W: 0 };
      return { now: world.now, queues, departures: dep, sirenNear: null };
    },

    trueApproaches(j) {
      const out = {};
      for (const d of DIRS) out[d] = seg(j, d).map(c => ({ dist: c.dist, v: c.v, isAmbulance: c.isAmbulance }));
      return out;
    },

    tick(dt) {
      if (dt > MAX_DT + 1e-9) throw new RangeError(`dt ${dt} > ${MAX_DT}`);
      const now = world.now;

      // 1. Spawns: schedule -> per-entry FIFO -> entry segment when there is room.
      while (next < sched.length && sched[next].t <= now) {
        const s = sched[next++];
        pending[DIRS.indexOf(s.entry.side) * N + s.entry.index].push(s);
      }
      for (let e = 0; e < 16; e++) {
        const q = pending[e];
        if (!q.length) continue;
        const s = q[0];
        const target = seg(entryJunction(s.entry), s.entry.side);
        if (!hasRoom(target)) continue;
        q.shift();
        target.push({ id: s.id, isAmbulance: false, route: s.route, hop: 0, dist: STUB, v: VMAX, waited: now - s.t, spawnT: s.t });
      }

      // 2. Junction boxes: advance crossings, release cars onto the next segment or out of the world.
      for (let j = 0; j < NJ; j++) {
        const box = boxes[j];
        for (let i = 0; i < box.length; i++) {
          const b = box[i];
          b.t -= dt;
          if (b.t > 1e-9) continue;
          box.splice(i--, 1);
          departures[j][b.exit]++;
          const nj = neighbour(j, b.exit);
          if (nj === null) { metrics.onExit(b.car, now); continue; }
          b.car.hop++; b.car.dist = SPACING; b.car.v = VMAX;
          seg(nj, opposite(b.exit)).push(b.car);
        }
      }

      // 3. Approach segments: car following, stop lines, box entry.
      for (let j = 0; j < NJ; j++) {
        for (const d of DIRS) {
          const cars = seg(j, d);
          const green = world.lights[j] === PHASE_OF[d];
          for (let i = 0; i < cars.length; i++) {
            const c = cars[i];
            const front = i === 0;
            const space = front ? (green ? Infinity : c.dist) : c.dist - cars[i - 1].dist - GAP;
            c.v = clamp(space, 0, VMAX);
            c.dist = Math.max(front ? 0 : cars[i - 1].dist + GAP, c.dist - c.v * dt);
            if (c.v < 1) c.waited += dt;
            if (front && green && c.dist <= 0.5) {
              const exit = c.route[c.hop];
              const nj = neighbour(j, exit);
              const dest = nj === null ? null : seg(nj, opposite(exit));
              // Enter only if the outgoing segment has room (no car already crossing towards it).
              if (dest && (!hasRoom(dest) || boxes[j].some(b => b.exit === exit))) continue;
              cars.shift(); i--;
              c.v = VMAX;
              boxes[j].push({ car: c, axis: PHASE_OF[d], exit, t: BOX_S });
            }
          }
        }
      }

      // 4. Physical safety check: a box holding cars from both axes is a conflict.
      for (let j = 0; j < NJ; j++) {
        const b = boxes[j];
        const both = b.some(x => x.axis === 'NS') && b.some(x => x.axis === 'EW');
        if (both && !conflictActive[j]) world.conflicts++;
        conflictActive[j] = both;
      }

      world.now = now + dt;
    },

    metrics() {
      return metrics.read(world.now, world.conflicts, { state: 'none', journey: 0, stopped: 0 });
    },

    snapshot() {
      const cars = [];
      for (let j = 0; j < NJ; j++) {
        const p = junctionPos(j);
        for (const d of DIRS) {
          const h = opposite(d), back = dirVec(d), lat = dirVec(left(h));
          for (const c of seg(j, d)) {
            cars.push({
              x: r2(p.x + back.x * (c.dist + 6) + lat.x * 3),
              y: r2(p.y + back.y * (c.dist + 6) + lat.y * 3),
              heading: h, isAmbulance: c.isAmbulance,
            });
          }
        }
        for (const b of boxes[j]) cars.push({ x: p.x, y: p.y, heading: b.exit, isAmbulance: b.car.isAmbulance });
      }
      const m = world.metrics();
      return {
        t: r2(world.now),
        junctions: world.lights.map((lights, id) => ({ id, lights, orphaned: world.orphaned[id] })),
        cars,
        links: allLinks().map(([a, b]) => ({ a, b, up: true })),
        metrics: { ...m, avgWait: r2(m.avgWait), rollingWait: r2(m.rollingWait) },
      };
    },
  };
  return world;
}
