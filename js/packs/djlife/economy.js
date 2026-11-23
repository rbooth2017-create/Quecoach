// DJ Life: the money and the calendar. Gig pay, tips, reputation, rent, buying gear, moving house. DOM-free and
// tested (test/djlife-economy.test.mjs). Every number to balance the game lives in the tables at the top.

import { gearById, GEAR, STARTER_KIT } from './gear.js';
import { homeById } from './homes.js';
import { carById } from './cars.js';

/** Stars for one mix score (the same as the Play view: 90 → 3, 75 → 2, 55 → 1). */
export const starsOf = (score) => (score >= 90 ? 3 : score >= 75 ? 2 : score >= 55 ? 1 : 0);

/**
 * What a gig is like at each venue (ids from js/career.js).
 *   mixes   how many mixes the gig lasts
 *   fee     the usual fee before reputation
 *   rep     reputation you need before they'll call
 *   ctl/hp  controller and headphone tiers they expect
 *   people  the audience size (for tips)
 *   tip     £ per happy person
 *   weight  how much your reputation moves after a gig here
 */
export const VENUE_GIGS = {
  bedroom: { label: 'Bedroom livestream', mixes: 2, fee: 10, rep: 0, ctl: 0, hp: 0, people: 10, tip: 0.3, weight: 3 },
  party: { label: 'House party', mixes: 3, fee: 25, rep: 5, ctl: 0, hp: 0, people: 20, tip: 0.4, weight: 4 },
  basement: { label: 'Bar night', mixes: 4, fee: 60, rep: 25, ctl: 1, hp: 0, people: 60, tip: 0.25, weight: 5 },
  warehouse: { label: 'Club night', mixes: 5, fee: 180, rep: 50, ctl: 2, hp: 1, people: 400, tip: 0.08, weight: 6 },
  main: { label: 'Main room headline', mixes: 6, fee: 600, rep: 80, ctl: 2, hp: 3, people: 2000, tip: 0.04, weight: 8 },
};
/** Getting to a gig and back with your kit, without a car (bus, or a taxi for the bigger nights). */
export const TRAVEL = { bedroom: 0, party: 4, basement: 8, warehouse: 15, main: 30 };
/** What getting to this venue costs you, after your car. */
export const travelCost = (life, venue) => Math.round((TRAVEL[venue] || 0) * (carById(life.car)?.travel ?? 1));

/** A party you throw at your own place. Guests pay at the door; you buy the snacks. */
export const HOSTED = { mixes: 3, door: 3, supplies: 15, weight: 3 };

/** Bonus goals a gig can come with. Meet one for +25 % of the fee. */
export const GOALS = {
  noWreck: { text: 'No trainwrecks: every mix 1 star or more', test: (g) => g.stars.every((s) => s >= 1) },
  floor70: { text: 'Keep the floor busy: vibe above 70 %', test: (g) => vibeAvg(g) >= 0.7 },
  finish3: { text: 'Finish big: last mix gets 3 stars', test: (g) => g.stars[g.stars.length - 1] === 3 },
  allClean: { text: 'Clean all night: every mix 2 stars or more', test: (g) => g.stars.every((s) => s >= 2) },
};
export const GOAL_BONUS = 0.25;

/** What the crowd wants, by the energy (1–10) of the songs you bring in. */
export const WANTS = {
  chill: { text: 'Laid-back, low energy', fits: (e) => e <= 4 },
  warm: { text: 'Warm and groovy, mid energy', fits: (e) => e >= 4 && e <= 7 },
  peak: { text: 'Peak time, high energy', fits: (e) => e >= 7 },
};

export const START_CASH = 20;
export const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export const weekOf = (day) => Math.floor(day / 7);
export const weekday = (day) => ((day % 7) + 7) % 7;
export const money = (n) => `£${Math.round(n).toLocaleString('en-GB')}`;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

