import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld } from '../src/world/world.js';
import { runHeadless } from '../src/world/run.js';
import { createGreenwaveLockstep } from '../src/controllers/greenwave-lockstep.js';

// One car entering from the west on row 1 and driving straight across to the east edge.
const ONE_CAR = [{ id: 0, t: 0, entry: { side: 'W', index: 1 }, route: ['E', 'E', 'E', 'E'] }];
const lightsCtrl = fn => ({ name: 'test', tick(w) { for (let j = 0; j < 16; j++) w.setLights(j, fn(w.now)); } });

test('a car that meets a red light counts exactly one stop', () => {
  const w = createWorld({ schedule: ONE_CAR });
  runHeadless(w, lightsCtrl(t => (t < 20 ? 'ALL_RED' : 'EW')), 120);
  const m = w.metrics();
  assert.equal(m.exited, 1);
  assert.equal(m.stopsPerCar, 1);
});

test('a car that drives through on green counts zero stops', () => {
  const w = createWorld({ schedule: ONE_CAR });
  runHeadless(w, lightsCtrl(() => 'EW'), 120);
  const m = w.metrics();
  assert.equal(m.exited, 1);
  assert.equal(m.stopsPerCar, 0);
  assert.equal(m.rollingStopsPerCar, 0);
});

test('stop metrics are 0 before any car has exited', () => {
  const m = createWorld({ seed: 1 }).metrics();
  assert.equal(m.stopsPerCar, 0);
  assert.equal(m.rollingStopsPerCar, 0);
});

test('rolling stops cover only cars exited in the last 60s', () => {
  const w = createWorld({ schedule: ONE_CAR });
  runHeadless(w, lightsCtrl(t => (t < 20 ? 'ALL_RED' : 'EW')), 100);
  assert.equal(w.metrics().rollingStopsPerCar, 1);
  runHeadless(w, lightsCtrl(() => 'EW'), 200);
  assert.equal(w.metrics().rollingStopsPerCar, 0);
  assert.equal(w.metrics().stopsPerCar, 1);
});

test('pitch claim: neighbour messages cut stops per car (greenwave links up < all cut, seeds 1-5)', () => {
  const stops = cut => [1, 2, 3, 4, 5].reduce((s, seed) => {
    const w = createWorld({ seed }); if (cut) w.cutAll();
    runHeadless(w, createGreenwaveLockstep(), 600);
    return s + w.metrics().stopsPerCar;
  }, 0) / 5;
  const up = stops(false), cut = stops(true);
  assert.ok(up < cut, `links up ${up.toFixed(2)} vs all cut ${cut.toFixed(2)}`);
});

test('snapshot marks a car queued at a red light as stopped', () => {
  const w = createWorld({ schedule: ONE_CAR });
  runHeadless(w, lightsCtrl(() => 'ALL_RED'), 20);
  assert.deepEqual(w.snapshot().cars.map(c => c.stopped), [true]);
});

test('snapshot marks a car driving on green as not stopped', () => {
  const w = createWorld({ schedule: ONE_CAR });
  runHeadless(w, lightsCtrl(() => 'EW'), 5);
  assert.deepEqual(w.snapshot().cars.map(c => c.stopped), [false]);
});

test('a car driving through junctions on green moves smoothly: no freezes, no jumps', () => {
  const w = createWorld({ schedule: ONE_CAR });
  const ctrl = lightsCtrl(() => 'EW');
  let prev = null, steps = 0;
  runHeadless(w, ctrl, 70, { onStep: w => {
    const car = w.snapshot().cars[0];
    if (!car) return;                                   // not spawned yet / already exited
    if (prev) {
      const d = Math.hypot(car.x - prev.x, car.y - prev.y);
      assert.ok(d >= 0.2, `froze at t=${w.now.toFixed(1)} (moved ${d.toFixed(2)} m)`);
      // Cars stop 12 m back from the junction centre, so the drawn crossing is 24 m in BOX_S (~1.6 m/tick);
      // the exit tick also includes the first move on the next road (~2.6 m). The old freeze-then-jump was 7.8 m.
      assert.ok(d <= 3, `jumped at t=${w.now.toFixed(1)} (moved ${d.toFixed(2)} m)`);
      steps++;
    }
    prev = car;
  } });
  assert.ok(steps > 300, `tracked ${steps} steps`);
});

test('a turning car curves through the junction instead of freezing', () => {
  const TURN = [{ id: 0, t: 0, entry: { side: 'W', index: 1 }, route: ['S', 'S', 'S'] }];
  const w = createWorld({ schedule: TURN });
  let prev = null, maxStep = 0, minStep = Infinity;
  runHeadless(w, lightsCtrl(t => (Math.floor(t / 3) % 2 ? 'NS' : 'EW')), 25, { onStep: w => {
    const car = w.snapshot().cars[0];
    if (car && prev && car.stopped === false && prev.stopped === false) {
      const d = Math.hypot(car.x - prev.x, car.y - prev.y);
      maxStep = Math.max(maxStep, d); minStep = Math.min(minStep, d);
    }
    prev = car || null;
  } });
  // A turning path is longer than a straight one, so per-tick steps are a little bigger (~2.3 m on the
  // exit tick, which also includes the first move on the next road). The old freeze-then-jump was 7.8 m.
  assert.ok(maxStep <= 3, `jumped ${maxStep.toFixed(2)} m`);
});
