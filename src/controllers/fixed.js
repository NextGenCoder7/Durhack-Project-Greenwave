// Fixed-timer controller: 30 s NS / 2 s ALL_RED / 30 s EW / 2 s ALL_RED, all offsets zero.
export const CYCLE_S = 64;

export function fixedPhase(now) {
  const m = ((now % CYCLE_S) + CYCLE_S) % CYCLE_S;
  if (m < 30) return 'NS';
  if (m < 32) return 'ALL_RED';
  if (m < 62) return 'EW';
  return 'ALL_RED';
}

export function createFixed() {
  return {
    name: 'fixed',
    tick(world) {
      const p = fixedPhase(world.now);
      for (let j = 0; j < 16; j++) world.setLights(j, p);
    },
  };
}
