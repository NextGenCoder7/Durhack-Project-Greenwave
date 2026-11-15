import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld } from '../src/world/world.js';
import { runHeadless } from '../src/world/run.js';
import { createFixed, fixedPhase } from '../src/controllers/fixed.js';
import { junctionId } from '../src/world/grid.js';

const run = (seed, ctrl, T, opts) => { const w = createWorld({ seed, ...opts }); runHeadless(w, ctrl(), T); return w; };
const allRed = () => ({ name: 'red', tick() {} });

test('tick rejects dt > 0.1', () => assert.throws(() => createWorld({ seed: 1 }).tick(0.2), RangeError));

test('fixedPhase follows the 64s cycle', () => {
  assert.equal(fixedPhase(0), 'NS'); assert.equal(fixedPhase(29.9), 'NS');
  assert.equal(fixedPhase(30), 'ALL_RED'); assert.equal(fixedPhase(32), 'EW');
  assert.equal(fixedPhase(62), 'ALL_RED'); assert.equal(fixedPhase(64), 'NS');
});

test('fixed: same seed, same snapshot at 300s', () =>
  assert.equal(JSON.stringify(run(42, createFixed, 300).snapshot()), JSON.stringify(run(42, createFixed, 300).snapshot())));

test('fixed: zero conflicts over 600s', () => assert.equal(run(42, createFixed, 600).conflicts, 0));

test('fixed: cars exit and wait is positive', () => {
  const m = run(42, createFixed, 600).metrics();
  assert.ok(m.exited > 100, `exited=${m.exited}`); assert.ok(m.avgWait > 0);
});

test('direct green-to-green counts a conflict; via all-red does not', () => {
  const w = createWorld({ seed: 1 });
  w.setLights(0, 'NS'); w.setLights(0, 'ALL_RED'); for (let i = 0; i < 16; i++) w.tick(0.1); w.setLights(0, 'EW');
  assert.equal(w.conflicts, 0);
  w.setLights(0, 'NS'); assert.equal(w.conflicts, 1);
});

test('no deadlock under heavy traffic', () => {
  const w = createWorld({ seed: 5, rate: 1 / 5 }); const c = createFixed(); let last = 0;
  for (let m = 1; m <= 10; m++) { runHeadless(w, c, m * 60); const e = w.metrics().exited; assert.ok(e > last, `minute ${m}`); last = e; }
});

test('heavy entry: spawns never overlap', () => {
  const w = createWorld({ seed: 5, rate: 1 / 2 });
  runHeadless(w, createFixed(), 300, { onStep: w => {
    for (const seg of w._segments()) for (let i = 1; i < seg.length; i++)
      assert.ok(seg[i].dist - seg[i - 1].dist >= 7 - 1e-6, `gap ${seg[i].dist - seg[i - 1].dist}`);
  } });
});

test('sensors: queue counts stopped cars within 60m; departures reset on read', () => {
  const w = createWorld({ seed: 42 }); runHeadless(w, allRed(), 120);
  const s = w.readSensors(junctionId(1, 0));
  assert.ok(s.queues.W > 0 && s.queues.W <= 9, `queue ${s.queues.W}`);
  assert.equal(s.now, w.now);
  assert.deepEqual(w.readSensors(junctionId(1, 0)).departures, { N: 0, E: 0, S: 0, W: 0 });
});

test('departures are counted per exit', () => {
  const w = createWorld({ seed: 42 }); runHeadless(w, createFixed(), 60);
  let total = 0;
  for (let j = 0; j < 16; j++) { const d = w.readSensors(j).departures; total += d.N + d.E + d.S + d.W; }
  assert.ok(total > 0);
});

test('snapshot shape', () => {
  const s = run(42, createFixed, 30).snapshot();
  assert.equal(s.junctions.length, 16); assert.equal(s.links.length, 24);
  assert.ok(s.cars.length > 0); assert.ok('x' in s.cars[0] && 'isAmbulance' in s.cars[0]);
  assert.ok('conflicts' in s.metrics);
});

test('snapshot cars carry their id', () => {
  const s = run(42, createFixed, 60).snapshot();
  assert.ok(s.cars.length > 0);
  for (const c of s.cars) assert.notEqual(c.id, undefined);
});
