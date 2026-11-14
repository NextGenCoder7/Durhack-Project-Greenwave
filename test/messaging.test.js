import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld } from '../src/world/world.js';
import { runHeadless } from '../src/world/run.js';
import { createGreenwaveLockstep } from '../src/controllers/greenwave-lockstep.js';

test('messaging off: send delivers nothing; back on delivers again without replay', () => {
  const w = createWorld({ seed: 1 });
  w.setMessaging(false);
  w.send(0, 'E', { type: 'X' }); w.tick(0.1);
  assert.deepEqual(w.takeInbox(1), []);
  assert.equal(w.recentMessages.length, 0);
  w.setMessaging(true);
  w.send(0, 'E', { type: 'Y' }); w.tick(0.1);
  assert.deepEqual(w.takeInbox(1).map(m => m.type), ['Y']);
});

test('messaging off: messages already in flight are dropped', () => {
  const w = createWorld({ seed: 1 });
  w.send(0, 'E', { type: 'X' }); w.setMessaging(false); w.tick(0.1);
  assert.deepEqual(w.takeInbox(1), []);
});

test('messaging off: direct radio (V2I) still delivers', () => {
  const w = createWorld({ seed: 1 }); w.setMessaging(false);
  w.deliverDirect(4, { type: 'PRIORITY' });
  assert.equal(w.takeInbox(4).length, 1);
});

test('toggling messaging leaves link states untouched', () => {
  const w = createWorld({ seed: 1 }); w.cutLink(0, 1);
  w.setMessaging(false); w.setMessaging(true);
  assert.equal(w.linkUp(0, 1), false);
  assert.equal(w.linkUp(1, 2), true);
});

test('snapshot reports the messaging flag', () => {
  const w = createWorld({ seed: 1 });
  assert.equal(w.snapshot().messaging, true);
  w.setMessaging(false);
  assert.equal(w.snapshot().messaging, false);
});

test('messaging off means exactly "no cooperation": same metrics as all links cut (seed 42)', () => {
  const off = createWorld({ seed: 42 }); off.setMessaging(false);
  runHeadless(off, createGreenwaveLockstep(), 600);
  const cut = createWorld({ seed: 42 }); cut.cutAll();
  runHeadless(cut, createGreenwaveLockstep(), 600);
  assert.deepEqual(off.snapshot().metrics, cut.snapshot().metrics);
});
