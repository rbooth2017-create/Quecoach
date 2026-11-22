import test from 'node:test';
import assert from 'node:assert/strict';
import {
  newLife, effects, gearVibe, startGig, gigMix, gigVibe, gigDone, payout, finishGig, leaveGig, advanceTo, buy, equip, moveHome,
  starsOf, VENUE_GIGS, START_CASH, weekOf, tierIn,
} from '../js/packs/djlife/economy.js';
import { makeBoard, boardFor, blockers, rng } from '../js/packs/djlife/gigs.js';
import { loadLife } from '../js/packs/djlife/save.js';
import { GEAR, SLOTS, STARTER_KIT } from '../js/packs/djlife/gear.js';
import { HOMES } from '../js/packs/djlife/homes.js';
import { VENUES } from '../js/career.js';
import * as packs from '../js/packs.js';

const offer = (o = {}) => ({ id: 'x', venue: 'basement', title: 'Test', day: 4, fee: 60, mixes: 4, wants: 'warm', goal: null, needs: [], ...o });
const play = (o, scores, vibe = 0.7, energy = 5) => {
  let g = startGig(o);
  for (const s of scores) { g = gigVibe(g, vibe, 60); g = gigMix(g, s, energy); }
  return g;
};

// ---------- data ----------
test('every career venue has a gig table, and they grow from bedroom to main room', () => {
  assert.deepEqual(Object.keys(VENUE_GIGS), VENUES.map((v) => v.id));
  const vs = Object.values(VENUE_GIGS);
  for (let i = 1; i < vs.length; i++) {
    assert.ok(vs[i].fee > vs[i - 1].fee && vs[i].mixes >= vs[i - 1].mixes && vs[i].rep >= vs[i - 1].rep);
  }
});

test('gear: unique ids, a free starter piece in every slot but decor, prices go up with tier', () => {
  assert.equal(new Set(GEAR.map((g) => g.id)).size, GEAR.length);
  for (const s of SLOTS) {
    const items = GEAR.filter((g) => g.slot === s.id);
    assert.ok(items.length, s.id);
    if (s.id !== 'decor') {
      assert.ok(items.some((g) => g.price === 0), `${s.id} has a free one`);
      const byTier = [...items].sort((a, b) => a.tier - b.tier);
      for (let i = 1; i < byTier.length; i++) assert.ok(byTier[i].price > byTier[i - 1].price, s.id);
    }
  }
  for (const g of GEAR) assert.ok((g.lift || 0) <= 0.15 && (g.focus || 0) <= 0.15, `${g.id} bonus stays small`);
  for (let i = 1; i < HOMES.length; i++) assert.ok(HOMES[i].rent > HOMES[i - 1].rent);
});

// ---------- a new life ----------
test('a new life: parents\' bedroom, starter kit equipped, a little cash', () => {
  const l = newLife();
  assert.equal(l.home, 'parents'); assert.equal(l.cash, START_CASH); assert.equal(l.rep, 0);
  assert.deepEqual(l.owned, STARTER_KIT);
  assert.equal(tierIn(l, 'controller'), 0); assert.equal(tierIn(l, 'headphones'), 0);
  assert.deepEqual(effects(l), { lift: 0, focus: 0, rep: 0 });
});

// ---------- pay ----------
test('pay: half the fee for turning up, the rest for playing well; great crowds tip more', () => {
  const l = newLife();
  const bad = payout(play(offer(), [40, 40, 40, 40], 0.3), l);
  const good = payout(play(offer(), [95, 95, 95, 95], 0.9), l);
  assert.equal(bad.fee, Math.round(60 * (0.5 + 0.5 * 0.4)));
  assert.equal(good.fee, Math.round(60 * (0.5 + 0.5 * 0.95)));
  assert.ok(good.tips > bad.tips);
  assert.ok(good.total > bad.total && bad.total > 0);
  assert.ok(good.rep > 0 && bad.rep < 0, 'reputation follows the stars');
});

test('a bonus goal pays 25 % of the fee extra', () => {
  const l = newLife();
  const met = payout(play(offer({ goal: 'allClean' }), [80, 80, 80, 80]), l);
  const missed = payout(play(offer({ goal: 'allClean' }), [80, 80, 50, 80]), l);
  assert.ok(met.goalMet); assert.equal(met.bonus, 15);
  assert.ok(!missed.goalMet); assert.equal(missed.bonus, 0);
  const finish = payout(play(offer({ goal: 'finish3' }), [60, 60, 60, 92]), l);
  assert.ok(finish.goalMet);
});

test('songs that fit what the crowd wants earn bigger tips', () => {
  const l = newLife();
  const fits = payout(play(offer({ wants: 'peak' }), [80, 80, 80, 80], 0.7, 9), l);
  const wrong = payout(play(offer({ wants: 'peak' }), [80, 80, 80, 80], 0.7, 2), l);
  const unknown = payout(play(offer({ wants: 'peak' }), [80, 80, 80, 80], 0.7, null), l);
  assert.equal(fits.fit, 1); assert.equal(wrong.fit, 0); assert.equal(unknown.fit, 0.5);
  assert.ok(fits.tips > unknown.tips && unknown.tips > wrong.tips);
});

