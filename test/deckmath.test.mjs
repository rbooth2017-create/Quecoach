import test from 'node:test';
import assert from 'node:assert/strict';
import { stretchParams, jogBend, outputPlan, spikeVerdict, keyLockSemitones, heardPosition } from '../js/deckmath.js';
import { featuresFor } from '../js/levels.js';

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

import { phraseBeat, phraseOffset } from '../js/deckmath.js';

// 120 BPM: one beat = 0.5 s, one bar = 2 s, one 16-bar phrase = 32 s
const G = { bpm: 120, firstDownbeat: 1 };
const at = (g, beatsIn) => g.firstDownbeat + beatsIn * 60 / g.bpm;
const near = (a, b) => Math.abs(a - b) < 1e-9;

test('phrase beat: counts beats into the 64-beat phrase and wraps', () => {
  assert.equal(phraseBeat(G, 0.5), null); // before the first downbeat
  assert.equal(phraseBeat(null, 3), null);
  assert.ok(near(phraseBeat(G, at(G, 0)), 0));
  assert.ok(near(phraseBeat(G, at(G, 10.25)), 10.25));
  assert.ok(near(phraseBeat(G, at(G, 64 + 3)), 3));
});

test('phrase offset: same bar and beat is 0, nothing to align', () => {
  const o = phraseOffset(G, at(G, 20), G, at(G, 64 + 20));
  assert.equal(o.beats, 0); assert.equal(o.canAlign, false);
  assert.ok(Object.is(phraseOffset(G, at(G, 5), G, at(G, 5)).beats, 0));
});

test('phrase offset: B two bars behind jumps forward 8 beats and lands on A\'s beat and bar', () => {
  const pA = at(G, 4 * 6), pB = at(G, 4 * 4); // A on bar 7, B on bar 5
  const o = phraseOffset(G, pA, G, pB);
  assert.equal(o.beats, 8); assert.equal(o.bars, 2); assert.equal(o.canAlign, true);
  assert.ok(near(o.target, pB + 4));
  const a = beatCount(G, pA), b = beatCount(G, o.target);
  assert.equal(b.barInPhrase, a.barInPhrase); assert.equal(b.beat, a.beat);
});

test('phrase offset: three beats ahead jumps back 3', () => {
  const o = phraseOffset(G, at(G, 8), G, at(G, 11));
  assert.equal(o.beats, -3); assert.equal(o.canAlign, true);
  assert.ok(near(o.target, at(G, 8)));
});

test('phrase offset: goes the short way round the phrase', () => {
  // A on bar 1 beat 1 of phrase 2, B on bar 16 beat 4 of phrase 1 → one beat forward, not 63 back
  const o = phraseOffset(G, at(G, 64), G, at(G, 63));
  assert.equal(o.beats, 1); assert.equal(o.canAlign, true);
});

test('phrase offset: works with different BPMs on each deck', () => {
  const GA = { bpm: 122, firstDownbeat: 0.4 }, GB = { bpm: 124, firstDownbeat: 2.1 };
  const pA = at(GA, 4 * 9 + 2), pB = at(GB, 4 * 7 + 2); // A bar 10 beat 3, B bar 8 beat 3
  const o = phraseOffset(GA, pA, GB, pB);
  assert.equal(o.beats, 8);
  assert.ok(near(o.target, pB + 8 * 60 / 124));
  const b = beatCount(GB, o.target + 1e-6);
  assert.equal(b.barInPhrase, 10); assert.equal(b.beat, 3);
});

test('phrase offset: keeps B\'s place within the beat (its beatmatching)', () => {
  // B is 4 beats behind and 0.1 beat late
  const pA = at(G, 12), pB = at(G, 8 - 0.1);
  const o = phraseOffset(G, pA, G, pB);
  assert.equal(o.beats, 4);
  assert.ok(near(phraseBeat(G, o.target), 12 - 0.1));
});

