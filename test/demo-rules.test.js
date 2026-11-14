import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canSpawnAmbulance } from '../src/display/demo-rules.js';

const W = state => ({ metrics: () => ({ ambulance: { state } }) });

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
