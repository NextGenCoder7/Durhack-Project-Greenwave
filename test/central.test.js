import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld } from '../src/world/world.js';
import { runHeadless } from '../src/world/run.js';
import { createFixed } from '../src/controllers/fixed.js';
import { createCentral, reachableFromHub } from '../src/controllers/central.js';
import { createGreenwaveLockstep } from '../src/controllers/greenwave-lockstep.js';

test('reachableFromHub: mesh redundancy, hub isolation, failCentral', () => {
  const w = createWorld({ seed: 1 });
  assert.ok(reachableFromHub(w).every(Boolean));
  w.cutLink(0, 1);
  assert.ok(reachableFromHub(w).every(Boolean));
  w.cutLink(0, 4);
  const r = reachableFromHub(w);
  assert.equal(r[0], true);
  assert.ok(r.slice(1).every(x => !x));
  w.restoreAll(); w.failCentral();
  assert.ok(reachableFromHub(w).every(x => !x));
});

test('central marks orphaned junctions in the snapshot', () => {
  const w = createWorld({ seed: 1 }), c = createCentral();
  runHeadless(w, c, 5);
  assert.ok(w.snapshot().junctions.every(j => !j.orphaned));
  w.failCentral(); runHeadless(w, c, 6);
  assert.ok(w.snapshot().junctions.every(j => j.orphaned));
});

test('central: zero conflicts across failCentral mid-run', () => {
  const w = createWorld({ seed: 42 }), c = createCentral();
  runHeadless(w, c, 200); w.failCentral(); runHeadless(w, c, 600);
  assert.equal(w.conflicts, 0);
});

test('central: zero conflicts with partial cuts and an ambulance', () => {
  const w = createWorld({ seed: 42 }), c = createCentral();
  runHeadless(w, c, 100); w.cutLink(1, 2); w.cutLink(5, 6); w.cutLink(9, 10); w.cutLink(13, 14); // isolates columns 2-3
  w.spawnAmbulance(); runHeadless(w, c, 500);
  assert.equal(w.conflicts, 0);
  assert.equal(w.metrics().ambulance.state, 'arrived');
});

test('central beats fixed on avgWait (seed 42, 600s)', () => {
  const c = createWorld({ seed: 42 }); runHeadless(c, createCentral(), 600);
  const f = createWorld({ seed: 42 }); runHeadless(f, createFixed(), 600);
  assert.ok(c.metrics().avgWait < f.metrics().avgWait, `central ${c.metrics().avgWait} fixed ${f.metrics().avgWait}`);
});

test('central ambulance journey <= greenwave ambulance journey, links up (seed 42)', () => {
  const j = mk => { const w = createWorld({ seed: 42 }), c = mk(); runHeadless(w, c, 120); w.spawnAmbulance(); runHeadless(w, c, 400); return w.metrics().ambulance.journey; };
  const c = j(createCentral), g = j(createGreenwaveLockstep);
  assert.ok(c <= g, `central ${c} greenwave ${g}`);
});
