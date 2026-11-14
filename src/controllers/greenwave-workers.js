// Browser host for Greenwave: 16 Web Workers, one per junction, each running its own decision loop.
// The main thread only pushes sensor readings + delivered messages (every ~100 ms real) and relays
// each worker's outbox over the world's link layer. It never asks a worker for a decision.
const PUSH_MS = 100;

export function createGreenwaveWorkers({ speed = 3 } = {}) {
  let workers = null;
  let world = null;
  let lastPush = -Infinity;

  function start(w) {
    world = w;
    workers = Array.from({ length: 16 }, (_, j) => {
      const wk = new Worker(new URL('../worker/junction-worker.js', import.meta.url), { type: 'module', name: `junction-${j}` });
      wk.onmessage = (e) => {
        if (!workers) return;
        const { lights, outbox } = e.data;
        world.setLights(j, lights);
        for (const o of outbox) world.send(j, o.to, o.msg);
      };
      wk.postMessage({ type: 'start', speed });
      return wk;
    });
  }

  return {
    name: 'greenwave',
    tick(w) {
      if (!workers) start(w);
      const t = performance.now();
      if (t - lastPush < PUSH_MS) return;
      lastPush = t;
      for (let j = 0; j < 16; j++) {
        workers[j].postMessage({ type: 'sensors', sensors: w.readSensors(j), inbox: w.takeInbox(j) });
      }
    },
    setSpeed(s) {
      speed = s;
      if (workers) for (const wk of workers) wk.postMessage({ type: 'speed', speed: s });
    },
    terminate() {
      if (workers) for (const wk of workers) wk.terminate();
      workers = null;
    },
  };
}