/** A new life: your parents' bedroom, the free starter kit, £20 in your pocket. */
export function newLife() {
  const equipped = {};
  for (const id of STARTER_KIT) { const g = gearById(id); if (g.slot !== 'decor') equipped[g.slot] = id; }
  return {
    v: 1, cash: START_CASH, day: 0, rep: 0, fans: 0, home: 'parents',
    owned: [...STARTER_KIT], equipped, decor: [],
    homesOwned: [], car: null, carsOwned: [], layout: {},
    board: null, gig: null, lastGigWeek: -1, history: [], week: { earned: 0, spent: 0, gigs: 0 }, intro: false,
  };
}

/** Your gear's effect at a gig ('gig') or at your place ('home'). */
export function effects(life, where = 'gig') {
  const out = { lift: 0, focus: 0, rep: 0 };
  for (const id of Object.values(life.equipped)) {
    const g = gearById(id); if (!g) continue;
    if (g.where === 'home' && where !== 'home') continue;
    out.lift += g.lift || 0; out.focus += g.focus || 0; out.rep += g.rep || 0;
  }
  if (where !== 'home') out.rep += carById(life.car)?.rep || 0;
  return out;
}

/** The tier of what you have equipped in a slot (-1 if nothing). */
export const tierIn = (life, slot) => gearById(life.equipped[slot])?.tier ?? -1;

/** The crowd's vibe one frame on, after your gear: good moves lift a bit faster, slips hurt a bit less. */
export function gearVibe(prev, next, fx) {
  const d = next - prev;
  return clamp(prev + (d > 0 ? d * (1 + fx.lift) : d * (1 - fx.focus)), 0, 1);
}

/** A fresh gig in progress, from an offer you accepted. */
export const startGig = (offer) => ({ offer, scores: [], stars: [], vibeSum: 0, vibeTime: 0, fits: 0, judged: 0 });

/** One mix of the gig done. energy: the incoming song's energy (1–10) or null if unknown. */
export function gigMix(gig, score, energy = null) {
  const want = WANTS[gig.offer.wants];
  const judged = want && energy != null;
  return {
    ...gig, scores: [...gig.scores, score], stars: [...gig.stars, starsOf(score)],
    judged: gig.judged + (judged ? 1 : 0), fits: gig.fits + (judged && want.fits(energy) ? 1 : 0),
  };
}
/** The crowd's vibe, measured while the music plays. */
export const gigVibe = (gig, vibe, dt) => ({ ...gig, vibeSum: gig.vibeSum + vibe * dt, vibeTime: gig.vibeTime + dt });
export const vibeAvg = (gig) => (gig.vibeTime > 0 ? gig.vibeSum / gig.vibeTime : 0.5);
export const gigDone = (gig) => gig.scores.length >= gig.offer.mixes;

/** How well the songs fitted what the crowd wanted, 0..1 (0.5 when we couldn't tell). */
export const crowdFit = (gig) => (gig.judged ? gig.fits / gig.judged : 0.5);

/**
 * The money and reputation from a finished gig.
 * Returns { perf, avgStars, vibe, fit, fee, tips, bonus, costs, total, goalMet, rep, fans }.
 */
export function payout(gig, life) {
  const o = gig.offer, n = Math.max(1, gig.scores.length);
  const perf = gig.scores.reduce((a, b) => a + b, 0) / n / 100;
  const avgStars = gig.stars.reduce((a, b) => a + b, 0) / n;
  const vibe = vibeAvg(gig), fit = crowdFit(gig);
  const goalMet = !!(o.goal && GOALS[o.goal]?.test(gig));
  let fee, tips, costs = 0, weight;
  if (o.hosted) {
    fee = 0;
    tips = Math.round(o.guests * HOSTED.door * (0.5 + 0.5 * vibe));
    costs = HOSTED.supplies;
    weight = HOSTED.weight;
  } else {
    const v = VENUE_GIGS[o.venue];
    fee = Math.round(o.fee * (0.5 + 0.5 * perf));
    tips = Math.round(v.people * vibe * v.tip * (0.75 + 0.5 * fit));
    weight = v.weight;
    costs = travelCost(life, o.venue);
  }
  const bonus = goalMet ? Math.round((o.fee || tips) * GOAL_BONUS) : 0;
  let rep = Math.round((avgStars - 1.5) * weight);
  if (rep > 0) rep += effects(life).rep;
  const people = o.hosted ? o.guests : VENUE_GIGS[o.venue].people;
  const fans = Math.max(0, Math.round((avgStars / 3) * vibe * people * 0.1));
  return { perf, avgStars, vibe, fit, fee, tips, bonus, costs, total: fee + tips + bonus - costs, goalMet, rep, fans };
}

