// Metric accumulation. Computed by the world, never by a controller.
export function createMetrics() {
  let exited = 0, totalWait = 0, totalStops = 0;
  let recent = []; // { t, wait, stops } for exits in the last 60 s
  return {
    onExit(car, now) {
      const stops = car.stops || 0;
      exited++; totalWait += car.waited; totalStops += stops;
      recent.push({ t: now, wait: car.waited, stops });
    },
    read(now, conflicts, ambulance) {
      recent = recent.filter(e => e.t > now - 60);
      const avgRecent = k => (recent.length ? recent.reduce((s, e) => s + e[k], 0) / recent.length : 0);
      return {
        exited,
        avgWait: exited ? totalWait / exited : 0,
        rollingWait: avgRecent('wait'),
        stopsPerCar: exited ? totalStops / exited : 0,
        rollingStopsPerCar: avgRecent('stops'),
        throughputPerMin: recent.length,
        conflicts,
        ambulance,
      };
    },
  };
}
