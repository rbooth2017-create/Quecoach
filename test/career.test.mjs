import test from 'node:test';
import assert from 'node:assert/strict';
import { VENUES, GIG, BRIEFS, CHALLENGES, CHALLENGE_BONUS, newCareer, loadCareer, recordMix, takeBooking, syncToLevel, gigProgress, venueForLevel, nextVenue, levelCap, dailyChallenge } from '../js/career.js';
import { allowedLevel, levelLocked, featuresFor, FEATURES } from '../js/levels.js';
import { LEVELS } from '../js/levels.js';

test('five venues, bedroom to main room, every level has one and they never go back down', () => {
  assert.deepEqual(VENUES.map((v) => v.id), ['bedroom', 'party', 'basement', 'warehouse', 'main']);
  const order = LEVELS.map((l) => l.id);
  for (const l of order) assert.ok(VENUES.some((v) => v.level === l), l);
  for (let i = 1; i < VENUES.length; i++) assert.ok(order.indexOf(VENUES[i].level) >= order.indexOf(VENUES[i - 1].level));
  for (let i = 1; i < VENUES.length; i++) assert.ok(VENUES[i].crowd > VENUES[i - 1].crowd, 'crowds grow');
  for (const v of VENUES) assert.ok(v.name && v.who && v.unlocks.length, v.id);
});

test('a career starts at the venue for your level', () => {
  assert.equal(newCareer().venue, 'bedroom');
  assert.equal(newCareer('improver').venue, 'basement');
  assert.equal(newCareer('pro').venue, 'main');
  assert.equal(venueForLevel('nope').id, 'bedroom');
});

test('a gig: three mixes with two stars or more gets you booked; weak mixes don\'t undo good ones', () => {
  let c = newCareer();
  c = recordMix(c, 2); c = recordMix(c, 1); c = recordMix(c, 3);
  assert.equal(c.good, 2); assert.equal(c.offer, null);
  assert.equal(c.streak, 1); assert.equal(c.best, 1);
  c = recordMix(c, 2);
  assert.equal(c.good, GIG.mixes); assert.equal(c.offer, 'party');
  assert.equal(c.stars, 8); assert.equal(c.mixes, 4); assert.equal(c.best, 2);
  // more mixes while the offer waits keep it
  c = recordMix(c, 0);
  assert.equal(c.offer, 'party'); assert.equal(c.streak, 0);
  c = takeBooking(c);
  assert.equal(c.venue, 'party'); assert.equal(c.good, 0); assert.equal(c.offer, null);
  assert.equal(c.stars, 8, 'stars carry over');
});

test('the main room is the top: no more bookings', () => {
  let c = newCareer('pro');
  for (let i = 0; i < 5; i++) c = recordMix(c, 3);
  assert.equal(c.offer, null);
  assert.equal(gigProgress(c).last, true);
  assert.equal(nextVenue('main'), null);
});

test('picking a level by hand moves you to that level\'s venue, but not between venues on the same level', () => {
  const party = { ...newCareer(), venue: 'party', good: 2 };
  assert.equal(syncToLevel(party, 'starter'), party);
  const up = syncToLevel(party, 'confident');
  assert.equal(up.venue, 'warehouse'); assert.equal(up.good, 0);
});

test('saved careers are checked', () => {
  assert.equal(loadCareer(null).venue, 'bedroom');
  assert.equal(loadCareer({ venue: 'moon', good: -3 }, 'improver').venue, 'basement');
  assert.equal(loadCareer({ venue: 'moon', good: -3 }).good, 0);
  assert.equal(loadCareer({ venue: 'bedroom', offer: 'main' }).offer, null, 'an offer must be the next venue');
  assert.equal(loadCareer({ venue: 'bedroom', offer: 'party' }).offer, 'party');
});

test('gig progress for the bars', () => {
  const p = gigProgress(recordMix(newCareer(), 3));
  assert.deepEqual({ done: p.done, of: p.of, booked: p.booked, next: p.next.id }, { done: 1, of: 3, booked: false, next: 'party' });
});

test('after the bedroom, each venue has a brief: one skill that has to land before the next booking', () => {
  for (const v of VENUES.slice(1, -1)) assert.ok(BRIEFS[v.id]?.text, v.id);
  let c = { ...newCareer(), venue: 'basement' };
  const muddy = { bass: 40, beats: 90 }, clean = { bass: 85, beats: 90 };
  for (let i = 0; i < 4; i++) c = recordMix(c, 2, muddy);
  assert.equal(c.good, GIG.mixes); assert.equal(c.offer, null, 'no booking without the brief');
  assert.equal(gigProgress(c).briefDone, false);
  c = recordMix(c, 1, clean);
  assert.equal(c.offer, null, 'the brief has to land in a good mix');
  c = recordMix(c, 2, clean);
  assert.equal(c.offer, 'warehouse');
  c = takeBooking(c);
  assert.equal(c.brief, false, 'a new venue, a new brief');
});

test('a daily challenge: the same all day, a bonus once', () => {
  assert.equal(dailyChallenge(20000), dailyChallenge(20000));
  const seen = new Set(Array.from({ length: 60 }, (_, d) => dailyChallenge(20000 + d).id));
  assert.ok(seen.size >= CHALLENGES.length - 1, 'the challenges rotate');
  const day = Array.from({ length: 60 }, (_, d) => 20000 + d).find((d) => dailyChallenge(d).id === 'three');
  let c = recordMix(newCareer(), 2, {}, day);
  assert.equal(c.daily.done, false); assert.equal(c.stars, 2);
  c = recordMix(c, 3, {}, day);
  assert.equal(c.daily.done, true); assert.equal(c.stars, 5 + CHALLENGE_BONUS); assert.equal(c.challenge.id, 'three');
  c = recordMix(c, 3, {}, day);
  assert.equal(c.stars, 8 + CHALLENGE_BONUS, 'only once a day'); assert.equal(c.challenge, null);
  c = recordMix(c, 0, {}, day + 1);
  assert.equal(c.daily.done, false, 'a new day');
});

test('levels are earned in Learn mode: your venue caps your level', () => {
  assert.equal(levelCap(newCareer()), 'starter');
  assert.equal(levelCap({ ...newCareer(), venue: 'warehouse' }), 'confident');
  assert.equal(allowedLevel('pro', 'improver'), 'improver');
  assert.equal(allowedLevel('starter', 'confident'), 'starter', 'going down is always fine');
  assert.equal(levelLocked('pro', 'confident'), true); assert.equal(levelLocked('improver', 'confident'), false);
});

test('Pro mode is the decks with none of the game', () => {
  const pro = featuresFor('starter', 'pro');
  assert.deepEqual(Object.keys(pro), FEATURES);
  for (const f of ['playView', 'career', 'lesson', 'tour', 'mixReport', 'offsetHint', 'mixGuide']) assert.equal(pro[f], false, f);
  for (const f of ['fullEQ', 'hotCues', 'perfPads', 'beatFx', 'proTools', 'keyLock', 'beatLane']) assert.equal(pro[f], true, f);
  assert.equal(featuresFor('pro').playView, true, 'Pro level in Learn mode still has the game');
});
