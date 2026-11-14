import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld } from '../src/world/world.js';
import { runHeadless } from '../src/world/run.js';
import { buildSchedule } from '../src/world/schedule.js';
import { createFixed } from '../src/controllers/fixed.js';
import { createCentral } from '../src/controllers/central.js';
import { createGreenwaveLockstep } from '../src/controllers/greenwave-lockstep.js';

const MODES = { fixed: createFixed, central: createCentral, greenwave: createGreenwaveLockstep };
const runMode = mk => { const w = createWorld({ seed: 42 }), c = mk(); runHeadless(w, c, 120); w.spawnAmbulance(); runHeadless(w, c, 300); return w; };

for (const [name, mk] of Object.entries(MODES)) {
  test(`${name}: same seed gives identical snapshot at 300s with an ambulance`, () => {
    assert.equal(JSON.stringify(runMode(mk).snapshot()), JSON.stringify(runMode(mk).snapshot()));
  });
}

test('all three modes see an identical spawn schedule', () => {
  const ref = buildSchedule(42);
  for (const mk of Object.values(MODES)) {
    const w = createWorld({ seed: 42 }); runHeadless(w, mk(), 60);
    assert.deepEqual(w._schedule, ref);
  }
});
