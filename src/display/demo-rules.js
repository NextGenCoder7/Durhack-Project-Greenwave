// Demo rules shared by the display controls. Kept separate so they can be tested headlessly.
import { junctionPos } from '../world/grid.js';

const END_MARGIN = 0.12; // ignore the 12% of each link nearest a junction: there the target is ambiguous

/**
 * Link nearest to point (x, y) in world metres, within `tol` metres of the line between its
 * junctions, or null. Clicks on or right next to a junction select nothing.
 */
export function linkAt(x, y, links, tol) {
  let best = null, bestD = tol;
  for (const l of links) {
    const a = junctionPos(l.a), b = junctionPos(l.b);
    const dx = b.x - a.x, dy = b.y - a.y;
    const t = ((x - a.x) * dx + (y - a.y) * dy) / (dx * dx + dy * dy);
    if (t < END_MARGIN || t > 1 - END_MARGIN) continue;
    const d = Math.hypot(x - (a.x + t * dx), y - (a.y + t * dy));
    if (d <= bestD) { bestD = d; best = l; }
  }
  return best;
}

/** Index of the lowest non-null value (ties: first), or null when there is no data. */
export function bestIndex(values) {
  let best = null;
  values.forEach((v, i) => { if (v !== null && (best === null || v < values[best])) best = i; });
  return best;
}

/** All panels must run the same ambulance: only spawn when no panel has one driving. */
export function canSpawnAmbulance(worlds) {
  return worlds.every(w => w.metrics().ambulance.state !== 'driving');
}
