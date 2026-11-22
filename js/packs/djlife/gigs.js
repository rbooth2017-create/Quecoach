// DJ Life: the gig board. Every Monday a few venues call with offers, depending on how far your career has got
// (js/career.js), your reputation and your gear. Seeded, so the same week always makes the same board. DOM-free.

import { VENUE_GIGS, GOALS, WANTS, weekOf, weekday, tierIn } from './economy.js';
import { homeById } from './homes.js';
import { gearInSlot } from './gear.js';

const VENUE_IDS = Object.keys(VENUE_GIGS); // bedroom → main, the same order as the career

/** A small seeded random number generator (mulberry32). */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = (r, list) => list[Math.floor(r() * list.length)];

const NAMES = {
  bedroom: ['Friday night stream', 'Sunday chill stream', 'Late-night stream', 'Request-hour stream'],
  party: ['Sam\'s birthday', 'End-of-term party', 'Garden party', 'Flat-warming', 'Halloween party'],
  basement: ['The Basement: Friday social', 'The Basement: Thursday sessions', 'Warm-up at The Basement', 'The Basement: after-work drinks'],
  warehouse: ['Warehouse: Saturday main event', 'Warehouse: guest slot', 'Warehouse: closing set', 'Warehouse: opening set'],
  main: ['Main room headline', 'Festival main stage', 'Main room: New Year\'s Eve', 'Main room: closing party'],
};
// gigs are mostly at the weekend
const DAYS = [3, 4, 4, 5, 5, 5, 6];

/** What a venue expects before it books you. Returns a list of reasons it won't yet (empty = it will). */
export function blockers(life, venue) {
  const v = VENUE_GIGS[venue], out = [];
  if (life.rep < v.rep) out.push(`Reputation ${v.rep}+ (you have ${life.rep})`);
  if (tierIn(life, 'controller') < v.ctl) out.push(`A ${gearInSlot('controller').find((g) => g.tier === v.ctl).name} or better`);
  if (tierIn(life, 'headphones') < v.hp) out.push(`${gearInSlot('headphones').find((g) => g.tier === v.hp).name} or better`);
  return out;
}

/**
 * This week's offers. ctx: { careerVenue (the venue id your career has reached), seed }.
 * Each offer: { id, venue, title, day (absolute), fee, mixes, wants, goal, needs: [reasons] } plus
 *   hosted (a party at yours: guests instead of a fee) or next (a teaser for the venue after yours: get booked first).
 */
export function makeBoard(life, { careerVenue = 'bedroom', seed = 1 } = {}) {
  const week = weekOf(life.day), today = weekday(life.day);
  const r = rng(seed * 1000 + week * 7919 + 17);
  const top = Math.max(0, VENUE_IDS.indexOf(careerVenue));
  const offers = [];
  const dayFor = () => week * 7 + Math.max(today, pick(r, DAYS));
  const offerAt = (venue, n) => {
    const v = VENUE_GIGS[venue];
    return {
      id: `w${week}-${n}`, venue, title: pick(r, NAMES[venue]), day: dayFor(), mixes: v.mixes,
      fee: Math.round(v.fee * (0.85 + r() * 0.3) * (1 + life.rep / 200)),
      wants: pick(r, Object.keys(WANTS)), goal: r() < 0.6 ? pick(r, Object.keys(GOALS)) : null,
      needs: blockers(life, venue),
    };
  };
  const count = 3 + Math.floor(r() * 2);
  for (let n = 0; n < count; n++) {
    // mostly your top venue and the one below; now and then something smaller
    const x = r();
    const i = Math.max(0, x < 0.5 ? top : x < 0.8 ? top - 1 : Math.floor(r() * (top + 1)));
    offers.push(offerAt(VENUE_IDS[i], n));
  }
  // there's always something you can play: the biggest venue that will have you right now (your bedroom at worst)
  if (!offers.some((o) => !o.needs.length)) {
    let i = top;
    while (i > 0 && blockers(life, VENUE_IDS[i]).length) i--;
    offers.push(offerAt(VENUE_IDS[i], count), offerAt(VENUE_IDS[i], count + 1));
  }
  // a party at yours, if your place has room
  const h = homeById(life.home);
  if (h.host) {
    const guests = Math.min(h.guests, Math.round(6 + life.rep * 0.6 + life.fans * 0.05));
    offers.push({
      id: `w${week}-host`, venue: 'party', hosted: true, title: `Party at your ${h.name.toLowerCase()}`, day: week * 7 + Math.max(today, 5),
      fee: 0, guests, mixes: 3, wants: pick(r, Object.keys(WANTS)), goal: r() < 0.5 ? 'floor70' : null, needs: [],
    });
  }
  // the next venue on your career road: you have to get booked there first (great mixes at your venue)
  const nextVenue = VENUE_IDS[top + 1];
  if (nextVenue) {
    const v = VENUE_GIGS[nextVenue];
    offers.push({
      id: `w${week}-next`, venue: nextVenue, title: pick(r, NAMES[nextVenue]), day: week * 7 + 5, fee: v.fee, mixes: v.mixes,
      wants: 'peak', goal: null, next: true, needs: ['Get booked there first: play great mixes at your venue', ...blockers(life, nextVenue)],
    });
  }
  offers.sort((a, b) => a.day - b.day || (a.next ? 1 : 0) - (b.next ? 1 : 0));
  return { week, offers };
}

/** The board for today: the saved one if it's still this week (minus nights already gone), else a new one. */
export function boardFor(life, ctx) {
  const week = weekOf(life.day);
  const b = life.board && life.board.week === week ? life.board : makeBoard(life, ctx);
  return { ...b, offers: b.offers.filter((o) => o.day >= life.day).map((o) => (o.next ? o : { ...o, needs: o.hosted ? [] : blockers(life, o.venue) })) };
}
