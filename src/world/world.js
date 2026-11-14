// Headless, seeded world: physics, sensors, lights, links and metrics. It never decides lights.
import { N, DIRS, SPACING, STUB, PHASE_OF, opposite, left, neighbour, junctionPos, dirVec, allLinks, linkKey } from './grid.js';
import { buildSchedule, entryJunction, AMBULANCE } from './schedule.js';
import { createMetrics } from './metrics.js';

export const VMAX = 12;          // m/s
export const GAP = 7;            // m, minimum gap
export const BOX_S = 1.5;        // s to cross a junction
export const QUEUE_RANGE = 60;   // m
export const MAX_DT = 0.1;       // s
export const LINK_LATENCY_S = 0.05;
export const SIREN_RANGE = 80;   // m
export const V2I_RANGE = 200;    // m
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
  const linkState = new Map(allLinks().map(([a, b]) => [linkKey(a, b), true]));
  const inboxes = Array.from({ length: NJ }, () => []); // { deliverAt, msg, link: key | null }
  let next = 0;
  let amb = null; // { car, state: 'driving' | 'arrived', spawnT, journey, stopped, messaged: [hop] }

  const hasRoom = s => s.length === 0 || s[s.length - 1].dist <= SPACING - GAP;

  const world = {
    now: 0,
    lights: Array(NJ).fill('ALL_RED'),
    orphaned: Array(NJ).fill(false),
    centralFailed: false,
    conflicts: 0,
    /** Headline failure: the central controller goes down. Only the central controller reads this. */
    failCentral() { world.centralFailed = true; },
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
      let sirenNear = null;
      if (amb && amb.state === 'driving' && !amb.car.inBox && amb.car.j === j && amb.car.dist <= SIREN_RANGE) sirenNear = amb.car.d;
      return { now: world.now, queues, departures: dep, sirenNear };
    },

    /** Spawn the ambulance at the current time. Ignored while one is already driving. */
    spawnAmbulance() {
      if (amb && amb.state === 'driving') return;
      const j = entryJunction(AMBULANCE.entry), d = AMBULANCE.entry.side;
      const target = seg(j, d);
      const last = target[target.length - 1];
      const car = { id: 'amb', isAmbulance: true, route: AMBULANCE.route, hop: 0, j, d, dist: last ? Math.max(STUB, last.dist + GAP) : STUB, v: VMAX, waited: 0, spawnT: world.now, inBox: false };
      target.push(car);
      amb = { car, state: 'driving', spawnT: world.now, journey: 0, stopped: 0, messaged: [] };
    },

    /** Ground truth about the ambulance, for the central controller only. */
    ambulanceInfo() {
      if (!amb || amb.state !== 'driving') return null;
      const c = amb.car, out = [];
      let j = c.j, approach = c.d, dist = c.inBox ? 0 : c.dist;
      for (let h = c.hop; h < c.route.length && j !== null; h++) {
        if (!(c.inBox && h === c.hop)) out.push({ j, approach, eta: dist / VMAX });
        const exit = c.route[h];
        j = neighbour(j, exit); approach = opposite(exit); dist += SPACING;
      }
      return { junctions: out };
    },

    // --- Link layer ("the wire"). Junctions exchange messages only through here. ---
    recentMessages: [],

    send(fromJ, dir, msg) {
      const to = neighbour(fromJ, dir);
      if (to === null) return;
      const key = linkKey(fromJ, to);
      if (!linkState.get(key)) return;
      inboxes[to].push({ deliverAt: world.now + LINK_LATENCY_S, msg, link: key });
      world.recentMessages.push({ a: fromJ, b: to, type: msg.type, t: world.now });
    },

    /** Short-range radio (ambulance V2I): bypasses links, delivered immediately. */
    deliverDirect(j, msg) {
      inboxes[j].push({ deliverAt: world.now, msg, link: null });
    },

    takeInbox(j) {
      const out = [], keep = [];
      for (const m of inboxes[j]) {
        if (m.deliverAt > world.now + 1e-9) keep.push(m);
        else if (m.link === null || linkState.get(m.link)) out.push(m.msg);
      }
      inboxes[j] = keep;
      return out;
    },

    linkUp: (a, b) => !!linkState.get(linkKey(a, b)),
    cutLink(a, b) { const k = linkKey(a, b); if (linkState.has(k)) linkState.set(k, false); },
    restoreLink(a, b) { const k = linkKey(a, b); if (linkState.has(k)) linkState.set(k, true); },
    cutAll() { for (const k of linkState.keys()) linkState.set(k, false); },
    restoreAll() { for (const k of linkState.keys()) linkState.set(k, true); },

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
        const j = entryJunction(s.entry);
        target.push({ id: s.id, isAmbulance: false, route: s.route, hop: 0, j, d: s.entry.side, dist: STUB, v: VMAX, waited: now - s.t, spawnT: s.t });
      }

      // 1b. Ambulance short-range radio (V2I) to its FIRST junction only, bypassing links.
      // Later junctions learn via hop-by-hop PRIORITY, or their own siren detector if cut off.
      if (amb && amb.state === 'driving') {
        const c = amb.car;
        if (c.hop === 0 && !c.inBox && c.dist <= V2I_RANGE && !amb.messaged.includes(c.hop)) {
          amb.messaged.push(c.hop);
          world.deliverDirect(c.j, { type: 'PRIORITY', id: 'amb', seq: 2 * c.hop, approach: c.d, route: c.route.slice(c.hop + 1), etaSec: c.dist / VMAX, hopsLeft: 3 });
        }
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
          b.car.inBox = false;
          if (nj === null) {
            if (b.car.isAmbulance) { amb.state = 'arrived'; amb.journey = now - amb.spawnT; amb.stopped = b.car.waited; }
            else metrics.onExit(b.car, now);
            continue;
          }
          b.car.hop++; b.car.dist = SPACING; b.car.v = VMAX; b.car.j = nj; b.car.d = opposite(b.exit);
          seg(nj, b.car.d).push(b.car);
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
              c.v = VMAX; c.inBox = true;
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
      const cutoff = world.now - 1;
      if (world.recentMessages.length && world.recentMessages[0].t <= cutoff) {
        world.recentMessages = world.recentMessages.filter(m => m.t > cutoff);
      }
    },

    metrics() {
      let a = { state: 'none', journey: 0, stopped: 0 };
      if (amb && amb.state === 'driving') a = { state: 'driving', journey: world.now - amb.spawnT, stopped: amb.car.waited };
      else if (amb) a = { state: 'arrived', journey: amb.journey, stopped: amb.stopped };
      return metrics.read(world.now, world.conflicts, a);
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
        links: allLinks().map(([a, b]) => ({ a, b, up: world.linkUp(a, b) })),
        messages: world.recentMessages.map(m => ({ a: m.a, b: m.b, type: m.type, age: r2(world.now - m.t) })),
        metrics: { ...m, avgWait: r2(m.avgWait), rollingWait: r2(m.rollingWait) },
      };
    },
  };
  return world;
}
