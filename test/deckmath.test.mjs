import test from 'node:test';
import assert from 'node:assert/strict';
import { stretchParams, jogBend, outputPlan, spikeVerdict } from '../js/deckmath.js';

test('key lock keeps the pitch, turntable mode follows the speed', () => {
  assert.deepEqual(stretchParams(0), { rate: 1, semitones: 0 });
  const locked = stretchParams(8, 0, true);
  assert.ok(Math.abs(locked.rate - 1.08) < 1e-9);
  assert.equal(locked.semitones, 0);
  const vinyl = stretchParams(8, 0, false);
  assert.ok(Math.abs(vinyl.semitones - 1.3324) < 1e-3); // +8 % ≈ +1.33 semitones
  // doubling the speed is exactly one octave up
  assert.ok(Math.abs(stretchParams(100, 0, false).semitones - 12) < 1e-9);
});

test('jog bend multiplies on top of the tempo', () => {
  const { rate } = stretchParams(2, 0.04);
  assert.ok(Math.abs(rate - 1.02 * 1.04) < 1e-9);
});

test('jog values around 64 nudge forward and back, clamped', () => {
  assert.equal(jogBend(64), 0);
  assert.ok(Math.abs(jogBend(66) - 0.02) < 1e-9);
  assert.ok(Math.abs(jogBend(61) + 0.03) < 1e-9);
  assert.equal(jogBend(127), 0.08);
  assert.equal(jogBend(0), -0.08);
  assert.equal(jogBend(70, { sensitivity: 0.005, maxBend: 0.02 }), 0.02);
});

test('output plan: 4-channel controller gets a separate headphone pair', () => {
  assert.deepEqual(outputPlan(4), { channels: 4, master: [0, 1], cue: [2, 3], separateCue: true });
  assert.deepEqual(outputPlan(6, 3), { channels: 6, master: [0, 1], cue: [4, 5], separateCue: true });
  assert.equal(outputPlan(2).separateCue, false);
  assert.equal(outputPlan(4, 3).separateCue, false);
  assert.equal(outputPlan(undefined).channels, 2);
});

test('spike verdict needs all three go criteria', () => {
  assert.equal(spikeVerdict({ separateCue: true, totalLatency: 0.018, keyLockClean: true }).go, true);
  assert.equal(spikeVerdict({ separateCue: true, totalLatency: 0.03, keyLockClean: true }).latency, false);
  assert.equal(spikeVerdict({ separateCue: false, totalLatency: 0.01, keyLockClean: true }).go, false);
  assert.equal(spikeVerdict({ separateCue: true, totalLatency: NaN, keyLockClean: true }).go, false);
  assert.equal(spikeVerdict({ separateCue: true, totalLatency: 0.01, keyLockClean: null }).go, false);
});
