import test from 'node:test';
import assert from 'node:assert/strict';
import { progressKeysIn, resetProgress } from '../js/reset.js';

function fakeStorage(obj) {
  const m = new Map(Object.entries(obj));
  return { get length() { return m.size; }, key: (i) => [...m.keys()][i] ?? null, removeItem: (k) => m.delete(k), has: (k) => m.has(k) };
}

test('start again wipes progress and pack saves only', () => {
  const keys = ['learn.level', 'learn.career', 'learn.completed', 'learn.pack.djlife', 'learn.packs', 'learn.prefs', 'learn.cues', 'learn.source', 'learn.anthropicKey', 'cuecoach.midimap'];
  assert.deepEqual(progressKeysIn(keys).sort(), ['learn.career', 'learn.completed', 'learn.level', 'learn.pack.djlife']);
});

test('resetProgress removes from storage and counts', () => {
  const s = fakeStorage({ 'learn.level': '"club"', 'learn.mixHistory': '[]', 'learn.pack.djlife': '{}', 'learn.prefs': '{}', 'learn.savedSets': '[]' });
  assert.equal(resetProgress(s), 3);
  assert.equal(s.has('learn.level'), false); assert.equal(s.has('learn.pack.djlife'), false);
  assert.equal(s.has('learn.prefs'), true); assert.equal(s.has('learn.savedSets'), true);
});
