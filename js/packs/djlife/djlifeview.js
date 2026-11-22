// DJ Life: the screens. The wallet and calendar chips in the Play view, the gig board, the shop, your home, the
// diary, payday and the end of each week. All the sums are in economy.js and gigs.js; this file only draws them.
import { icon } from '../../icons.js';
import { venueById } from '../../career.js';
import {
  VENUE_GIGS, GOALS, WANTS, HOSTED, DAY_NAMES, money, weekOf, weekday, effects, gearVibe, startGig, gigMix, gigVibe,
  gigDone, finishGig, leaveGig, advanceTo, buy, equip, moveHome, affordable, buyHome, buyCar, ownsHome, travelCost,
} from './economy.js';
import { makeBoard, boardFor } from './gigs.js';
import { SLOTS, gearById, gearInSlot } from './gear.js';
import { HOMES, homeById } from './homes.js';
import { loadLife } from './save.js';
import { createWorld } from './world.js';
import { CARS, carById } from './cars.js';
import { play as sfx } from './sfx.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const mixes = (n) => `${n} ${n === 1 ? 'mix' : 'mixes'}`;
const pct = (x) => `${Math.round(x * 100)}%`;
const signed = (n) => (n > 0 ? `+${n}` : String(n));
const dayLabel = (day) => `Week ${weekOf(day) + 1} · ${DAY_NAMES[weekday(day)]}`;
const STAR = '<svg class="dl-star" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4l-5.9 3.1 1.2-6.5L2.5 9.4l6.6-.9z"/></svg>';
const HOUSE = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 11l9-7 9 7M5 9.5V20h14V9.5M10 20v-5h4v5"/></svg>';
const TABS = [['gigs', 'Gigs'], ['shop', 'Shop'], ['home', 'Homes'], ['cars', 'Cars'], ['diary', 'Diary']];

