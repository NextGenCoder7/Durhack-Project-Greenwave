// One junction = one worker. Thin wrapper: it only exchanges messages with the main thread,
// which acts as the junction's sensors and its wires to neighbours. All decisions are brain.step.
import { init, step } from '../brain/junction.js';

const ZERO = () => ({ N: 0, E: 0, S: 0, W: 0 });
let state = init();
let latest = null;          // most recent sensor reading (sim time in latest.now)
let departures = ZERO();    // accumulated across sensor pushes until the brain consumes them
let inbox = [];
let lastLights = null;
let timer = null;

function stepBrain() {
  if (!latest) return;
  const out = step(state, { ...latest, departures, inbox });
  state = out.state;
  departures = ZERO();
  inbox = [];
  if (out.lights !== lastLights || out.outbox.length) {
    lastLights = out.lights;
    postMessage({ lights: out.lights, outbox: out.outbox });
  }
}

function setSpeed(speed) {
  if (timer) clearInterval(timer);
  timer = setInterval(stepBrain, 250 / speed);   // 0.25 s of sim time per brain step
}

onmessage = (e) => {
  const m = e.data;
  if (m.type === 'start' || m.type === 'speed') setSpeed(m.speed);
  else if (m.type === 'sensors') {
    latest = m.sensors;
    for (const d in departures) departures[d] += m.sensors.departures[d];
    for (const msg of m.inbox) inbox.push(msg);
  }
};