/** Bank a finished gig: cash, reputation and fans, and the day moves on past the gig night. */
export function finishGig(life, gig) {
  const p = payout(gig, life);
  const entry = { day: gig.offer.day, venue: gig.offer.venue, hosted: !!gig.offer.hosted, title: gig.offer.title, total: p.total, stars: p.avgStars, rep: p.rep };
  const next = {
    ...life, cash: Math.max(0, life.cash + p.total), rep: clamp(life.rep + p.rep, 0, 100), fans: life.fans + p.fans,
    gig: null, lastGigWeek: weekOf(gig.offer.day), history: [entry, ...life.history].slice(0, 30),
    week: { ...life.week, earned: life.week.earned + Math.max(0, p.total), gigs: life.week.gigs + 1 },
    board: life.board && { ...life.board, offers: life.board.offers.filter((x) => x.id !== gig.offer.id) },
  };
  const moved = advanceTo(next, Math.max(life.day, gig.offer.day + 1));
  return { life: moved.life, weeks: moved.weeks, pay: p };
}

/** Walk away from a gig half-way: no pay, a small hit to your name, and the night is gone. Returns { life, weeks }. */
export function leaveGig(life) {
  if (!life.gig) return { life, weeks: [] };
  const o = life.gig.offer;
  const next = { ...life, gig: null, rep: clamp(life.rep - 3, 0, 100), board: life.board && { ...life.board, offers: life.board.offers.filter((x) => x.id !== o.id) } };
  return advanceTo(next, Math.max(life.day, o.day + 1));
}

/**
 * Move the calendar on to `day`. Every Sunday night: rent, fans from mixtapes, and your name fades a little if you
 * didn't play that week. Can't pay the rent? You move back to your parents' (nobody is ever in debt).
 * Returns { life, weeks: [{ week, rent, paid, broke, fans, earned, spent, gigs, repFade }] }.
 */
export function advanceTo(life, day) {
  let l = { ...life };
  const weeks = [];
  while (weekOf(day) > weekOf(l.day)) {
    const w = weekOf(l.day), h = homeById(l.home);
    const rent = (l.homesOwned || []).includes(h.id) ? 0 : h.rent || 0;
    const paid = l.cash >= rent;
    const fans = Math.round(h.fans * (0.5 + l.rep / 100));
    const repFade = l.lastGigWeek < w && l.rep > 0 ? Math.min(2, l.rep) : 0;
    weeks.push({ week: w, rent, paid, broke: !paid, fans, ...l.week, spent: l.week.spent + (paid ? rent : 0), repFade });
    l = {
      ...l, cash: paid ? l.cash - rent : l.cash, home: paid ? l.home : 'parents', fans: l.fans + fans, rep: l.rep - repFade,
      decor: paid ? l.decor : l.decor.slice(0, homeById('parents').decor),
      day: (w + 1) * 7, week: { earned: 0, spent: 0, gigs: 0 },
    };
  }
  l.day = Math.max(l.day, day);
  return { life: l, weeks };
}

