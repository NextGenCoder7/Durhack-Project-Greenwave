import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canSpawnAmbulance } from '../src/display/demo-rules.js';

// canSpawnAmbulance reads snapshots only (display rule: snapshot-only).
const W = state => ({ metrics: { ambulance: { state } } });

test('spawn allowed only when no panel has an ambulance driving', () => {
  assert.equal(canSpawnAmbulance([W('none'), W('none'), W('none')]), true);
  assert.equal(canSpawnAmbulance([W('arrived'), W('arrived'), W('arrived')]), true);
  assert.equal(canSpawnAmbulance([W('arrived'), W('driving'), W('arrived')]), false);
});

import { linkAt } from '../src/display/demo-rules.js';
import { allLinks } from '../src/world/grid.js';

const LINKS = allLinks().map(([a, b]) => ({ a, b, up: true }));
// Junction 0 is at (120,120) m, junction 1 at (240,120), junction 4 at (120,240).

test('linkAt: a click anywhere along a link selects it, not just the midpoint', () => {
  assert.deepEqual(pick(150, 120), [0, 1]);   // a quarter of the way along 0-1
  assert.deepEqual(pick(215, 126), [0, 1]);   // near the far end, slightly off the line
  assert.deepEqual(pick(121, 200), [0, 4]);   // along the vertical link 0-4
});

test('linkAt: clicks too far from any link, or on a junction itself, select nothing', () => {
  assert.equal(linkAt(180, 160, LINKS, 14), null);   // middle of a block
  assert.equal(linkAt(120, 120, LINKS, 14), null);   // on junction 0
});

function pick(x, y) { const l = linkAt(x, y, LINKS, 14); return l && [l.a, l.b]; }

import { bestIndex } from '../src/display/demo-rules.js';
test('bestIndex: lowest value wins', () => assert.equal(bestIndex([57.1, 106, 58.7]), 0));
test('bestIndex: ties go to the first index', () => assert.equal(bestIndex([2, 1.5, 1.5]), 1));
test('bestIndex: nulls are ignored', () => assert.equal(bestIndex([null, 3, 2]), 2));
test('bestIndex: all null gives null', () => assert.equal(bestIndex([null, null, null]), null));

import { detectEvents } from '../src/display/demo-rules.js';
const A = (state, journey = 0) => ({ label: 'Greenwave', state, journey });
test('detectEvents: driving -> arrived gives one event', () =>
  assert.deepEqual(detectEvents([A('driving', 50)], [A('arrived', 58.7)]), [{ type: 'arrived', label: 'Greenwave', journey: 58.7 }]));
test('detectEvents: none -> driving and arrived -> arrived give none', () => {
  assert.deepEqual(detectEvents([A('none')], [A('driving', 1)]), []);
  assert.deepEqual(detectEvents([A('arrived', 58.7)], [A('arrived', 58.7)]), []);
});
test('detectEvents: two modes arriving together give two events', () =>
  assert.equal(detectEvents([A('driving'), A('driving')], [A('arrived', 57), A('arrived', 74)]).length, 2));
test('detectEvents: null prev (after reset) gives none', () =>
  assert.deepEqual(detectEvents(null, [A('arrived', 58.7)]), []));
