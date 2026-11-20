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

import { angleDelta, jogBendFromSpeed, scrubSeconds, dialValue, dialAngle, SECONDS_PER_TURN } from '../js/deckmath.js';

test('wheel angles wrap the short way round', () => {
  assert.ok(Math.abs(angleDelta(3.0, -3.0) - (2 * Math.PI - 6)) < 1e-9); // crossing ±π is a small step forward
  assert.ok(Math.abs(angleDelta(-3.0, 3.0) + (2 * Math.PI - 6)) < 1e-9);
  assert.equal(angleDelta(1, 1.5), 0.5);
});

test('spinning the wheel bends the speed; turning it paused scrubs', () => {
  assert.equal(jogBendFromSpeed(0), 0);
  assert.ok(Math.abs(jogBendFromSpeed(5) - 0.06) < 1e-9);
  assert.equal(jogBendFromSpeed(100), 0.12);
  assert.equal(jogBendFromSpeed(-100), -0.12);
  assert.equal(scrubSeconds(2 * Math.PI), SECONDS_PER_TURN);
  assert.equal(scrubSeconds(-Math.PI), -SECONDS_PER_TURN / 2);
});

test('dials: drag up to turn up, clamped; pointer sweeps 270°', () => {
  assert.equal(dialValue(0, -80, -30, 6), 6); // half the travel up from 0 would be +18: clamped to the +6 top
  assert.equal(dialValue(0, 80, -30, 6), -18);
  assert.equal(dialValue(0.5, -16, 0, 1), 0.6);
  assert.ok(Math.abs(dialAngle(0) + 0.75 * Math.PI) < 1e-9);
  assert.ok(Math.abs(dialAngle(0.5)) < 1e-9);
  assert.ok(Math.abs(dialAngle(2) - 0.75 * Math.PI) < 1e-9);
});

import { beatCount } from '../js/deckmath.js';

test('counting beats, bars and phrases', () => {
  const g = { bpm: 120, firstDownbeat: 1 }; // 0.5 s per beat, 2 s per bar, 32 s per 16-bar phrase
  assert.equal(beatCount(g, 0.9), null); // before the first "1"
  assert.deepEqual(beatCount(g, 1), { beat: 1, bar: 1, barInPhrase: 1, block: 1, barInBlock: 1, phrase: 1 });
  assert.deepEqual(beatCount(g, 1.5), { beat: 2, bar: 1, barInPhrase: 1, block: 1, barInBlock: 1, phrase: 1 });
  assert.equal(beatCount(g, 2.99).beat, 4);
  // bar 5 starts the second 4-bar block, bar 16 is the last bar of phrase 1, bar 17 starts phrase 2
  assert.deepEqual(beatCount(g, 1 + 4 * 2), { beat: 1, bar: 5, barInPhrase: 5, block: 2, barInBlock: 1, phrase: 1 });
  assert.deepEqual(beatCount(g, 1 + 15 * 2 + 1.5), { beat: 4, bar: 16, barInPhrase: 16, block: 4, barInBlock: 4, phrase: 1 });
  assert.deepEqual(beatCount(g, 1 + 16 * 2), { beat: 1, bar: 17, barInPhrase: 1, block: 1, barInBlock: 1, phrase: 2 });
  assert.equal(beatCount(null, 3), null);
});

import { LOOP_SIZES, JUMP_SIZES, loopAt, wrapInLoop, jumpBy, scaleLoop } from '../js/deckmath.js';

test('beat loops snap to the grid and playback wraps inside them', () => {
  const g = { bpm: 120, firstDownbeat: 1 }; // 0.5 s per beat
  assert.deepEqual(LOOP_SIZES, [0.25, 0.5, 1, 2, 4, 8, 16, 32]);
  assert.deepEqual(loopAt(g, 3.3, 4), { start: 3, end: 5, beats: 4 }); // starts on the beat at or before 3.3 s
  assert.deepEqual(loopAt(g, 3.3, 0.5), { start: 3.25, end: 3.5, beats: 0.5 }); // half-beat steps for short loops
  const l = loopAt(g, 3.0, 1);
  assert.equal(wrapInLoop(3.2, l), 3.2);
  assert.ok(Math.abs(wrapInLoop(3.6, l) - 3.1) < 1e-9);
  assert.ok(Math.abs(wrapInLoop(4.6, l) - 3.1) < 1e-9);
  assert.equal(wrapInLoop(9, null), 9);
  assert.deepEqual(scaleLoop({ start: 3, end: 5, beats: 4 }, 0.5, g), { start: 3, end: 4, beats: 2 });
  assert.equal(scaleLoop({ start: 3, end: 3.0625, beats: 0.125 }, 0.5, g).beats, 0.125); // never shorter than ⅛ beat
});

test('beat jump moves whole beats and stops at the start of the track', () => {
  const g = { bpm: 120, firstDownbeat: 1 };
  assert.deepEqual(JUMP_SIZES, [-1, 1, -2, 2, -4, 4, -8, 8]);
  assert.equal(jumpBy(g, 10, 4), 12);
  assert.equal(jumpBy(g, 10, -8), 6);
  assert.equal(jumpBy(g, 1, -8), 0);
});