test('a hosted party: guests pay at the door, minus snacks', () => {
  const p = payout(play(offer({ hosted: true, venue: 'party', fee: 0, guests: 20, mixes: 3 }), [80, 80, 80], 1), newLife());
  assert.equal(p.fee, 0); assert.equal(p.tips, 60); assert.equal(p.costs, 15); assert.equal(p.total, 45);
});

test('a gig is done after its mixes; finishing banks it and moves past the gig night', () => {
  const l = { ...newLife(), day: 1 };
  const g = play(offer({ day: 4 }), [90, 90, 90, 90]);
  assert.ok(gigDone(g));
  const { life, pay } = finishGig({ ...l, gig: g }, g);
  assert.equal(life.cash, START_CASH + pay.total);
  assert.equal(life.day, 5); assert.equal(life.gig, null);
  assert.equal(life.history.length, 1); assert.equal(life.week.gigs, 1);
  assert.ok(life.rep > 0); assert.equal(life.lastGigWeek, 0);
});

test('leaving a gig: no pay, a small hit to your name', () => {
  const l = { ...newLife(), rep: 10, gig: startGig(offer({ day: 3 })) };
  const { life } = leaveGig(l);
  assert.equal(life.gig, null); assert.equal(life.rep, 7); assert.equal(life.cash, l.cash); assert.equal(life.day, 4);
});

// ---------- weeks and rent ----------
test('Sunday night: rent is paid, and a quiet week fades your name a little', () => {
  const l = { ...newLife(), home: 'flat', cash: 100, rep: 10, day: 6, lastGigWeek: -1 };
  const { life, weeks } = advanceTo(l, 7);
  assert.equal(weeks.length, 1);
  assert.equal(life.cash, 60); assert.equal(life.home, 'flat'); assert.equal(life.rep, 8);
  assert.equal(weekOf(life.day), 1);
});

test('can\'t pay the rent: back to your parents\', never into debt', () => {
  const l = { ...newLife(), home: 'studio', cash: 30, decor: ['dec-poster', 'dec-plant', 'dec-shelf'], owned: [...STARTER_KIT, 'dec-poster', 'dec-plant', 'dec-shelf'] };
  const { life, weeks } = advanceTo(l, 7);
  assert.ok(weeks[0].broke);
  assert.equal(life.home, 'parents'); assert.equal(life.cash, 30); assert.equal(life.decor.length, 2);
});

test('skipping several weeks charges each Sunday', () => {
  const { life, weeks } = advanceTo({ ...newLife(), home: 'flat', cash: 1000 }, 21);
  assert.equal(weeks.length, 3); assert.equal(life.cash, 1000 - 120);
});

// ---------- shop and homes ----------
test('buying gear: costs cash, equips it, and refuses when you can\'t afford it', () => {
  let l = { ...newLife(), cash: 50 };
  const no = buy(l, 'ctl-starter');
  assert.ok(!no.ok); assert.match(no.why, /£70 more/);
  const yes = buy(l, 'hp-basic');
  assert.ok(yes.ok); l = yes.life;
  assert.equal(l.cash, 10); assert.equal(l.equipped.headphones, 'hp-basic');
  assert.ok(!buy(l, 'hp-basic').ok, 'not twice');
  l = equip(l, 'hp-buds'); assert.equal(l.equipped.headphones, 'hp-buds');
});

test('decor only fits as many pieces as your home has room for', () => {
  let l = { ...newLife(), cash: 500 };
  l = buy(l, 'dec-poster').life; l = buy(l, 'dec-plant').life;
  const full = buy(l, 'dec-disco');
  assert.ok(!full.ok); assert.match(full.why, /No room/);
  l = moveHome(l, 'flat').life;
  assert.ok(buy(l, 'dec-disco').ok);
});

test('moving house costs the deposit', () => {
  const l = { ...newLife(), cash: 100 };
  assert.ok(!moveHome(l, 'studio').ok);
  const m = moveHome(l, 'flat');
  assert.ok(m.ok); assert.equal(m.life.cash, 20); assert.equal(m.life.home, 'flat');
});

test('gear helps the crowd a little: faster up, slower down; home gear only counts at home', () => {
  const l = { ...newLife(), equipped: { ...newLife().equipped, headphones: 'hp-pro', speakers: 'spk-studio' } };
  const gig = effects(l, 'gig'), home = effects(l, 'home');
  assert.equal(gig.focus, 0.15); assert.equal(gig.lift, 0); assert.equal(home.lift, 0.12);
  assert.ok(Math.abs(gearVibe(0.5, 0.6, { lift: 0.1, focus: 0 }) - 0.61) < 1e-9);
  assert.ok(Math.abs(gearVibe(0.5, 0.4, { lift: 0, focus: 0.15 }) - 0.415) < 1e-9);
  assert.equal(gearVibe(0.99, 1.2, { lift: 0.5, focus: 0 }), 1);
});

