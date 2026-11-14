// Signal safety state machine and max-pressure helpers. Pure: no host APIs, no imports from outside src/brain.
// Shared by the Greenwave junction agent and the central controller.

export const ALL_RED_S = 2;
export const MIN_GREEN_S = 6;
export const MAX_GREEN_S = 45;
export const MARGIN = 2;
export const DIRS = ['N', 'E', 'S', 'W'];

const OPP = { N: 'S', S: 'N', E: 'W', W: 'E' };
const EPS = 1e-9;

export const opposite = d => OPP[d];
/** Phase that gives green to cars arriving from `approach`. */
export const servingPhase = approach => (approach === 'N' || approach === 'S' ? 'NS' : 'EW');

export function initSignal() {
  return { phase: 'ALL_RED', since: 0, target: 'NS' };
}

/**
 * Move the signal towards `want` ('NS' | 'EW') without ever skipping all-red.
 * A green only changes to ALL_RED; ALL_RED holds >= 2 s before its target goes green.
 */
export function advance(sig, want, now, { ignoreMinGreen = false } = {}) {
  if (sig.phase === 'ALL_RED') {
    if (now - sig.since >= ALL_RED_S - EPS) return { phase: want, since: now, target: want };
    return sig.target === want ? sig : { ...sig, target: want };
  }
  if (want !== sig.phase && (ignoreMinGreen || now - sig.since >= MIN_GREEN_S - EPS)) {
    return { phase: 'ALL_RED', since: now, target: want };
  }
  return sig;
}

/** Max-pressure choice with hysteresis and a maximum green. */
export function chooseByPressure(phase, scores, greenFor) {
  if (phase === 'ALL_RED') return scores.EW > scores.NS ? 'EW' : 'NS';
  const other = phase === 'NS' ? 'EW' : 'NS';
  if (scores[other] > scores[phase] + MARGIN) return other;
  if (greenFor >= MAX_GREEN_S - EPS && scores[other] > 0) return other;
  return phase;
}

/** Weight of a forecast arrival `eta` seconds away: 1 under 5 s, linear to 0 at 15 s. */
export function forecastWeight(eta) {
  if (eta < 5) return 1;
  if (eta < 15) return (15 - eta) / 10;
  return 0;
}
