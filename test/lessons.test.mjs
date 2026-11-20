import test from 'node:test';
import assert from 'node:assert/strict';
import { LESSONS, TIERS, advanceLesson, stepIndex, nextLesson, courseProgress, lessonById } from '../js/lessons.js';
import { VIBES, targetEnergy, quickSet, setMinutes, slimTrack } from '../js/setbuilder.js';
import { practiceLibrary } from '../js/musiclib.js';

const deck = (o = {}) => ({ loaded: false, playing: false, bpm: null, camelot: null, eqLow: 0, playedBars: 0, ...o });
const mix = (o = {}) => ({ left: deck(o.left), right: deck(o.right), bpmDiff: null, offsetMs: null, barOffset: null, alignedFor: 0, xfader: 0, keyScore: 0, did: new Set(), ...o, ...{ left: deck(o.left), right: deck(o.right) } });

test('the course runs from beginner to novice with unique ids and real steps', () => {
  assert.deepEqual(TIERS.map((t) => t.id), ['beginner', 'novice']);
  assert.ok(LESSONS.length >= 10);
  assert.equal(new Set(LESSONS.map((l) => l.id)).size, LESSONS.length);
  for (const l of LESSONS) {
    assert.ok(TIERS.some((t) => t.id === l.tier), l.id);
    assert.ok(l.steps.length >= 2 && l.why && l.title, l.id);
    assert.equal(new Set(l.steps.map((s) => s.id)).size, l.steps.length, `${l.id} step ids`);
    for (const st of l.steps) assert.equal(typeof st.done(mix()), 'boolean', `${l.id}/${st.id} on an empty mix`);
  }
  // beginner lessons all come before novice ones
  const firstNovice = LESSONS.findIndex((l) => l.tier === 'novice');
  assert.ok(LESSONS.slice(firstNovice).every((l) => l.tier === 'novice'));
});

test('steps tick in order and stay ticked', () => {
  const l = lessonById('decks');
  let t = advanceLesson(l, mix({ left: { loaded: true, playing: true } }));
  assert.deepEqual([...t], ['load', 'play']);
  assert.equal(stepIndex(l, t), 2);
  // pausing later doesn't undo "press play", and a later step can't be ticked out of order
  t = advanceLesson(l, mix({ left: { loaded: true, playing: false }, did: new Set(['scrub']) }), t);
  assert.deepEqual([...t], ['load', 'play']);
  t = advanceLesson(l, mix({ left: { loaded: true }, did: new Set(['restart', 'scrub']) }), t);
  assert.equal(stepIndex(l, t), l.steps.length);
});

test('the bass swap needs the right EQ moves', () => {
  const l = lessonById('bass-swap');
  const playing = { loaded: true, playing: true, bpm: 124 };
  const base = { bpmDiff: 0, alignedFor: 3 };
  let t = advanceLesson(l, mix({ ...base, left: playing, right: { ...playing, eqLow: -30 }, xfader: 0.5 }));
  assert.deepEqual([...t], ['cut', 'blend']);
  t = advanceLesson(l, mix({ ...base, left: { ...playing, eqLow: -30 }, right: { ...playing, eqLow: 0 }, xfader: 0.5 }), t);
  assert.deepEqual([...t], ['cut', 'blend', 'swap']);
  assert.equal(l.needs, 'bassEQ');
});

test('next lesson and course progress', () => {
  assert.equal(nextLesson('decks').id, 'counting');
  assert.equal(nextLesson('decks', ['counting']).id, 'speed');
  assert.equal(nextLesson(LESSONS.at(-1).id, LESSONS.map((l) => l.id)), null);
  const p = courseProgress(['decks', 'counting', 'phrase']);
  assert.equal(p.done, 3); assert.equal(p.total, LESSONS.length);
  assert.equal(p.tiers[0].done, 2); assert.equal(p.tiers[1].done, 1);
});

test('energy curves follow the vibe', () => {
  assert.equal(VIBES.length, 4);
  assert.ok(targetEnergy('warmup', 0) < targetEnergy('warmup', 1));
  assert.ok(targetEnergy('closing', 0) > targetEnergy('closing', 1));
  const j = [0, 0.5, 1].map((t) => targetEnergy('journey', t));
  assert.ok(j[1] > j[0] && j[1] > j[2]);
  assert.equal(targetEnergy('peak', 2), targetEnergy('peak', 1)); // clamped
});

test('quick set: right length, no repeats, starts where asked', () => {
  const lib = practiceLibrary();
  const set = quickSet(lib, { minutes: 30, vibe: 'warmup' });
  assert.ok(set.length >= 6 && set.length <= 10, `got ${set.length}`);
  assert.equal(new Set(set.map((i) => i.track.id)).size, set.length);
  assert.ok(setMinutes(set) >= 30);
  assert.ok(set.every((i) => typeof i.why === 'string' && i.why.length > 5));
  const fromFirst = quickSet(lib, { minutes: 15, first: lib[5] });
  assert.equal(fromFirst[0].track.id, lib[5].id);
  assert.deepEqual(quickSet([], { minutes: 30 }), []);
});

test('the AI only gets track details, never file paths', () => {
  const s = slimTrack({ id: 'file:House/a.mp3', title: 'A', artist: 'B', bpm: 124.04, camelot: '8A', energy: 6, duration: 312, relPath: 'House/a.mp3', path: '/Users/me/a.mp3' });
  assert.deepEqual(s, { id: 'file:House/a.mp3', title: 'A', artist: 'B', genre: '', bpm: 124, key: '8A', energy: 6, minutes: 5.2 });
});
