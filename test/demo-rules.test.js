import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canSpawnAmbulance } from '../src/display/demo-rules.js';

const W = state => ({ metrics: () => ({ ambulance: { state } }) });

test('spawn allowed only when no panel has an ambulance driving', () => {
  assert.equal(canSpawnAmbulance([W('none'), W('none'), W('none')]), true);
  assert.equal(canSpawnAmbulance([W('arrived'), W('arrived'), W('arrived')]), true);
  assert.equal(canSpawnAmbulance([W('arrived'), W('driving'), W('arrived')]), false);
});
