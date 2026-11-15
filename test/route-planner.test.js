import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPlanner, entries } from '../src/display/route-planner.js';
import { entryJunction, AMBULANCE } from '../src/world/schedule.js';
import { junctionPos, neighbour, opposite } from '../src/world/grid.js';
import { createWorld } from '../src/world/world.js';
import { runHeadless } from '../src/world/run.js';
import { createFixed } from '../src/controllers/fixed.js';

function checkRoute({ entry, route }) {
  let j = entryJunction(entry), heading = opposite(entry.side);
  route.forEach((exit, i) => {
    assert.notEqual(exit, opposite(heading), 'no U-turns');
    const next = neighbour(j, exit);
    if (i < route.length - 1) assert.notEqual(next, null);
    else assert.equal(next, null, 'route must end by leaving the grid');
    j = next; heading = exit;
  });
}
const clickAt = (p, pt) => p.click(pt.x, pt.y);

test('16 entry roads, all clickable first', () => {
  assert.equal(entries().length, 16);
  assert.ok(createPlanner().targets().every(t => t.kind === 'entry'));
});

test('enter W2, go E, E, S, S, then exit: a valid finished trip', () => {
  const p = createPlanner();
  const w2 = entries().find(e => e.entry.side === 'W' && e.entry.index === 1);
  assert.ok(clickAt(p, w2));
  assert.equal(p.targets().length, 3);                         // ahead, left, right; never back
  for (const id of [5, 6, 10, 14]) assert.equal(clickAt(p, junctionPos(id)).kind, 'junction');
  const exit = p.targets().find(t => t.kind === 'exit');
  assert.ok(clickAt(p, exit));
  assert.ok(p.done);
  assert.deepEqual(p.targets(), []);
  checkRoute(p.trip());
});

test('clicks on non-adjacent junctions or empty space are ignored', () => {
  const p = createPlanner();
  clickAt(p, entries()[0]);
  const before = p.route;
  assert.equal(p.click(9999, 9999), null);
  const far = junctionPos(15);
  assert.equal(p.click(far.x, far.y), null);
  assert.deepEqual(p.route, before);
});

test('an unfinished route carries straight on to the edge', () => {
  const p = createPlanner();
  clickAt(p, entries().find(e => e.entry.side === 'N' && e.entry.index === 2));
  clickAt(p, junctionPos(neighbour(entryJunction({ side: 'N', index: 2 }), 'S')));
  assert.ok(!p.done);
  checkRoute(p.trip());
});

test('undo steps back, then clears the entry; load restores a trip', () => {
  const p = createPlanner();
  p.load(AMBULANCE);
  assert.ok(p.done);
  assert.deepEqual(p.trip(), { entry: AMBULANCE.entry, route: AMBULANCE.route });
  for (let i = 0; i < AMBULANCE.route.length; i++) p.undo();
  assert.ok(p.started); p.undo(); assert.ok(!p.started);
  assert.equal(p.trip(), null);
});

test('path runs edge to edge through every junction of the trip', () => {
  const p = createPlanner(); p.load(AMBULANCE);
  assert.equal(p.path().length, AMBULANCE.route.length + 2);
});

test('a planned trip drives through the world', () => {
  const p = createPlanner();
  clickAt(p, entries().find(e => e.entry.side === 'S' && e.entry.index === 0));
  for (let k = 0; k < 3; k++) clickAt(p, p.targets().find(t => t.kind === 'junction' && t.dir !== 'N') || p.targets()[0]);
  const w = createWorld({ seed: 3 }), c = createFixed();
  runHeadless(w, c, 30); w.spawnAmbulance(p.trip()); runHeadless(w, c, 300);
  assert.equal(w.metrics().ambulance.state, 'arrived');
});
