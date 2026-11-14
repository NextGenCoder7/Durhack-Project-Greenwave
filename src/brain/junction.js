// Greenwave junction agent. Pure function of (state, inputs): reads only its own sensors and
// messages from adjacent junctions; outputs a single light state and messages for neighbours.
// Knows neighbours only by direction. Portable to a microcontroller.
import { DIRS, opposite, servingPhase, initSignal, advance, chooseByPressure, forecastWeight } from './phases.js';

export const PLATOON_ETA_S = 10;     // block length / cruise speed
export const FORECAST_EXPIRY_S = 3;
export const HOP_ETA_S = 10;         // added per forwarded hop
export const PRIORITY_HORIZON_S = 15;
export const PRIORITY_TIMEOUT_S = 20;
export const STALE_ETA_S = -3;
export const REFRESH_HOPS = 3;
const SEEN_MAX = 32;

export function init() {
  return { sig: initSignal(), forecasts: [], priority: null, seen: [], lastSiren: null, passed: null };
}

/**
 * @param state  value returned by init() or a previous step (never mutated)
 * @param inputs { now, queues:{N,E,S,W}, departures:{N,E,S,W}, inbox:[msg], sirenNear: dir|null }
 * @returns { state, lights: 'NS'|'EW'|'ALL_RED', outbox: [{ to: dir, msg }] }
 */
export function step(state, inputs) {
  const { now, queues, departures, inbox, sirenNear = null } = inputs;
  const outbox = [];
  let { priority, seen, passed } = state;

  // 1. Ingest messages.
  let forecasts = state.forecasts.slice();
  for (const m of inbox) {
    if (m.type === 'PLATOON') {
      forecasts.push({ approach: m.approach, count: m.count, at: now + m.etaSec });
    } else if (m.type === 'PRIORITY') {
      if (m.etaSec < STALE_ETA_S) continue;
      if (passed && passed.id === m.id && m.seq <= passed.seq) continue;
      const key = `${m.id}:${m.seq}`;
      if (seen.includes(key)) continue;
      seen = [...seen, key].slice(-SEEN_MAX);
      if (!priority || priority.id !== m.id || m.seq >= priority.seq) {
        priority = { id: m.id, approach: m.approach, arriveAt: now + m.etaSec, route: m.route, seq: m.seq };
      }
      if (m.hopsLeft > 0 && m.route.length) {
        const to = m.route[0];
        outbox.push({ to, msg: { ...m, approach: opposite(to), route: m.route.slice(1), etaSec: m.etaSec + HOP_ETA_S, hopsLeft: m.hopsLeft - 1 } });
      }
    }
  }
  forecasts = forecasts.filter(f => f.at >= now - FORECAST_EXPIRY_S);

  // 2. Siren fallback: a cut-off junction still hears the ambulance on an approach.
  if (sirenNear && !(priority && priority.approach === sirenNear)) {
    priority = { id: 'siren', approach: sirenNear, arriveAt: now, route: [], seq: -1 };
  }

  // 3. Ambulance passed (siren left our approach) -> clear and roll the corridor forward.
  if (priority && state.lastSiren === priority.approach && sirenNear === null) {
    const { id, seq, route } = priority;
    if (route.length) {
      const to = route[0];
      outbox.push({ to, msg: { type: 'PRIORITY', id, seq: seq + 1, approach: opposite(to), route: route.slice(1), etaSec: HOP_ETA_S, hopsLeft: REFRESH_HOPS } });
    }
    passed = { id, seq };
    priority = null;
  } else if (priority && now > priority.arriveAt + PRIORITY_TIMEOUT_S) {
    priority = null;   // lost ambulance must not freeze the junction
  }

  // 4. Decide.
  const active = !!priority && (priority.arriveAt - now <= PRIORITY_HORIZON_S || sirenNear === priority.approach);
  let want;
  if (active) {
    want = servingPhase(priority.approach);
  } else {
    const scores = { NS: 0, EW: 0 };
    for (const d of DIRS) scores[servingPhase(d)] += queues[d];
    for (const f of forecasts) scores[servingPhase(f.approach)] += f.count * forecastWeight(f.at - now);
    // During all-red keep the committed target so a forced (max-green) switch cannot bounce back.
    want = state.sig.phase === 'ALL_RED' ? state.sig.target : chooseByPressure(state.sig.phase, scores, now - state.sig.since);
  }
  const sig = advance(state.sig, want, now, { ignoreMinGreen: active });

  // 5. Tell downstream neighbours what we just released.
  for (const d of DIRS) {
    if (departures[d] > 0) {
      outbox.push({ to: d, msg: { type: 'PLATOON', approach: opposite(d), count: departures[d], etaSec: PLATOON_ETA_S } });
    }
  }

  return {
    state: { ...state, sig, forecasts, priority, seen, passed, lastSiren: sirenNear },
    lights: sig.phase,
    outbox,
  };
}
