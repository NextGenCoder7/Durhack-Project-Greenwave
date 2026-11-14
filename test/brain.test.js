import { test } from 'node:test';
import assert from 'node:assert/strict';
import { init, step } from '../src/brain/junction.js';
import { mulberry32 } from '../src/world/rng.js';

const Z = { N: 0, E: 0, S: 0, W: 0 };
const S = (o = {}) => ({ now: 0, queues: { ...Z }, departures: { ...Z }, inbox: [], sirenNear: null, ...o });

/** Run the brain from t0 to t1 (inclusive) every 0.25 s with a fixed input builder. Returns { st, log }. */
function drive(st, t0, t1, inputsAt) {
  const log = [];
  for (let i = Math.round(t0 * 4); i <= Math.round(t1 * 4); i++) {
    const now = i / 4;
    const out = step(st, S({ now, ...inputsAt(now) }));
    st = out.state; log.push({ now, lights: out.lights, outbox: out.outbox });
  }
  return { st, log };
}
const at = (log, t) => log.find(e => Math.abs(e.now - t) < 1e-9).lights;

test('property: valid lights, all-red >=2s between greens, min green 6s (10k steps)', () => {
  const r = mulberry32(9); let st = init(), prevGreen = null, allRedFrom = null, greenFrom = 0;
  for (let i = 0; i < 10000; i++) {
    const now = i * 0.25, q = () => Math.floor(r() * 12);
    const inbox = r() < 0.2 ? [{ type: 'PLATOON', approach: 'NESW'[Math.floor(r() * 4)], count: q(), etaSec: r() * 20 }] : [];
    const out = step(st, S({ now, queues: { N: q(), E: q(), S: q(), W: q() }, inbox })); st = out.state;
    assert.ok(['NS', 'EW', 'ALL_RED'].includes(out.lights));
    if (out.lights === 'ALL_RED') { if (allRedFrom === null) allRedFrom = now; }
    else {
      if (prevGreen !== null && out.lights !== prevGreen) assert.ok(now - allRedFrom >= 2 - 1e-9, `all-red too short at ${now}`);
      if (out.lights !== prevGreen || allRedFrom !== null) {
        if (prevGreen !== null) assert.ok(allRedFrom - greenFrom >= 6 - 1e-9, `green too short at ${now}`);
        greenFrom = now;
      }
      prevGreen = out.lights; allRedFrom = null;
    }
  }
});

test('switches to the heavier axis after min green', () => {
  let { st, log } = drive(init(), 0, 2, () => ({ queues: { ...Z, N: 10 } }));
  assert.equal(at(log, 2), 'NS');
  ({ log } = drive(st, 2.25, 11, () => ({ queues: { N: 0, S: 0, E: 10, W: 10 } })));
  assert.equal(at(log, 7.75), 'NS');
  assert.equal(at(log, 8), 'ALL_RED');
  assert.equal(at(log, 9.75), 'ALL_RED');
  assert.equal(at(log, 10), 'EW');
});

test('platoon forecast tips the decision', () => {
  const base = drive(init(), 0, 7.75, () => ({ queues: { ...Z, N: 5 } })).st;
  const q = { N: 3, S: 0, E: 0, W: 3 };
  const without = step(base, S({ now: 8, queues: q }));
  assert.equal(without.lights, 'NS');
  const withP = step(base, S({ now: 8, queues: q, inbox: [{ type: 'PLATOON', approach: 'W', count: 6, etaSec: 3 }] }));
  assert.equal(withP.lights, 'ALL_RED');
  assert.equal(withP.state.sig.target, 'EW');
});

test('departures produce PLATOON to that exit', () => {
  const out = step(init(), S({ departures: { N: 0, E: 4, S: 0, W: 0 } }));
  assert.deepEqual(out.outbox, [{ to: 'E', msg: { type: 'PLATOON', approach: 'W', count: 4, etaSec: 10 } }]);
});

test('forecasts expire 3s after due', () => {
  let st = step(init(), S({ now: 0, inbox: [{ type: 'PLATOON', approach: 'W', count: 2, etaSec: 1 }] })).state;
  assert.equal(st.forecasts.length, 1);
  st = step(st, S({ now: 4 })).state;
  assert.equal(st.forecasts.length, 1);
  st = step(st, S({ now: 4.25 })).state;
  assert.equal(st.forecasts.length, 0);
});

test('does not mutate input state', () => {
  const s = init(); const copy = structuredClone(s);
  step(s, S({ queues: { ...Z, N: 5 }, inbox: [{ type: 'PLATOON', approach: 'W', count: 2, etaSec: 1 }] }));
  assert.deepEqual(s, copy);
});
