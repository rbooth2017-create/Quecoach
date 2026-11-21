import test from 'node:test';
import assert from 'node:assert/strict';
import { STOPS, stopsFor, step, shouldAutoStart, progressLabel } from '../js/tour.js';
import { FEATURES } from '../js/levels.js';

test('stops have a target, a title and short text', () => {
  const ids = new Set();
  for (const s of STOPS) {
    assert.ok(s.target && s.title && s.text, s.id);
    assert.ok(s.text.length < 200, `${s.id} is too long for a tour card`);
    assert.ok(!ids.has(s.id)); ids.add(s.id);
    if (s.needs) assert.ok(FEATURES.includes(s.needs), `${s.id} needs an unknown feature`);
    assert.ok(!/\bsync\b/i.test(s.text));
  }
  assert.ok(STOPS.length >= 7 && STOPS.length <= 12);
});

test('stops follow the level', () => {
  const starter = stopsFor('starter').map((s) => s.id), confident = stopsFor('confident').map((s) => s.id);
  assert.ok(!starter.includes('keylock'), 'Starter has no key lock');
  assert.ok(starter.includes('lane'));
  assert.ok(confident.includes('keylock'));
  assert.ok(!confident.includes('lane'), 'Confident hides the beat lane');
  assert.deepEqual(starter, STOPS.filter((s) => starter.includes(s.id)).map((s) => s.id), 'order is kept');
});

test('stops whose area is hidden are skipped', () => {
  assert.ok(!stopsFor('pro', (s) => s.id !== 'ai').some((s) => s.id === 'ai'));
});

test('moving through the tour', () => {
  assert.equal(step(0, -1, 5), 0);
  assert.equal(step(0, 1, 5), 1);
  assert.equal(step(4, 1, 5), -1);
  assert.equal(progressLabel(2, 8), '3 of 8');
});

test('starts once, after a music source is chosen', () => {
  assert.equal(shouldAutoStart({ done: false, hasSource: true, welcomeOpen: false }), true);
  assert.equal(shouldAutoStart({ done: true, hasSource: true, welcomeOpen: false }), false);
  assert.equal(shouldAutoStart({ done: false, hasSource: false, welcomeOpen: false }), false);
  assert.equal(shouldAutoStart({ done: false, hasSource: true, welcomeOpen: true }), false);
});
