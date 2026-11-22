import test from 'node:test';
import assert from 'node:assert/strict';
import { starsFor, lockAmount, speedAdvice, nudgeAdvice, vibeStep, vibeWords } from '../js/playscore.js';
import { CLEAN_SCORE } from '../js/mixreport.js';

test('stars: a clean mix is two, butter is three', () => {
  assert.equal(starsFor(95), 3);
  assert.equal(starsFor(CLEAN_SCORE), 2);
  assert.equal(starsFor(60), 1);
  assert.equal(starsFor(20), 0);
});

test('lock: speed first, then the beats', () => {
  assert.equal(lockAmount(null), 0);
  assert.equal(lockAmount(5), 0);
  assert.equal(lockAmount(0.05), 0.85, 'speed matched, not playing together yet');
  assert.equal(lockAmount(0.05, 10), 1);
  assert.ok(lockAmount(0.05, 60) < lockAmount(0.05, 30));
  assert.ok(lockAmount(0.05, 500) >= 0.35, 'speed matched always counts for something');
  assert.ok(lockAmount(1) < lockAmount(0.3));
  assert.ok(lockAmount(1, 0) < 1, 'beats together by luck but speeds apart is not locked');
});

test('speed advice in plain words, the right way round', () => {
  assert.equal(speedAdvice(-0.3).dir, 'faster');
  assert.match(speedAdvice(-0.3).text, /a touch slow/);
  assert.equal(speedAdvice(2.5).dir, 'slower');
  assert.match(speedAdvice(2.5).text, /quite a bit fast/);
  assert.equal(speedAdvice(0.05).dir, null);
  assert.equal(speedAdvice(null).dir, null);
});

test('nudge advice: ahead means push back', () => {
  assert.equal(nudgeAdvice(40).dir, 'back');
  assert.equal(nudgeAdvice(-40).dir, 'ahead');
  assert.equal(nudgeAdvice(10).dir, null);
  assert.equal(nudgeAdvice(null).dir, null);
});

test('the vibe: silence and trainwrecks empty the floor, clean blends fill it; bigger rooms are pickier', () => {
  const run = (now, secs, start = 0.5, picky = 1) => { let v = start; for (let i = 0; i < secs * 10; i++) v = vibeStep(v, now, 0.1, picky); return v; };
  assert.ok(run({ audible: true, locked: true }, 5) > 0.7);
  assert.ok(run({ audible: false }, 3) < 0.2);
  assert.ok(run({ audible: true, clash: true }, 3) < 0.5);
  assert.ok(run({ audible: true, clash: true }, 3, 0.5, 1.5) < run({ audible: true, clash: true }, 3, 0.5, 0.6));
  assert.ok(Math.abs(run({ audible: true }, 30) - 0.6) < 0.05, 'music on its own settles around nodding along');
  assert.equal(vibeStep(1, { audible: true, locked: true }, 10), 1);
  assert.equal(vibeStep(0, { audible: false }, 10), 0);
});

test('vibe words fit the room', () => {
  assert.match(vibeWords(0.9, 3), /mates/);
  assert.match(vibeWords(0.9, 40), /packed/);
  assert.match(vibeWords(0.1, 40), /emptying/);
});
