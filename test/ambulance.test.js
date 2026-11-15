import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld } from '../src/world/world.js';
import { runHeadless } from '../src/world/run.js';
import { createFixed } from '../src/controllers/fixed.js';
import { createGreenwaveLockstep } from '../src/controllers/greenwave-lockstep.js';
import { randomAmbulanceTrip } from '../src/world/schedule.js';
import { mulberry32 } from '../src/world/rng.js';

const amb = (makeCtrl, seed, cutAll) => {
  const w = createWorld({ seed }), c = makeCtrl();
  if (cutAll) w.cutAll();
  runHeadless(w, c, 120); w.spawnAmbulance(); runHeadless(w, c, 400);
  return { a: w.metrics().ambulance, w };
};
const SEEDS = [1, 2, 3, 4, 5];

test('greenwave ambulance arrives with all links cut, within 2x free-flow (115s)', () => {
  for (const s of SEEDS) {
    const { a } = amb(createGreenwaveLockstep, s, true);
    assert.equal(a.state, 'arrived', `seed ${s}`);
    assert.ok(a.journey <= 115, `seed ${s}: ${a.journey}`);
  }
});

test('greenwave with cuts beats fixed on average ambulance journey', () => {
  const mean = xs => xs.reduce((s, x) => s + x, 0) / xs.length;
  const g = mean(SEEDS.map(s => amb(createGreenwaveLockstep, s, true).a.journey));
  const f = mean(SEEDS.map(s => amb(createFixed, s, false).a.journey));
  assert.ok(g < f, `greenwave ${g} vs fixed ${f}`);
});

test('second spawnAmbulance while driving is ignored', () => {
  const w = createWorld({ seed: 1 }), c = createGreenwaveLockstep();
  runHeadless(w, c, 10); w.spawnAmbulance(); runHeadless(w, c, 15);
  const j1 = w.metrics().ambulance.journey;
  w.spawnAmbulance();
  assert.equal(w.snapshot().cars.filter(x => x.isAmbulance).length, 1);
  assert.ok(w.metrics().ambulance.journey >= j1);
  assert.equal(w.metrics().ambulance.state, 'driving');
});

test('ambulance metrics: none before spawn; journey frozen after arrival', () => {
  const { a, w } = amb(createGreenwaveLockstep, 1, false);
  assert.equal(createWorld({ seed: 1 }).metrics().ambulance.state, 'none');
  assert.equal(a.state, 'arrived');
  runHeadless(w, createGreenwaveLockstep(), 420);
  assert.equal(w.metrics().ambulance.journey, a.journey);
});

test('sirenNear reports the approach within 80m', () => {
  const w = createWorld({ seed: 1, schedule: [] }); w.spawnAmbulance();
  assert.equal(w.readSensors(4).sirenNear, null); // 120 m away on W approach of junction (1,0)
  runHeadless(w, { name: 'red', tick() {} }, 10);
  assert.equal(w.readSensors(4).sirenNear, 'W');
});

test('V2I reaches the first junction even with all links cut', () => {
  const w = createWorld({ seed: 1, schedule: [] }); w.cutAll(); w.spawnAmbulance(); w.tick(0.1);
  const inbox = w.takeInbox(4);
  assert.equal(inbox.length, 1);
  assert.deepEqual({ ...inbox[0], etaSec: Math.round(inbox[0].etaSec) },
    { type: 'PRIORITY', id: 'amb-1', seq: 0, approach: 'W', route: ['E', 'S', 'E', 'E'], etaSec: 10, hopsLeft: 3 });
});

test('zero conflicts with ambulance and all links cut', () => {
  for (const s of SEEDS) assert.equal(amb(createGreenwaveLockstep, s, true).w.conflicts, 0);
});

test('V2I goes only to the first junction; later junctions rely on links or siren', () => {
  const w = createWorld({ seed: 1, schedule: [] }); w.cutAll(); w.spawnAmbulance();
  const fixed = createFixed(); const got = Array(16).fill(0);
  runHeadless(w, { name: 'spy', tick(world) { fixed.tick(world); for (let j = 0; j < 16; j++) got[j] += world.takeInbox(j).length; } }, 300);
  assert.equal(w.metrics().ambulance.state, 'arrived');
  assert.equal(got[4], 1);
  assert.equal(got.reduce((s, x) => s + x, 0), 1);
});


test('a second ambulance also gets a PRIORITY corridor', () => {
  const w = createWorld({ seed: 42 }), c = createGreenwaveLockstep();
  const priorities = () => w.recentMessages.filter(m => m.type === 'PRIORITY').length;
  let first = 0, second = 0;
  runHeadless(w, c, 30); w.spawnAmbulance();
  runHeadless(w, c, 150, { onStep: () => { first += priorities(); } });
  assert.equal(w.metrics().ambulance.state, 'arrived');
  w.spawnAmbulance();
  runHeadless(w, c, 270, { onStep: () => { second += priorities(); } });
  assert.equal(w.metrics().ambulance.state, 'arrived');
  assert.ok(first > 0, 'first ambulance has a corridor');
  assert.ok(second > 0, 'second ambulance has a corridor');
});

test('custom ambulance trips arrive under fixed and greenwave', () => {
  for (let seed = 1; seed <= 6; seed++) {
    const trip = randomAmbulanceTrip(mulberry32(seed));
    for (const mk of [createFixed, createGreenwaveLockstep]) {
      const w = createWorld({ seed }), c = mk();
      runHeadless(w, c, 60); w.spawnAmbulance(trip); runHeadless(w, c, 400);
      assert.equal(w.metrics().ambulance.state, 'arrived', `seed ${seed}`);
    }
  }
});
