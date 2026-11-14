import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld } from '../src/world/world.js';

test('message over an up link arrives after latency; cut link drops it', () => {
  const w = createWorld({ seed: 1 });
  w.send(0, 'E', { type: 'PLATOON' });
  assert.deepEqual(w.takeInbox(1), []);
  w.tick(0.1);
  assert.equal(w.takeInbox(1).length, 1);
  w.cutLink(0, 1); w.send(0, 'E', { type: 'PLATOON' }); w.tick(0.1);
  assert.deepEqual(w.takeInbox(1), []);
});

test('restore resumes flow without replaying dropped messages', () => {
  const w = createWorld({ seed: 1 });
  w.cutLink(0, 1); w.send(0, 'E', { type: 'X' }); w.restoreLink(0, 1); w.tick(0.1);
  assert.deepEqual(w.takeInbox(1), []);
  w.send(0, 'E', { type: 'Y' }); w.tick(0.1);
  assert.deepEqual(w.takeInbox(1).map(m => m.type), ['Y']);
});

test('message in flight when the link is cut is dropped', () => {
  const w = createWorld({ seed: 1 });
  w.send(1, 'W', { type: 'X' }); w.cutLink(1, 0); w.tick(0.1);
  assert.deepEqual(w.takeInbox(0), []);
});

test('send off the grid edge is dropped silently', () => {
  const w = createWorld({ seed: 1 });
  w.send(0, 'N', { type: 'X' }); w.tick(0.1);
});

test('direct delivery ignores links', () => {
  const w = createWorld({ seed: 1 }); w.cutAll();
  w.deliverDirect(5, { type: 'PRIORITY' });
  assert.equal(w.takeInbox(5).length, 1);
});

test('cutAll / restoreAll / linkUp and snapshot links', () => {
  const w = createWorld({ seed: 1 });
  assert.equal(w.linkUp(0, 1), true);
  w.cutAll(); assert.equal(w.linkUp(1, 0), false);
  assert.ok(w.snapshot().links.every(l => !l.up));
  w.restoreAll(); assert.ok(w.snapshot().links.every(l => l.up));
});

test('recentMessages records sends for about 1s', () => {
  const w = createWorld({ seed: 1 });
  w.send(0, 'E', { type: 'PLATOON' });
  assert.deepEqual(w.recentMessages.map(m => [m.a, m.b, m.type]), [[0, 1, 'PLATOON']]);
  for (let i = 0; i < 11; i++) w.tick(0.1);
  assert.equal(w.recentMessages.length, 0);
});
