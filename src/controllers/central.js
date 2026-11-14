// Central controller: one optimiser with perfect, instant knowledge of every car and the ambulance.
// It reaches junctions from a hub at junction 0 by multi-hop over the same mesh; a junction with
// no path to the hub (or every junction after failCentral) falls back to the fixed timer.
import { advance, chooseByPressure, forecastWeight, servingPhase, initSignal, DIRS } from '../brain/phases.js';
import { fixedPhase, CYCLE_S } from './fixed.js';
import { neighbour } from '../world/grid.js';
import { VMAX, QUEUE_RANGE } from '../world/world.js';

export const STEP_S = 0.25;
export const HUB = 0;
const PRECLEAR_S = 15;

export function reachableFromHub(world) {
  const reach = Array(16).fill(false);
  if (world.centralFailed) return reach;
  reach[HUB] = true;
  const queue = [HUB];
  while (queue.length) {
    const j = queue.shift();
    for (const d of DIRS) {
      const n = neighbour(j, d);
      if (n !== null && !reach[n] && world.linkUp(j, n)) { reach[n] = true; queue.push(n); }
    }
  }
  return reach;
}

/** Green the fixed cycle is showing, or about to show during its all-red. */
function fixedGreen(now) {
  const p = fixedPhase(now);
  if (p !== 'ALL_RED') return p;
  const m = ((now % CYCLE_S) + CYCLE_S) % CYCLE_S;
  return m < 32 ? 'EW' : 'NS';
}

export function createCentral() {
  const sigs = Array.from({ length: 16 }, () => initSignal());
  let nextStep = 0;
  return {
    name: 'central',
    tick(world) {
      if (world.now < nextStep - 1e-9) return;
      while (nextStep <= world.now + 1e-9) nextStep += STEP_S;
      const now = world.now;
      const reach = reachableFromHub(world);
      const amb = new Map((world.ambulanceInfo()?.junctions || []).map(x => [x.j, x]));

      for (let j = 0; j < 16; j++) {
        world.orphaned[j] = !reach[j];
        let want, urgent = false;
        if (!reach[j]) {
          want = fixedGreen(now); urgent = true;
        } else {
          const a = amb.get(j);
          if (a && a.eta <= PRECLEAR_S) {
            want = servingPhase(a.approach); urgent = true;
          } else if (sigs[j].phase === 'ALL_RED') {
            want = sigs[j].target;
          } else {
            const scores = { NS: 0, EW: 0 };
            const appr = world.trueApproaches(j);
            for (const d of DIRS) {
              for (const c of appr[d]) {
                if (c.dist <= QUEUE_RANGE && c.v < 1) scores[servingPhase(d)] += 1;
                else scores[servingPhase(d)] += forecastWeight(c.dist / VMAX);
              }
            }
            want = chooseByPressure(sigs[j].phase, scores, now - sigs[j].since);
          }
        }
        sigs[j] = advance(sigs[j], want, now, { ignoreMinGreen: urgent });
        world.setLights(j, sigs[j].phase);
      }
    },
  };
}