/** Buy a piece of gear (it's equipped straight away). Returns { life, ok, why }. */
export function buy(life, id) {
  const g = gearById(id);
  if (!g) return { life, ok: false, why: 'That isn\'t in the shop.' };
  if (life.owned.includes(id)) return { life, ok: false, why: 'You already have it.' };
  if (life.cash < g.price) return { life, ok: false, why: `You need ${money(g.price - life.cash)} more.` };
  if (g.slot === 'decor' && life.decor.length >= homeById(life.home).decor) return { life, ok: false, why: 'No room left for decor here. A bigger place has more.' };
  const next = { ...life, cash: life.cash - g.price, owned: [...life.owned, id], week: { ...life.week, spent: life.week.spent + g.price } };
  if (g.slot === 'decor') next.decor = [...life.decor, id];
  else next.equipped = { ...life.equipped, [g.slot]: id };
  return { life: next, ok: true, why: '' };
}

/** Use something you already own. Decor toggles in and out of your room. */
export function equip(life, id) {
  const g = gearById(id);
  if (!g || !life.owned.includes(id)) return life;
  if (g.slot !== 'decor') return { ...life, equipped: { ...life.equipped, [g.slot]: id } };
  if (life.decor.includes(id)) return { ...life, decor: life.decor.filter((x) => x !== id) };
  if (life.decor.length >= homeById(life.home).decor) return life;
  return { ...life, decor: [...life.decor, id] };
}

/** Do you own this home? (Your parents' is always free.) */
export const ownsHome = (life, id) => id === 'parents' || (life.homesOwned || []).includes(id);

/** Move house to rent it: pay the deposit (and rent every Sunday). A home you own: move in for free. Returns { life, ok, why }. */
export function moveHome(life, id) {
  const h = homeById(id);
  if (h.id === life.home) return { life, ok: false, why: 'You already live here.' };
  if (life.gig) return { life, ok: false, why: 'Finish tonight\'s gig first.' };
  if (ownsHome(life, h.id)) return { life: { ...life, home: h.id, decor: life.decor.slice(0, h.decor) }, ok: true, why: '' };
  if (h.rent == null) return { life, ok: false, why: `${h.name} is only for sale.` };
  if (life.cash < h.deposit) return { life, ok: false, why: `The deposit is ${money(h.deposit)}. You need ${money(h.deposit - life.cash)} more.` };
  const next = { ...life, home: h.id, cash: life.cash - h.deposit, decor: life.decor.slice(0, h.decor), week: { ...life.week, spent: life.week.spent + h.deposit } };
  return { life: next, ok: true, why: '' };
}

/** Buy a home outright and move in: no more rent there, ever. Returns { life, ok, why }. */
export function buyHome(life, id) {
  const h = homeById(id);
  if (ownsHome(life, h.id)) return { life, ok: false, why: 'It\'s already yours.' };
  if (life.gig) return { life, ok: false, why: 'Finish tonight\'s gig first.' };
  if (life.cash < h.price) return { life, ok: false, why: `It costs ${money(h.price)}. You need ${money(h.price - life.cash)} more.` };
  const next = { ...life, cash: life.cash - h.price, homesOwned: [...(life.homesOwned || []), h.id], home: h.id,
    decor: life.decor.slice(0, h.decor), week: { ...life.week, spent: life.week.spent + h.price } };
  return { life: next, ok: true, why: '' };
}

/** Buy a car (you drive it straight away), or switch to one you already own. Returns { life, ok, why }. */
export function buyCar(life, id) {
  const c = carById(id);
  if (!c) return { life, ok: false, why: 'That isn\'t in the showroom.' };
  if ((life.carsOwned || []).includes(id)) return { life: { ...life, car: id }, ok: true, why: '' };
  if (life.cash < c.price) return { life, ok: false, why: `You need ${money(c.price - life.cash)} more.` };
  const next = { ...life, cash: life.cash - c.price, carsOwned: [...(life.carsOwned || []), id], car: id, week: { ...life.week, spent: life.week.spent + c.price } };
  return { life: next, ok: true, why: '' };
}

/** Everything in the shop you could afford right now (for the "you can buy" dot). */
export const affordable = (life) => GEAR.filter((g) => !life.owned.includes(g.id) && g.price <= life.cash);
