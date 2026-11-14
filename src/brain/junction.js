// Greenwave junction agent. Pure function of (state, inputs): reads only its own sensors and
// messages from adjacent junctions; outputs a single light state and messages for neighbours.
// Knows neighbours only by direction. Portable to a microcontroller.
import { DIRS, opposite, servingPhase, initSignal, advance, chooseByPressure, forecastWeight } from './phases.js';

export const PLATOON_ETA_S = 10;    // block length / cruise speed
export const FORECAST_EXPIRY_S = 3;

export function init() {
  return { sig: initSignal(), forecasts: [], priority: null, seen: [], lastSiren: null };
}

/**
 * @param state  value returned by init() or a previous step (never mutated)
 * @param inputs { now, queues:{N,E,S,W}, departures:{N,E,S,W}, inbox:[msg], sirenNear: dir|null }
 * @returns { state, lights: 'NS'|'EW'|'ALL_RED', outbox: [{ to: dir, msg }] }
 */
export function step(state, inputs) {
  const { now, queues, departures, inbox } = inputs;
  const outbox = [];

  let forecasts = state.forecasts.slice();
  for (const m of inbox) {
    if (m.type === 'PLATOON') forecasts.push({ approach: m.approach, count: m.count, at: now + m.etaSec });
  }
  forecasts = forecasts.filter(f => f.at >= now - FORECAST_EXPIRY_S);

  const scores = { NS: 0, EW: 0 };
  for (const d of DIRS) scores[servingPhase(d)] += queues[d];
  for (const f of forecasts) scores[servingPhase(f.approach)] += f.count * forecastWeight(f.at - now);

  // During all-red keep the committed target so a forced (max-green) switch cannot bounce back.
  const want = state.sig.phase === 'ALL_RED'
    ? state.sig.target
    : chooseByPressure(state.sig.phase, scores, now - state.sig.since);
  const sig = advance(state.sig, want, now);

  for (const d of DIRS) {
    if (departures[d] > 0) {
      outbox.push({ to: d, msg: { type: 'PLATOON', approach: opposite(d), count: departures[d], etaSec: PLATOON_ETA_S } });
    }
  }

  return { state: { ...state, sig, forecasts }, lights: sig.phase, outbox };
}
