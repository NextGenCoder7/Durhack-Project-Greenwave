/** Drive a world with a controller until sim time `untilT`. */
export function runHeadless(world, controller, untilT, { dt = 0.1, onStep } = {}) {
  while (world.now < untilT - 1e-9) {
    controller.tick(world);
    world.tick(Math.min(dt, untilT - world.now));
    if (onStep) onStep(world);
  }
}
