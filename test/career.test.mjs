import test from 'node:test';
import assert from 'node:assert/strict';
import { VENUES, GIG, newCareer, loadCareer, recordMix, takeBooking, syncToLevel, gigProgress, venueForLevel, nextVenue } from '../js/career.js';
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