// ---------- the board ----------
test('the board: same week, same offers; venues only up to your career', () => {
  const l = newLife();
  const a = makeBoard(l, { careerVenue: 'party', seed: 3 }), b = makeBoard(l, { careerVenue: 'party', seed: 3 });
  assert.deepEqual(a, b);
  const real = a.offers.filter((o) => !o.next);
  assert.ok(real.length >= 3);
  assert.ok(real.every((o) => ['bedroom', 'party'].includes(o.venue)));
  const teaser = a.offers.find((o) => o.next);
  assert.equal(teaser.venue, 'basement'); assert.ok(teaser.needs.length);
  assert.ok(a.offers.every((o) => weekOf(o.day) === 0));
});

test('there is always a gig you can take, even with a big career and no reputation yet', () => {
  for (let seed = 1; seed < 40; seed++) {
    const b = makeBoard(newLife(), { careerVenue: 'warehouse', seed });
    assert.ok(b.offers.some((o) => !o.needs.length && !o.next), `seed ${seed}`);
  }
});

test('venues want reputation and gear before they book you', () => {
  const l = newLife();
  assert.deepEqual(blockers(l, 'bedroom'), []);
  assert.equal(blockers(l, 'basement').length, 2);
  const kitted = { ...l, rep: 30, owned: [...l.owned, 'ctl-starter'], equipped: { ...l.equipped, controller: 'ctl-starter' } };
  assert.deepEqual(blockers(kitted, 'basement'), []);
});

test('a home with room adds a party at yours; nights already gone drop off the board', () => {
  const l = { ...newLife(), home: 'flat', day: 2 };
  const b = boardFor(l, { careerVenue: 'bedroom', seed: 1 });
  assert.ok(b.offers.some((o) => o.hosted));
  assert.ok(b.offers.every((o) => o.day >= 2));
  const later = boardFor({ ...l, board: b, day: 6 }, { careerVenue: 'bedroom', seed: 1 });
  assert.ok(later.offers.every((o) => o.day >= 6));
});

test('rng is repeatable and between 0 and 1', () => {
  const a = rng(5), b = rng(5);
  for (let i = 0; i < 50; i++) { const x = a(); assert.equal(x, b()); assert.ok(x >= 0 && x < 1); }
});

// ---------- saves ----------
test('loading a save: fills gaps, drops junk, keeps what\'s valid', () => {
  assert.deepEqual(loadLife(null), newLife());
  const l = loadLife({ cash: 'lots', rep: 400, home: 'castle', owned: ['hp-basic', 'gold-mic'], equipped: { headphones: 'hp-basic', controller: 'hp-basic' }, decor: ['dec-plant'], gig: { nope: 1 } });
  assert.equal(l.cash, START_CASH); assert.equal(l.rep, 100); assert.equal(l.home, 'parents');
  assert.ok(l.owned.includes('hp-basic') && !l.owned.includes('gold-mic'));
  assert.equal(l.equipped.headphones, 'hp-basic'); assert.equal(l.equipped.controller, 'ctl-toy');
  assert.deepEqual(l.decor, []); assert.equal(l.gig, null);
});

test('stars match the Play view', () => {
  assert.deepEqual([95, 80, 60, 20].map(starsOf), [3, 2, 1, 0]);
});

// ---------- the pack system ----------
test('packs: off means nothing happens; on, they hear events and adjust values; a broken pack never breaks the app', () => {
  packs._clearPacks();
  let on = {};
  packs.setSwitchStore(() => on, (v) => { on = v; });
  const heard = [];
  let started = 0, stopped = 0;
  packs.registerPack({
    id: 'p', name: 'P', start: () => { started++; }, stop: () => { stopped++; },
    on: { mix: (d) => heard.push(d), boom: () => { throw new Error('x'); } },
    filters: { n: (v) => v * 2, skip: () => undefined },
  });
  packs.emit('mix', 1);
  assert.equal(packs.filter('n', 3), 3);
  assert.deepEqual(heard, []);
  packs.startPacks({});
  packs.setOn('p', true);
  assert.equal(started, 1);
  packs.emit('mix', 2);
  assert.deepEqual(heard, [2]);
  assert.equal(packs.filter('n', 3), 6);
  assert.equal(packs.filter('skip', 3), 3);
  const err = console.error; console.error = () => {};
  assert.doesNotThrow(() => packs.emit('boom'));
  console.error = err;
  assert.deepEqual(packs.listPacks(), [{ id: 'p', name: 'P', blurb: '', on: true }]);
  packs.setOn('p', false);
  assert.equal(stopped, 1);
  packs._clearPacks();
});
