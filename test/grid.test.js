import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allLinks, DIRS, neighbour, junctionId, left, right, opposite, junctionPos, linkKey } from '../src/world/grid.js';

test('24 links, all between neighbours', () => {
  const links = allLinks();
  assert.equal(links.length, 24);
  for (const [a, b] of links) assert.ok(DIRS.some(d => neighbour(a, d) === b));
});
test('neighbour edges', () => {
  assert.equal(neighbour(junctionId(0, 0), 'N'), null);
  assert.equal(neighbour(junctionId(1, 1), 'E'), junctionId(1, 2));
  assert.equal(neighbour(junctionId(1, 1), 'S'), junctionId(2, 1));
});
test('turn helpers', () => {
  assert.equal(left('E'), 'N'); assert.equal(right('E'), 'S'); assert.equal(opposite('N'), 'S');
});
test('positions and link keys', () => {
  assert.deepEqual(junctionPos(junctionId(1, 2)), { x: 360, y: 240 });
  assert.equal(linkKey(5, 1), '1-5');
});
