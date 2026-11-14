// Metric accumulation. Computed by the world, never by a controller.
export function createMetrics() {
  let exited = 0, totalWait = 0;
  let recent = []; // { t, wait } for exits in the last 60 s
  return {
    onExit(car, now) {
      exited++; totalWait += car.waited;
      recent.push({ t: now, wait: car.waited });
    },
    read(now, conflicts, ambulance) {
      recent = recent.filter(e => e.t > now - 60);
      const rollingWait = recent.length ? recent.reduce((s, e) => s + e.wait, 0) / recent.length : 0;
      return {
        exited,
        avgWait: exited ? totalWait / exited : 0,
        rollingWait,
        throughputPerMin: recent.length,
        conflicts,
        ambulance,
      };
    },
  };
}
