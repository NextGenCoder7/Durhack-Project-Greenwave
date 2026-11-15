import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSchedule, entryJunction, AMBULANCE, randomAmbulanceTrip } from '../src/world/schedule.js';
import { mulberry32 } from '../src/world/rng.js';
import { neighbour, opposite } from '../src/world/grid.js';

function checkRoute(entry, route) {
  let j = entryJunction(entry), heading = opposite(entry.side);
  route.forEach((exit, i) => {
    assert.notEqual(exit, opposite(heading));
    const next = neighbour(j, exit);
    if (i < route.length - 1) assert.notEqual(next, null);
    else assert.equal(next, null);
    j = next; heading = exit;
  });
}
test('same seed gives identical schedule', () => assert.deepEqual(buildSchedule(42), buildSchedule(42)));
test('different seed differs', () => assert.notDeepEqual(buildSchedule(42), buildSchedule(43)));
test('every route is valid and leaves the grid', () => {
  for (const s of buildSchedule(42)) checkRoute(s.entry, s.route);
});
test('ambulance route is valid', () => checkRoute(AMBULANCE.entry, AMBULANCE.route));
test('sorted by time', () => {
  const s = buildSchedule(42);
  for (let i = 1; i < s.length; i++) assert.ok(s[i].t >= s[i - 1].t);
});
test('rate roughly matches', () => {
  const n = buildSchedule(1, { duration: 1200, rate: 1 / 12 }).length;
  assert.ok(n > 1200 / 12 * 16 * 0.8 && n < 1200 / 12 * 16 * 1.2, `n=${n}`);
});
test('random ambulance trips are valid, cross >= 4 junctions, and are deterministic per rng seed', () => {
  for (let seed = 1; seed <= 200; seed++) {
    const t = randomAmbulanceTrip(mulberry32(seed));
    checkRoute(t.entry, t.route);
    assert.ok(t.route.length >= 4, `seed ${seed}: ${t.route.length}`);
    assert.deepEqual(t, randomAmbulanceTrip(mulberry32(seed)));
  }
});
