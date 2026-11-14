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
