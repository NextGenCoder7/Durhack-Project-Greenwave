import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld } from '../src/world/world.js';
import { runHeadless } from '../src/world/run.js';
import { createFixed } from '../src/controllers/fixed.js';
import { createGreenwaveLockstep } from '../src/controllers/greenwave-lockstep.js';
import { mulberry32 } from '../src/world/rng.js';
import { allLinks } from '../src/world/grid.js';

test('greenwave: deterministic, zero conflicts, beats fixed on wait', () => {
  const a = createWorld({ seed: 42 }); runHeadless(a, createGreenwaveLockstep(), 600);
  const b = createWorld({ seed: 42 }); runHeadless(b, createGreenwaveLockstep(), 600);
  assert.equal(JSON.stringify(a.snapshot()), JSON.stringify(b.snapshot()));
  assert.equal(a.conflicts, 0);
  const f = createWorld({ seed: 42 }); runHeadless(f, createFixed(), 600);
  assert.ok(a.metrics().avgWait < f.metrics().avgWait, `greenwave ${a.metrics().avgWait} vs fixed ${f.metrics().avgWait}`);
});

test('greenwave: random link cuts, zero conflicts, traffic keeps flowing', () => {
  const w = createWorld({ seed: 42 }), r = mulberry32(7), links = allLinks();
  let n = 0;
  runHeadless(w, createGreenwaveLockstep(), 600, { onStep: w => {
    if (++n % 300 === 0) { const [a, b] = links[Math.floor(r() * 24)]; w.cutLink(a, b); }
  } });
  assert.equal(w.conflicts, 0);
  assert.ok(w.metrics().exited > 100);
});

test('greenwave: all links cut still beats fixed on wait', () => {
  const g = createWorld({ seed: 42 }); g.cutAll(); runHeadless(g, createGreenwaveLockstep(), 600);
  const f = createWorld({ seed: 42 }); runHeadless(f, createFixed(), 600);
  assert.equal(g.conflicts, 0);
  assert.ok(g.metrics().avgWait < f.metrics().avgWait);
});