export function createDjLife(ctx, { key }) {
  // ---------- the save ----------
  const read = () => { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } };
  let life = loadLife(read());
  if (!Number.isFinite(life.seed)) life.seed = 1 + Math.floor(Math.random() * 1e6);
  let frames = 0;
  const save = () => { try { localStorage.setItem(key, JSON.stringify(life)); } catch { /* private mode */ } };
  save();

  const st = { tab: 'gigs', queue: [], lastLine: '', chipKey: '', sceneKey: '' };

  // ---------- the overlay, the stylesheet, the chips ----------
  const css = document.createElement('link');
  css.rel = 'stylesheet'; css.href = new URL('./djlife.css', import.meta.url).href;
  document.head.append(css);
  const layer = document.createElement('div');
  layer.className = 'career-layer dl-layer hidden';
  document.body.append(layer);
  const chips = ctx.slots.chips, scene = ctx.slots.scene;

  // ---------- your room: walk round it (world.js) ----------
  const world = createWorld({
    getLife: () => life,
    djName: () => ctx.djName(),
    sound: sfx,
    marks: townMarks,
    saveMove: (home, id, move) => { life = { ...life, layout: { ...life.layout, [home]: { ...(life.layout[home] || {}), [id]: move } } }; save(); },
    use: (what, it) => {
      if (what === 'decks') { world.close(true); ctx.showPlay(); return; }
      if (what === 'laptop') return openBoard('gigs');
      if (what === 'look') return openBoard('shop', { slots: ['outfit', 'headphones'], name: 'Your wardrobe', sub: 'What you wear to gigs' });
      if (what === 'sofa') return ctx.toast('You put your feet up for a minute. Ahh.');
      if (what === 'shop') return openBoard('shop', { slots: it.slots, name: it.name, sub: it.sub });
      if (what === 'estate') return openBoard('home', { name: it.name, sub: 'Rent somewhere, or buy it and never pay rent again' });
      if (what === 'cars') return openBoard('cars', { name: it.name, sub: 'A car cuts what you pay to get to gigs' });
      if (what === 'set') {
        const g = life.gig;
        if (g && !g.offer.hosted && g.offer.venue === it.venue) { world.close(true); ctx.showPlay(); ctx.toast(`${g.offer.title}: you're on. Play ${mixes(g.offer.mixes)}.`); return; }
        return openBoard('gigs', { venue: it.venue, name: venueById(it.venue).name, sub: 'Gigs here this week' });
      }
    },
  });
  /** Markers over buildings in town: where tonight's gig is, and which venues have gigs for you this week. */
  function townMarks() {
    const out = {};
    for (const o of board().offers) if (!o.next && !o.hosted && !o.needs.length && o.venue !== 'bedroom') out[o.venue] = 'offer';
    if (life.gig) out[life.gig.offer.hosted || life.gig.offer.venue === 'bedroom' ? 'home' : life.gig.offer.venue] = 'gig';
    return out;
  }

  // ---------- the board for this week ----------
  function board() {
    const top = ctx.career().venue, w = weekOf(life.day);
    if (!life.board || life.board.week !== w || life.board.top !== top) {
      // a new week, or your career moved on: the phone rings again (gigs you already played stay played)
      const played = new Set(life.board?.week === w ? life.board.played || [] : []);
      const b = makeBoard(life, { careerVenue: top, seed: life.seed });
      life.board = { ...b, top, played: [...played], offers: b.offers.filter((o) => !played.has(o.id)) };
      save();
    }
    return boardFor(life, { careerVenue: top, seed: life.seed });
  }
  const markPlayed = (id) => { if (life.board) life.board = { ...life.board, played: [...(life.board.played || []), id] }; };

  // ---------- chips in the Play view's top bar ----------
  function renderChips() {
    const tonight = board().offers.some((o) => o.day === life.day && !o.needs.length && !o.next);
    const k = `${life.cash}|${life.day}|${!!life.gig}|${tonight}`;
    if (k === st.chipKey) return;
    st.chipKey = k;
    chips.innerHTML = `<button class="pv-chip" data-dl="room" title="Walk round your room">${HOUSE}Your room</button>
      <button class="pv-chip dl-gigs${tonight && !life.gig ? ' ping' : ''}" data-dl="board" title="DJ Life: your gigs, the shop and your home">${icon('disc', 15)}${life.gig ? 'Tonight\'s gig' : 'Gigs'}</button>
      <span class="pv-chip dl-cash" title="Your money">${esc(money(life.cash))}</span>
      <span class="pv-chip dl-day" title="The day in DJ Life">${esc(dayLabel(life.day))}</span>`;
  }
  chips.addEventListener('click', onChipClick);
  function onChipClick(e) {
    if (e.target.closest('[data-dl="board"]')) openBoard();
    if (e.target.closest('[data-dl="room"]')) openRoom();
  }
  function openRoom() { if (!life.intro) return drawIntro(); world.open(); }

  // ---------- your room, drawn behind the decks when you're at home ----------
  function renderScene() {
    const home = !life.gig;
    const lights = gearById(life.equipped.lights)?.tier || 0, spk = gearById(life.equipped.speakers)?.tier || 0;
    const k = `${home}|${life.home}|${lights}|${spk}|${life.decor.join()}`;
    if (k === st.sceneKey) return;
    st.sceneKey = k;
    if (!home) { scene.innerHTML = ''; return; }
    const has = (id) => life.decor.includes(id);
    const name = ctx.djName() || 'DJ';
    scene.innerHTML = `<div class="dl-room" data-home="${life.home}" data-lights="${lights}" data-speakers="${spk}">
      ${lights >= 1 ? '<i class="dl-led"></i>' : ''}
      ${lights >= 2 ? '<i class="dl-heads"><b></b><b></b></i>' : ''}
      ${lights >= 3 ? '<i class="dl-laser"><b></b><b></b><b></b></i>' : ''}
      ${spk >= 1 ? '<i class="dl-spk l"></i><i class="dl-spk r"></i>' : ''}
      ${has('dec-poster') ? '<i class="dl-poster"></i>' : ''}
      ${has('dec-plant') ? '<i class="dl-plant"></i>' : ''}
      ${has('dec-shelf') ? '<i class="dl-shelf"></i>' : ''}
      ${has('dec-neon') ? `<i class="dl-neon">${esc(name)}</i>` : ''}
      ${has('dec-disco') ? '<i class="dl-disco"></i>' : ''}
      ${has('dec-sofa') ? '<i class="dl-sofa"></i>' : ''}
    </div>`;
  }

  function renderAll() {
    renderChips(); renderScene();
    if (world.isOpen()) world.refresh();
    if (!layer.classList.contains('hidden') && layer.dataset.view === 'board') drawBoard();
  }

  // ---------- the overlay ----------
  function show(html, view) {
    layer.innerHTML = html; layer.dataset.view = view;
    layer.classList.remove('hidden');
    layer.querySelector('[data-focus]')?.focus();
  }
  function close() {
    layer.classList.add('hidden'); layer.innerHTML = ''; layer.dataset.view = '';
    if (st.queue.length) showCard(st.queue.shift());
  }
  function showCard(c) { if (c.type === 'week') drawWeek(c.week); else if (c.type === 'pay') drawPay(c); }

  /** place: a building you walked into ({ name, sub, slots (shop shelves), venue }), or nothing for the whole board. */
  function openBoard(tab, place = null) {
    if (tab) st.tab = tab;
    st.place = place;
    if (!life.intro) return drawIntro();
    drawBoard();
  }

  function head() {
    const h = homeById(life.home);
    return `<div class="dl-head">
      <div><span class="cl-kick">${esc(st.place?.sub || `DJ Life · ${dayLabel(life.day)}`)}</span><h2 id="dlTitle">${esc(st.place?.name || (ctx.djName() ? `DJ ${ctx.djName()}` : 'Your DJ life'))}</h2></div>
      <div class="dl-stats">
        <span><small>Money</small><b>${esc(money(life.cash))}</b></span>
        <span><small>Reputation</small><b>${life.rep}<i class="dl-meter"><s style="width:${life.rep}%"></s></i></b></span>
        <span><small>Fans</small><b>${life.fans.toLocaleString('en-GB')}</b></span>
        <span><small>Home</small><b>${esc(h.name)}</b></span>
      </div>
      <button class="pv-x cl-close" data-dl="close" aria-label="Close">${icon('x', 18)}</button>
    </div>
    ${world.isOpen() ? '' : `<div class="dl-acts"><button class="cl-ghost dl-roombtn" data-dl="room">${HOUSE}Go to your room</button><button class="cl-ghost dl-roombtn" data-dl="town">${icon('external', 15)}Go into town</button></div>`}
    ${st.place ? '' : `<nav class="dl-tabs" role="tablist">${TABS.map(([id, name]) => `<button role="tab" aria-selected="${st.tab === id}" data-dl="tab:${id}">${name}${id === 'shop' && affordable(life).length ? '<i class="dl-dot" aria-label="Something you can afford"></i>' : ''}</button>`).join('')}</nav>`}`;
  }

  function drawBoard() {
    const body = { gigs: gigsTab, shop: shopTab, home: homeTab, cars: carsTab, diary: diaryTab }[st.tab]();
    const scroll = layer.querySelector('.dl-body')?.scrollTop || 0;
    show(`<div class="cl-card dl-card" role="dialog" aria-modal="true" aria-labelledby="dlTitle">${head()}<div class="dl-body">${body}</div></div>`, 'board');
    const b = layer.querySelector('.dl-body'); if (b) b.scrollTop = scroll;
  }

  // ---------- gigs ----------
  function offerCard(o) {
    const v = venueById(o.venue), blocked = o.needs.length > 0;
    const when = o.day === life.day ? 'Tonight' : DAY_NAMES[weekday(o.day)];
    const pay = o.hosted ? `${o.guests} guests × ${money(HOSTED.door)}` : money(o.fee);
    return `<li class="dl-offer${blocked ? ' locked' : ''}${o.hosted ? ' hosted' : ''}${o.next ? ' next' : ''}">
      <div class="dl-ohead"><span class="dl-when">${esc(when)}</span><span class="dl-pay">${esc(pay)}</span></div>
      <b>${esc(o.title)}</b>
      <span class="dl-where">${esc(o.hosted ? 'At your place' : VENUE_GIGS[o.venue].label === v.name ? v.name : `${VENUE_GIGS[o.venue].label} · ${v.name}`)}</span>
      <ul class="dl-facts">
        <li>${icon('disc', 14)}${mixes(o.mixes)}</li>
        <li>${icon('music', 14)}${esc(WANTS[o.wants].text)}</li>
        ${o.goal ? `<li class="goal">${icon('sparkle', 14)}Bonus: ${esc(GOALS[o.goal].text)}</li>` : ''}
      </ul>
      ${blocked ? `<div class="dl-needs">${icon('lock', 14)}<span>${o.needs.map(esc).join('<br>')}</span></div>`
        : `<button class="cl-go dl-accept" data-dl="accept:${esc(o.id)}" ${life.gig ? 'disabled' : ''}>${o.day === life.day ? 'Play it tonight' : `Take it (${DAY_NAMES[weekday(o.day)]})`}</button>`}
    </li>`;
  }
  function gigsTab() {
    const b = board(), c = ctx.career();
    const here = st.place?.venue;
    let real = b.offers.filter((o) => !o.next), next = b.offers.find((o) => o.next);
    if (here) { real = real.filter((o) => !o.hosted && o.venue === here); next = next?.venue === here ? next : null; }
    let top = '';
    if (life.gig) {
      const g = life.gig, o = g.offer;
      top = `<div class="dl-now"><div><span class="cl-kick ok">Tonight's gig · ${esc(o.title)}</span>
          <b>${g.scores.length} of ${mixes(o.mixes)} done</b>
          <div class="pv-gigbars">${Array.from({ length: o.mixes }, (_, i) => `<i class="${i < g.scores.length ? 'on' : ''}"></i>`).join('')}</div>
          <span class="dl-sub">${esc(WANTS[o.wants].text)}${o.goal ? ` · Bonus: ${esc(GOALS[o.goal].text)}` : ''}</span></div>
        <div class="dl-acts"><button class="cl-go" data-dl="close" data-focus>Back to the decks</button><button class="cl-ghost" data-dl="leave">Leave the gig</button></div></div>`;
    } else if (c.offer) {
      top = `<div class="dl-now booked"><div><span class="cl-kick ok">Your phone's ringing</span><b>${esc(venueById(c.offer).name)} wants to book you</b><span class="dl-sub">Take it and their gigs start showing up here.</span></div>
        <div class="dl-acts"><button class="cl-go" data-dl="booked" data-focus>See the booking</button></div></div>`;
    }
    if (here) {
      const v = VENUE_GIGS[here];
      return `${top}
        <p class="dl-sub">${esc(venueById(here).who)} Gigs here are ${mixes(v.mixes)} long and usually pay about ${esc(money(v.fee))}. Getting here: ${esc(money(travelCost(life, here)))}${life.car ? ` in your ${esc(carById(life.car).name.toLowerCase())}` : ' on the bus'}.</p>
        ${real.length || next ? `<ul class="dl-offers">${real.map(offerCard).join('')}${next ? offerCard(next) : ''}</ul>` : '<p class="dl-empty">Nothing for you here this week. Try again on Monday, or look at every gig.</p>'}
        <div class="dl-acts"><button class="cl-ghost" data-dl="allgigs">See every gig this week</button></div>`;
    }
    return `${top}
      <h3 class="dl-h">This week's offers</h3>
      ${real.length ? `<ul class="dl-offers">${real.map(offerCard).join('')}${next ? offerCard(next) : ''}</ul>` : `<p class="dl-empty">No more gigs this week. Practise, or skip to Monday for new offers.</p>${next ? `<ul class="dl-offers">${offerCard(next)}</ul>` : ''}`}
      <div class="dl-foot">
        <span>Mixes you play without a gig are practice: they still count for your career and level.</span>
        <div class="dl-acts">
          <button class="cl-ghost" data-dl="day" ${life.gig ? 'disabled' : ''}>Practise today · next day</button>
          <button class="cl-ghost" data-dl="week" ${life.gig ? 'disabled' : ''}>Skip to next week${homeById(life.home).rent ? ` (rent ${money(homeById(life.home).rent)})` : ''}</button>
        </div>
      </div>`;
  }

  // ---------- shop ----------
  function fxText(g) {
    const out = [];
    const at = g.where === 'home' ? ' at your place' : '';
    if (g.lift) out.push(`Crowd warms up ${pct(g.lift)} faster${at}`);
    if (g.focus) out.push(`Slips upset the crowd ${pct(g.focus)} less`);
    if (g.rep) out.push(`+${g.rep} reputation after good gigs`);
    if (g.slot === 'controller' || g.slot === 'headphones') {
      const k = g.slot === 'controller' ? 'ctl' : 'hp';
      const v = Object.entries(VENUE_GIGS).filter(([, x]) => x[k] === g.tier && g.tier > 0).map(([id]) => venueById(id).name);
      if (v.length) out.push(`Needed for ${v.join(' and ')}`);
    }
    return out.join(' · ');
  }
  function shopTab() {
    const slots = st.place?.slots ? SLOTS.filter((s) => st.place.slots.includes(s.id)) : SLOTS;
    return slots.map((s) => `<section class="dl-slot"><h3 class="dl-h">${esc(s.name)} <small>${esc(s.blurb)}</small></h3>
      <ul class="dl-items">${gearInSlot(s.id).map((g) => {
        const own = life.owned.includes(g.id);
        const on = s.id === 'decor' ? life.decor.includes(g.id) : life.equipped[s.id] === g.id;
        const btn = own
          ? (s.id === 'decor' ? `<button class="cl-ghost" data-dl="equip:${g.id}">${on ? 'Put away' : 'Put up'}</button>` : on ? '<span class="dl-tag ok">Using</span>' : `<button class="cl-ghost" data-dl="equip:${g.id}">Use</button>`)
          : `<button class="cl-go" data-dl="buy:${g.id}" ${life.cash < g.price ? 'disabled' : ''}>Buy ${esc(money(g.price))}</button>`;
        return `<li class="dl-item${on ? ' on' : ''}"><div><b>${esc(g.name)}</b><span>${esc(g.blurb)}</span>${fxText(g) ? `<small>${esc(fxText(g))}</small>` : ''}</div>${btn}</li>`;
      }).join('')}</ul></section>`).join('');
  }

  // ---------- home ----------
  function homeTab() {
    const h = homeById(life.home);
    const perks = (x) => [ownsHome(life, x.id) ? (x.id === 'parents' ? 'Free' : 'Yours: no rent') : x.rent == null ? 'For sale only' : `${money(x.rent)} a week`, x.host ? `Parties for up to ${x.guests}` : 'No parties', x.fans ? `About ${x.fans} new fans a week from mixtapes` : '', `${x.decor} decor spots`].filter(Boolean);
    return `<div class="dl-now"><div><span class="cl-kick ok">You live in</span><b>${esc(h.name)}</b><span class="dl-sub">${esc(h.blurb)}</span>
        <span class="dl-sub">${perks(h).map(esc).join(' · ')} · Decor up: ${life.decor.length} of ${h.decor}</span></div></div>
      <h3 class="dl-h">Places to live</h3>
      <ul class="dl-homes">${HOMES.map((x) => {
        const here = x.id === life.home, own = ownsHome(life, x.id);
        const btns = [];
        if (here) btns.push('<span class="dl-tag ok">Home</span>');
        else if (own) btns.push(`<button class="cl-ghost" data-dl="move:${x.id}" ${life.gig ? 'disabled' : ''}>${x.id === 'parents' ? 'Move back' : 'Move in (it\'s yours)'}</button>`);
        else if (x.rent != null) btns.push(`<button class="cl-ghost" data-dl="move:${x.id}" ${life.cash < x.deposit || life.gig ? 'disabled' : ''}>Rent · ${esc(money(x.deposit))} deposit</button>`);
        if (!own) btns.push(`<button class="cl-go" data-dl="buyhome:${x.id}" ${life.cash < x.price || life.gig ? 'disabled' : ''}>Buy · ${esc(money(x.price))}</button>`);
        else if (here && x.id !== 'parents') btns.push('<span class="dl-tag ok">Owned</span>');
        return `<li class="dl-home${here ? ' on' : ''}" data-home="${x.id}"><div><b>${esc(x.name)}</b><span>${esc(x.blurb)}</span><small>${perks(x).map(esc).join(' · ')}</small></div><div class="dl-btns">${btns.join('')}</div></li>`;
      }).join('')}</ul>
      <p class="dl-empty">Rent is paid every Sunday night. If you can't pay, you move back to your parents' and keep all your gear. A home you buy is yours for good: no rent, and you can move back in any time for free.</p>`;
  }

  // ---------- cars ----------
  function carsTab() {
    const cur = carById(life.car);
    const fx = (c) => [c.travel === 0 ? 'Free travel to gigs' : `Travel to gigs ${pct(1 - c.travel)} cheaper`, c.rep ? `+${c.rep} reputation after good gigs` : ''].filter(Boolean).join(' · ');
    return `<div class="dl-now"><div><span class="cl-kick ok">You get about</span><b>${esc(cur ? cur.name : 'On the bus')}</b>
        <span class="dl-sub">Getting to a club night costs you ${esc(money(travelCost(life, 'warehouse')))}, the main room ${esc(money(travelCost(life, 'main')))}.</span></div></div>
      <ul class="dl-homes">${CARS.map((c) => {
        const own = (life.carsOwned || []).includes(c.id), on = life.car === c.id;
        const btn = on ? '<span class="dl-tag ok">Driving</span>' : own ? `<button class="cl-ghost" data-dl="car:${c.id}">Drive it</button>`
          : `<button class="cl-go" data-dl="car:${c.id}" ${life.cash < c.price ? 'disabled' : ''}>Buy · ${esc(money(c.price))}</button>`;
        return `<li class="dl-home${on ? ' on' : ''}"><i class="dl-swatch" style="--c:${c.body}"></i><div><b>${esc(c.name)}</b><span>${esc(c.blurb)}</span><small>${esc(fx(c))}</small></div>${btn}</li>`;
      }).join('')}</ul>
      <p class="dl-empty">Your car waits on the drive outside your home in town.</p>`;
  }

  // ---------- diary ----------
  function diaryTab() {
    if (!life.history.length) return '<p class="dl-empty">No gigs yet. Your first one goes here.</p>';
    return `<ul class="dl-diary">${life.history.map((x) => `<li><span class="dl-when">${esc(dayLabel(x.day))}</span><b>${esc(x.title)}</b>
      <span>${STAR}${x.stars.toFixed(1)}</span><span class="${x.total >= 0 ? 'ok' : 'warn'}">${esc(money(x.total))}</span><span>Rep ${esc(signed(x.rep))}</span></li>`).join('')}</ul>`;
  }

  // ---------- first time ----------
  function drawIntro() {
    show(`<div class="cl-card dl-card dl-small" role="dialog" aria-modal="true" aria-labelledby="dlTitle">
      <span class="cl-kick ok">Expansion pack</span><h2 id="dlTitle">Welcome to DJ Life</h2>
      <p class="cl-lead">You're starting out in your parents' spare bedroom with a toy controller and ${esc(money(life.cash))}. Time to make a name for yourself.</p>
      <ol class="dl-how">
        <li><b>Pick a gig</b> from the board every week. Better reputation, better offers.</li>
        <li><b>Play it for real.</b> Each gig is a few mixes on the decks. Clean mixes and a happy crowd pay more.</li>
        <li><b>Spend it.</b> Better gear opens bigger venues; a bigger place lets you throw your own parties.</li>
        <li><b>Pay the rent</b> every Sunday. Can't? Back to your parents'. No game over.</li>
      </ol>
      <p class="dl-empty">Money never buys skill: the beats are only as matched as you make them.</p>
      <p class="dl-empty">Walk round your room: click where to go, or use the arrow keys. Walk up to the laptop for gigs, the decks to mix, the wardrobe for the shop.</p>
      <div class="dl-acts"><button class="cl-go" data-dl="intro" data-focus>Go to your room</button><button class="cl-ghost" data-dl="intro-board">Straight to the gig board</button></div>
    </div>`, 'intro');
  }

  // ---------- payday ----------
  function drawPay({ gig, pay, weeks }) {
    const o = gig.offer;
    const fitWords = pay.fit >= 0.75 ? 'You played what they came for.' : pay.fit <= 0.25 ? 'Not quite the songs they wanted.' : 'Some of your songs hit the spot.';
    const rows = [
      !o.hosted && [`Fee (${pct(0.5 + 0.5 * pay.perf)} of ${money(o.fee)} for how you played)`, pay.fee],
      [o.hosted ? `Door: ${o.guests} guests` : 'Tips from the crowd', pay.tips],
      pay.goalMet && [`Bonus: ${GOALS[o.goal].text}`, pay.bonus],
      pay.costs && [o.hosted ? 'Snacks and drinks' : life.car ? `Fuel (${carById(life.car).name})` : 'Bus and taxi there and back', -pay.costs],
    ].filter(Boolean);
    show(`<div class="cl-card dl-card dl-small dl-payday" role="dialog" aria-modal="true" aria-labelledby="dlTitle">
      <span class="cl-kick ok">Payday · ${esc(o.title)}</span>
      <h2 id="dlTitle">${esc(money(pay.total))}</h2>
      <p class="dl-stars">${[1, 2, 3].map((i) => `<span class="${pay.avgStars >= i - 0.25 ? 'on' : ''}">${STAR}</span>`).join('')}<span>${pay.avgStars.toFixed(1)} stars a mix · crowd ${pct(pay.vibe)} happy</span></p>
      <table class="dl-sum">${rows.map(([t, n]) => `<tr><td>${esc(t)}</td><td class="${n < 0 ? 'warn' : ''}">${esc(n < 0 ? `−${money(-n)}` : money(n))}</td></tr>`).join('')}</table>
      ${o.goal && !pay.goalMet ? `<p class="dl-miss">Missed the bonus: ${esc(GOALS[o.goal].text)}</p>` : ''}
      <ul class="dl-gains">
        <li class="${pay.rep >= 0 ? 'ok' : 'warn'}">Reputation ${esc(signed(pay.rep))} → ${life.rep}</li>
        ${pay.fans ? `<li class="ok">${pay.fans} new ${pay.fans === 1 ? 'fan' : 'fans'}</li>` : ''}
        <li>${esc(fitWords)}</li>
      </ul>
      <div class="dl-acts"><button class="cl-go" data-dl="board" data-focus>To the gig board</button><button class="cl-ghost" data-dl="close">Keep practising</button></div>
    </div>`, 'pay');
    for (const w of weeks || []) st.queue.push({ type: 'week', week: w });
    sfx('cash');
  }

  // ---------- end of the week ----------
  function drawWeek(w) {
    sfx('week');
    show(`<div class="cl-card dl-card dl-small" role="dialog" aria-modal="true" aria-labelledby="dlTitle">
      <span class="cl-kick">Sunday night</span><h2 id="dlTitle">Week ${w.week + 1} done</h2>
      <table class="dl-sum">
        <tr><td>Gigs played</td><td>${w.gigs}</td></tr>
        <tr><td>Earned</td><td>${esc(money(w.earned))}</td></tr>
        <tr><td>Spent (gear, moving, rent)</td><td>${esc(money(w.spent))}</td></tr>
        ${w.rent ? `<tr><td>Rent</td><td class="${w.paid ? '' : 'warn'}">${w.paid ? esc(money(w.rent)) : 'Couldn\'t pay'}</td></tr>` : ''}
        ${w.fans ? `<tr><td>New fans from your mixtapes</td><td>+${w.fans}</td></tr>` : ''}
        ${w.repFade ? `<tr><td>No gigs this week: your name faded a little</td><td class="warn">Rep −${w.repFade}</td></tr>` : ''}
      </table>
      ${w.broke ? '<p class="dl-miss">You couldn\'t make the rent, so you\'ve moved back to your parents\'. Your gear came with you. Play a few gigs and try again.</p>' : ''}
      <div class="dl-acts"><button class="cl-go" data-dl="board" data-focus>See next week's gigs</button></div>
    </div>`, 'week');
  }

  // ---------- doing things ----------
  function moveOn(day) {
    const r = advanceTo(life, day);
    life = r.life; save();
    for (const w of r.weeks) st.queue.push({ type: 'week', week: w });
    renderAll();
    if (st.queue.length) { layer.classList.add('hidden'); showCard(st.queue.shift()); } else drawBoard();
  }
  layer.addEventListener('click', (e) => {
    if (e.target === layer) return close();
    const b = e.target.closest('[data-dl]'); if (!b || b.disabled) return;
    const [a, arg] = b.dataset.dl.split(':');
    if (a === 'close') return close();
    if (a === 'tab') { st.tab = arg; st.place = null; return drawBoard(); }
    if (a === 'allgigs') { st.tab = 'gigs'; st.place = null; return drawBoard(); }
    if (a === 'town') { close(); return world.open('town'); }
    if (a === 'board') { st.tab = 'gigs'; st.place = null; if (st.queue.length) return showCard(st.queue.shift()); return drawBoard(); }
    if (a === 'intro') { life.intro = true; save(); close(); return world.open(); }
    if (a === 'intro-board') { life.intro = true; save(); return drawBoard(); }
    if (a === 'room') { close(); return world.open(); }
    if (a === 'booked') { close(); return ctx.openBooked(); }
    if (a === 'day') return moveOn(life.day + 1);
    if (a === 'week') return moveOn((weekOf(life.day) + 1) * 7);
    if (a === 'accept') {
      const o = board().offers.find((x) => x.id === arg);
      if (!o || o.needs.length || o.next || life.gig) return;
      const r = advanceTo(life, o.day);
      life = { ...r.life, gig: startGig(o) }; markPlayed(o.id); save();
      close(); ctx.resetVibe(); renderAll();
      const atHome = o.hosted || o.venue === 'bedroom';
      if (world.isOpen()) {
        // you're walking round: go there yourself. Your decks at home, or the venue with the pink marker.
        world.go(atHome ? 'room' : 'town', 'home');
        ctx.toast(atHome ? `${o.title}: walk to your decks when you're ready. Play ${mixes(o.mixes)}.` : `${o.title}: head to ${venueById(o.venue).name} (the pink marker) and step up to the decks. Or press Decks to start now.`);
        return;
      }
      world.close(true); ctx.showPlay();
      ctx.toast(`${o.title}: play ${mixes(o.mixes)}. ${o.hosted ? 'Your guests are arriving.' : 'The room is filling up.'} Good luck!`);
      return;
    }
    if (a === 'leave') {
      if (!confirm('Leave the gig? You won\'t get paid and your reputation takes a small hit.')) return;
      const r = leaveGig(life); life = r.life; save();
      for (const w of r.weeks) st.queue.push({ type: 'week', week: w });
      renderAll(); ctx.toast('You packed up and left. There\'s always next week.');
      return st.queue.length ? showCard(st.queue.shift()) : drawBoard();
    }
    if (a === 'buy') {
      const r = buy(life, arg);
      if (!r.ok) return ctx.toast(r.why);
      life = r.life; save(); renderAll(); sfx('buy'); ctx.toast(`${gearById(arg).name}: yours.`);
      return drawBoard();
    }
    if (a === 'equip') { life = equip(life, arg); save(); renderAll(); return drawBoard(); }
    if (a === 'move') {
      const r = moveHome(life, arg);
      if (!r.ok) return ctx.toast(r.why);
      life = r.life; save(); renderAll(); sfx('door'); ctx.toast(`Welcome to your new place: ${homeById(arg).name}.`);
      return drawBoard();
    }
    if (a === 'buyhome') {
      const h = homeById(arg);
      if (!confirm(`Buy ${h.name} for ${money(h.price)}? You'll move in straight away and never pay rent there.`)) return;
      const r = buyHome(life, arg);
      if (!r.ok) return ctx.toast(r.why);
      life = r.life; save(); renderAll(); sfx('cash'); ctx.toast(`The keys are yours: ${h.name}.`);
      return drawBoard();
    }
    if (a === 'car') {
      const c = carById(arg), had = (life.carsOwned || []).includes(arg);
      const r = buyCar(life, arg);
      if (!r.ok) return ctx.toast(r.why);
      life = r.life; save(); renderAll(); sfx(had ? 'pick' : 'cash'); ctx.toast(had ? `You're driving the ${c.name.toLowerCase()}.` : `${c.name}: yours. It's on your drive.`);
      return drawBoard();
    }
  });
  layer.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } });

  // ---------- what the core tells us ----------
  function mixFinished({ report, energy }) {
    if (!life.gig) { st.lastLine = ''; return; }
    life.gig = gigMix(life.gig, report.score, energy ?? null);
    if (!gigDone(life.gig)) {
      const left = life.gig.offer.mixes - life.gig.scores.length;
      st.lastLine = `Gig: ${life.gig.scores.length} of ${mixes(life.gig.offer.mixes)} done. ${left} to go.`;
      save(); renderAll();
      return;
    }
    const gig = life.gig;
    const r = finishGig(life, gig);
    life = r.life; save(); renderAll();
    st.lastLine = 'That was the last mix of the gig. Payday!';
    setTimeout(() => drawPay({ gig, pay: r.pay, weeks: r.weeks }), 1600);
  }
  function frame({ vibe, dt, live }) {
    if (!life.gig || !live) return;
    life.gig = gigVibe(life.gig, vibe, dt);
    if (++frames % 300 === 0) save(); // every few seconds, so a crash mid-gig loses little
  }

  renderAll();
  if (!life.intro) setTimeout(() => { if (layer.classList.contains('hidden')) drawIntro(); }, 600);

  return {
    mixFinished, frame, openBoard,
    venue: () => (life.gig ? life.gig.offer.venue : 'bedroom'),
    venueName: () => (life.gig ? life.gig.offer.title : homeById(life.home).name),
    vibe: (next, c) => gearVibe(c.prev, next, effects(life, !life.gig || life.gig.offer.hosted ? 'home' : 'gig')),
    hud: () => {
      if (!life.gig) return null;
      const g = life.gig, o = g.offer, left = o.mixes - g.scores.length;
      return { label: `Tonight · ${o.title}`, done: g.scores.length, of: o.mixes, text: `${left} more ${left === 1 ? 'mix' : 'mixes'} to go.${o.goal ? ` Bonus: ${GOALS[o.goal].text}.` : ''}` };
    },
    resultLine: (line) => { const l = st.lastLine; st.lastLine = ''; return l || line; },
    destroy() {
      save();
      layer.remove(); css.remove(); world.destroy();
      chips.removeEventListener('click', onChipClick);
      chips.innerHTML = ''; scene.innerHTML = '';
    },
  };
}
