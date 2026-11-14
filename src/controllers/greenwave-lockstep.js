// In-process host for the 16 Greenwave brains: deterministic, used by tests and headless runs.
// Each brain sees only its own sensors and inbox; messages travel via world.send (the link layer).
import { init, step } from '../brain/junction.js';

export const STEP_S = 0.25;

export function createGreenwaveLockstep() {
  const states = Array.from({ length: 16 }, () => init());
  let nextStep = 0;
  return {
    name: 'greenwave',
    tick(world) {
      if (world.now < nextStep - 1e-9) return;
      while (nextStep <= world.now + 1e-9) nextStep += STEP_S;
      for (let j = 0; j < 16; j++) {
        const inputs = { ...world.readSensors(j), inbox: world.takeInbox(j) };
        const out = step(states[j], inputs);
        states[j] = out.state;
        world.setLights(j, out.lights);
        for (const o of out.outbox) world.send(j, o.to, o.msg);
      }
    },
  };
}
