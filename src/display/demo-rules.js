// Demo rules shared by the display controls. Kept separate so they can be tested headlessly.

/** All panels must run the same ambulance: only spawn when no panel has one driving. */
export function canSpawnAmbulance(worlds) {
  return worlds.every(w => w.metrics().ambulance.state !== 'driving');
}
