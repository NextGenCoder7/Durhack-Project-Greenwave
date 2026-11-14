// Grid geometry. Approach d = cars arriving FROM side d. Exit d = leaving TOWARDS side d.
export const N = 4;
export const SPACING = 120;
export const STUB = 120;
export const DIRS = ['N', 'E', 'S', 'W'];
export const PHASE_OF = { N: 'NS', S: 'NS', E: 'EW', W: 'EW' };

const OPP = { N: 'S', S: 'N', E: 'W', W: 'E' };
const LEFT = { N: 'W', W: 'S', S: 'E', E: 'N' };   // left turn for a vehicle heading d
const RIGHT = { N: 'E', E: 'S', S: 'W', W: 'N' };
const DELTA = { N: [-1, 0], S: [1, 0], E: [0, 1], W: [0, -1] };

export const opposite = d => OPP[d];
export const left = d => LEFT[d];
export const right = d => RIGHT[d];
export const junctionId = (r, c) => r * N + c;
export const rc = id => ({ r: Math.floor(id / N), c: id % N });
export const junctionPos = id => { const { r, c } = rc(id); return { x: STUB + c * SPACING, y: STUB + r * SPACING }; };
export const WORLD_SIZE = 2 * STUB + (N - 1) * SPACING;
/** Unit vector pointing towards side d (y grows downward). */
export const dirVec = d => ({ x: DELTA[d][1], y: DELTA[d][0] });

export function neighbour(id, dir) {
  const { r, c } = rc(id);
  const nr = r + DELTA[dir][0], nc = c + DELTA[dir][1];
  if (nr < 0 || nr >= N || nc < 0 || nc >= N) return null;
  return junctionId(nr, nc);
}

export const linkKey = (a, b) => `${Math.min(a, b)}-${Math.max(a, b)}`;

export function allLinks() {
  const out = [];
  for (let id = 0; id < N * N; id++) {
    for (const d of ['E', 'S']) {
      const n = neighbour(id, d);
      if (n !== null) out.push([id, n]);
    }
  }
  return out;
}
