// DJ Life: loading a save, checked and filled in (older saves, hand edits, a half-broken file). DOM-free.

import { newLife, weekOf } from './economy.js';
import { gearById } from './gear.js';
import { HOMES, homeById } from './homes.js';
import { carById } from './cars.js';

const num = (x, d = 0, min = 0, max = Infinity) => (Number.isFinite(x) ? Math.max(min, Math.min(max, x)) : d);

export function loadLife(saved) {
  const base = newLife();
  if (!saved || typeof saved !== 'object') return base;
  const l = { ...base, ...saved };
  l.v = 1;
  l.cash = Math.round(num(l.cash, base.cash));
  l.day = Math.floor(num(l.day, 0));
  l.rep = Math.round(num(l.rep, 0, 0, 100));
  l.fans = Math.round(num(l.fans, 0));
  if (!HOMES.some((h) => h.id === l.home)) l.home = 'parents';
  l.owned = [...new Set([...base.owned, ...(Array.isArray(l.owned) ? l.owned.filter((id) => gearById(id)) : [])])];
  const eq = { ...base.equipped };
  for (const [slot, id] of Object.entries(l.equipped && typeof l.equipped === 'object' ? l.equipped : {})) {
    const g = gearById(id); if (g && g.slot === slot && l.owned.includes(id)) eq[slot] = id;
  }
  l.equipped = eq;
  l.decor = (Array.isArray(l.decor) ? l.decor : []).filter((id) => gearById(id)?.slot === 'decor' && l.owned.includes(id)).slice(0, homeById(l.home).decor);
  if (!l.board || typeof l.board !== 'object' || !Array.isArray(l.board.offers)) l.board = null;
  if (l.gig && (!l.gig.offer || !Array.isArray(l.gig.scores))) l.gig = null;
  l.lastGigWeek = Math.floor(num(l.lastGigWeek, -1, -1));
  l.history = Array.isArray(l.history) ? l.history.slice(0, 30) : [];
  l.week = { earned: 0, spent: 0, gigs: 0, ...(l.week && typeof l.week === 'object' ? l.week : {}) };
  l.intro = !!l.intro;
  l.homesOwned = [...new Set((Array.isArray(l.homesOwned) ? l.homesOwned : []).filter((id) => id !== 'parents' && HOMES.some((h) => h.id === id)))];
  l.carsOwned = [...new Set((Array.isArray(l.carsOwned) ? l.carsOwned : []).filter((id) => carById(id)))];
  if (!l.carsOwned.includes(l.car)) l.car = null;
  l.layout = l.layout && typeof l.layout === 'object' && !Array.isArray(l.layout) ? l.layout : {};
  // a home you can only buy, but don't own (a hand-edited save): back to your parents'
  if (homeById(l.home).rent == null && !l.homesOwned.includes(l.home)) l.home = 'parents';
  if (l.board && l.board.week !== weekOf(l.day)) l.board = null;
  return l;
}
