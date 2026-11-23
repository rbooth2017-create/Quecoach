// DJ Life: inside a venue. The booth at the back on a little stage, speaker stacks, a bar, a door out, and a crowd
// that fills the floor. Walk up to the booth to play your set (or ask about gigs). DOM-free and tested.

import { KINDS } from './iso.js';
import { venueById } from '../../career.js';
import { rng } from './gigs.js';

export const VENUE_ROOM = {
  party: { w: 8, h: 7, look: 'party' },
  basement: { w: 9, h: 8, look: 'bar' },
  warehouse: { w: 12, h: 10, look: 'club' },
  main: { w: 15, h: 12, look: 'arena' },
};
export const venueRoom = (id) => VENUE_ROOM[id] || VENUE_ROOM.basement;

/** The inside of a venue: { room, items, crowd: [{ x, y, seed }] }. people: how many are in tonight. */
export function venueLayout(id, people = venueById(id).crowd) {
  const room = venueRoom(id), { w, h } = room;
  const items = [];
  const add = (iid, kind, x, y, extra = {}) => { const k = KINDS[kind]; items.push({ id: iid, kind, x, y, w: k.w, h: k.h, use: k.use || null, say: k.say || '', ...extra }); };
  const mid = Math.floor(w / 2) - 1;
  add('stage', 'stage', mid - 1, 0);
  add('booth', 'booth', mid, 0, { use: 'set', say: 'Step up to the decks', tier: id === 'main' ? 3 : id === 'warehouse' ? 2 : 1 });
  add('spk-l', 'speaker', mid - 2, 0, { tier: 2 });
  add('spk-r', 'speaker', mid + 3, 0, { tier: 2 });
  if (id !== 'party') add('bar', 'bar', w - 3, h - 1);
  else add('sofa', 'sofa', w - 2, h - 2, { use: null });
  add('door', 'door', 0, h - 2, { wall: 'right', use: 'exit', say: 'Back out to the street' });
  if (id !== 'party') add('heads', 'heads', mid + 1, 2, { tier: id === 'main' ? 3 : 2 });
  else add('disco', 'disco', mid + 1, Math.floor(h / 2));
  // the crowd: on the floor in front of the stage, leaving the way from the door to the booth clear
  const r = rng(id.length * 97 + people);
  const taken = new Set();
  for (const it of items) if (!it.wall && !KINDS[it.kind].hang) for (let i = -0; i < it.w; i++) for (let j = 0; j < it.h; j++) taken.add(`${it.x + i},${it.y + j}`);
  const path = (x, y) => (y === h - 2 && x <= mid + 1) || (x === mid && y >= 1) || (x === mid + 1 && y === 1); // door → booth aisle
  const spots = [];
  for (let x = 0; x < w; x++) for (let y = 2; y < h; y++) if (!taken.has(`${x},${y}`) && !path(x, y)) spots.push({ x, y });
  spots.sort(() => r() - 0.5);
  // closer to the stage fills first
  spots.sort((a, b) => a.y - b.y + (r() - 0.5) * 3);
  const crowd = spots.slice(0, Math.min(people, spots.length * 2)).map((s, i) => ({ x: s.x + 0.2 + r() * 0.6, y: s.y + 0.2 + r() * 0.6, seed: i * 13 + 7 }));
  // more people than spots: squeeze a second person onto some tiles
  if (people > spots.length) for (let i = 0; i < Math.min(people - spots.length, spots.length); i++) crowd.push({ x: spots[i].x + 0.15 + r() * 0.7, y: spots[i].y + 0.15 + r() * 0.7, seed: 1000 + i });
  return { room, items, crowd: crowd.slice(0, people) };
}