test('phrase offset: more than 2 bars apart, or landing outside the music, is flagged but not aligned', () => {
  const far = phraseOffset(G, at(G, 12), G, at(G, 0));
  assert.equal(far.beats, 12); assert.equal(far.canAlign, false);
  const early = phraseOffset(G, at(G, 0), G, at(G, 2)); // 2 beats back lands exactly on the first downbeat: fine
  assert.equal(early.beats, -2); assert.equal(early.canAlign, true);
  const before = phraseOffset(G, at(G, 62), G, at(G, 1)); // −3 beats from beat 1 → before the first downbeat
  assert.equal(before.beats, -3); assert.equal(before.canAlign, false);
  const pastEnd = phraseOffset(G, at(G, 16), G, at(G, 8), { duration: at(G, 10) });
  assert.equal(pastEnd.beats, 8); assert.equal(pastEnd.canAlign, false);
  assert.equal(phraseOffset(G, at(G, 12), G, at(G, 0), { maxBeats: 16 }).canAlign, true);
});

test('phrase offset: no grid or before the first downbeat gives null', () => {
  assert.equal(phraseOffset(null, 3, G, 3), null);
  assert.equal(phraseOffset(G, 3, G, 0.2), null);
});

test('key lock shifts the pitch back by exactly what the tempo moved it', () => {
  assert.equal(keyLockSemitones(0), 0);
  for (const pct of [-16, -8, -0.5, 3, 8, 16]) {
    assert.ok(Math.abs(keyLockSemitones(pct) + stretchParams(pct, 0, false).semitones) < 1e-12);
  }
  assert.ok(Math.abs(keyLockSemitones(100) + 12) < 1e-12); // double speed → down one octave
});

test('heard position trails the playhead by the key lock delay', () => {
  assert.equal(heardPosition({ raw: 10 }), 10); // no key lock: no delay
  // 60 ms late at +8 %: 64.8 ms of track behind
  assert.ok(Math.abs(heardPosition({ raw: 10, lag: 0.06, rate: 1.08, since: 5 }) - (10 - 0.0648)) < 1e-9);
  // right after play, nothing has come out yet: stay on the start point instead of going back before it
  assert.equal(heardPosition({ raw: 4.02, lag: 0.06, rate: 1, since: 0.02, startOffset: 4 }), 4);
});

test('key lock is a tool from Improver on, not for Starter', () => {
  assert.equal(featuresFor('starter').keyLock, false);
  for (const l of ['improver', 'confident', 'pro']) assert.equal(featuresFor(l).keyLock, true);
});

import { dialT, dialFromT } from '../js/deckmath.js';
test('a centred dial puts 0 dB at 12 o\'clock and maps back', () => {
  assert.equal(dialT(0, -30, 6, 0), 0.5);
  assert.equal(dialT(-30, -30, 6, 0), 0);
  assert.equal(dialT(6, -30, 6, 0), 1);
  assert.equal(dialT(-15, -30, 6, 0), 0.25);
  assert.equal(dialT(3, -30, 6, 0), 0.75);
  for (const v of [-30, -12, -0.5, 0, 2, 6]) assert.ok(Math.abs(dialFromT(dialT(v, -30, 6, 0), -30, 6, 0) - v) < 1e-9);
  assert.equal(dialT(0.25, 0, 1), 0.25); // no centre: straight line
  assert.equal(dialFromT(0.5, 0, 1.25, 1), 1);
});

test('key shift moves round the Camelot wheel', async () => {
  const { shiftCamelot } = await import('../js/deckmath.js');
  assert.equal(shiftCamelot('8A', 1), '3A');
  assert.equal(shiftCamelot('8A', -1), '1A');
  assert.equal(shiftCamelot('12B', 12), '12B');
  assert.equal(shiftCamelot('8A', 0), '8A');
  assert.equal(shiftCamelot(null, 2), null);
});
