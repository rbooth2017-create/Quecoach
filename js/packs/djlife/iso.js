// DJ Life world: the maths behind the isometric room. Turning tiles into screen points and back, finding a path
// round the furniture, and laying out each home with the gear you own. DOM-free and tested
// (test/djlife-world.test.mjs). The drawing is in sprites.js and world.js.
//
// The room is a grid: x runs down-right on screen, y runs down-left. Tile (0, 0) is the back corner.

import { gearById } from './gear.js';

/** Tile size on screen: twice as wide as it is tall, the classic isometric look. */
export const TILE_W = 64, TILE_H = 32;

/** Tile (x, y), z pixels up → screen point, with the back corner at (0, 0). */
export function toScreen(x, y, z = 0) {
  return { sx: (x - y) * (TILE_W / 2), sy: (x + y) * (TILE_H / 2) - z };
}
/** Screen point → tile (fractional; floor it for the tile you clicked). */
export function toTile(sx, sy) {
  const a = sx / (TILE_W / 2), b = sy / (TILE_H / 2);
  return { x: (a + b) / 2, y: (b - a) / 2 };
}

/** How big each home is, in tiles. */
export const ROOM_SIZE = {
  parents: { w: 7, h: 6 },
  flat: { w: 8, h: 7 },
  studio: { w: 9, h: 8 },
  loft: { w: 12, h: 9 },
  house: { w: 13, h: 10 },
};
export const roomSize = (home) => ROOM_SIZE[home] || ROOM_SIZE.parents;

/**
 * Every kind of thing that can stand in a room.
 *   w, h     footprint in tiles (before turning)
 *   tall     height in pixels, for drawing
 *   wall     hangs on the back wall: takes no floor space
 *   use      what happens when you use it ('decks', 'laptop', 'door', 'sofa', 'look')
 *   say      the prompt when you're next to it
 */
export const KINDS = {
  door: { w: 1, h: 1, tall: 70, wall: true, use: 'door', say: 'Head out' },
  bed: { w: 2, h: 3, tall: 22, say: '' },
  booth: { w: 2, h: 1, tall: 34, use: 'decks', say: 'Mix on the decks' },
  laptop: { w: 1, h: 1, tall: 30, use: 'laptop', say: 'Check your gigs' },
  wardrobe: { w: 1, h: 1, tall: 70, use: 'look', say: 'The shop: gear and clothes' },
  speaker: { w: 1, h: 1, tall: 44 },
  plant: { w: 1, h: 1, tall: 46 },
  shelf: { w: 2, h: 1, tall: 40 },
  sofa: { w: 2, h: 1, tall: 22, use: 'sofa', say: 'Sit down for a bit' },
  disco: { w: 1, h: 1, tall: 0, hang: true },
  poster: { w: 1, h: 1, tall: 40, wall: true },
  neon: { w: 2, h: 1, tall: 30, wall: true },
  led: { w: 1, h: 1, tall: 0, wall: true, strip: true },
  heads: { w: 1, h: 1, tall: 0, hang: true },
};

/** Which decor item becomes which thing in the room. */
const DECOR_KIND = { 'dec-poster': 'poster', 'dec-plant': 'plant', 'dec-shelf': 'shelf', 'dec-neon': 'neon', 'dec-disco': 'disco', 'dec-sofa': 'sofa' };

/**
 * Where everything goes in a home, from what you own. Each thing: { id, kind, x, y, w, h, wall ('left' | 'right')?,
 * tier?, use?, say? }. Floor things never overlap and always leave a free tile to stand on.
 * Things on the back walls: wall 'left' runs along y = 0 (x = position), 'right' along x = 0 (y = position).
 */
export function layout(life) {
  const { w, h } = roomSize(life.home);
  const tier = (slot) => gearById(life.equipped[slot])?.tier || 0;
  const items = [];
  const add = (id, kind, x, y, extra = {}) => {
    const k = KINDS[kind];
    items.push({ id, kind, x, y, w: k.w, h: k.h, use: k.use || null, say: k.say || '', ...extra });
  };
  // the door in the right-hand back wall, near the front
  add('door', 'door', 0, h - 2, { wall: 'right' });
  // the essentials
  add('bed', 'bed', w - 2, h - 3);
  add('booth', 'booth', Math.floor(w / 2) - 1, 0, { tier: tier('controller') });
  add('laptop', 'laptop', w - 1, 0);
  add('wardrobe', 'wardrobe', 0, 0);
  // speakers either side of the booth
  if (tier('speakers') >= 1) {
    add('spk-l', 'speaker', Math.floor(w / 2) - 2, 0, { tier: tier('speakers') });
    add('spk-r', 'speaker', Math.floor(w / 2) + 1, 0, { tier: tier('speakers') });
  }
  // lights
  if (tier('lights') >= 1) add('led', 'led', 0, 0, { wall: 'left', tier: tier('lights') });
  if (tier('lights') >= 2) add('heads', 'heads', Math.floor(w / 2), 2, { tier: tier('lights') });
  // decor, in the order you put it up
  const floorSpots = [[0, Math.floor(h / 2)], [w - 3, 0], [Math.floor(w / 2) - 1, h - 1], [0, 2]];
  const wallSpots = { poster: [w - 3, 'left'], neon: [1, 'right'] };
  for (const id of life.decor || []) {
    const kind = DECOR_KIND[id]; if (!kind) continue;
    const k = KINDS[kind];
    if (k.wall) { const [pos, wall] = wallSpots[kind]; add(id, kind, wall === 'left' ? pos : 0, wall === 'left' ? 0 : pos, { wall }); continue; }
    if (k.hang) { add(id, kind, Math.floor(w / 2), Math.floor(h / 2)); continue; }
    const spot = floorSpots.find(([x, y]) => fits({ x, y, w: k.w, h: k.h }, items, w, h));
    if (spot) add(id, kind, spot[0], spot[1]);
  }
  return items;
}

/** Does a floor thing fit at its spot: inside the room and not on top of another floor thing? */
export function fits(it, items, w, h) {
  if (it.x < 0 || it.y < 0 || it.x + it.w > w || it.y + it.h > h) return false;
  return !items.some((o) => blocksFloor(o) && o.x < it.x + it.w && it.x < o.x + o.w && o.y < it.y + it.h && it.y < o.y + o.h);
}

/** Things that stand on the floor (not on a wall, not hanging from the ceiling). */
export const blocksFloor = (it) => !it.wall && !KINDS[it.kind].hang;

/** The tiles you can't walk on: a Set of "x,y". */
export function blocked(items) {
  const out = new Set();
  for (const it of items) {
    if (!blocksFloor(it)) continue;
    for (let i = 0; i < it.w; i++) for (let j = 0; j < it.h; j++) out.add(`${it.x + i},${it.y + j}`);
  }
  return out;
}

/** Where you stand to use a thing: the free tile in front of it nearest to `from`. */
export function standSpot(it, room, block, from = { x: room.w - 1, y: room.h - 1 }) {
  const spots = [];
  if (it.wall === 'right') spots.push({ x: 0, y: it.y });
  else if (it.wall === 'left') spots.push({ x: it.x, y: 0 });
  else {
    for (let i = 0; i < it.w; i++) spots.push({ x: it.x + i, y: it.y - 1 }, { x: it.x + i, y: it.y + it.h });
    for (let j = 0; j < it.h; j++) spots.push({ x: it.x - 1, y: it.y + j }, { x: it.x + it.w, y: it.y + j });
  }
  const ok = spots.filter((p) => p.x >= 0 && p.y >= 0 && p.x < room.w && p.y < room.h && !block.has(`${p.x},${p.y}`));
  ok.sort((a, b) => Math.hypot(a.x - from.x, a.y - from.y) - Math.hypot(b.x - from.x, b.y - from.y));
  return ok[0] || null;
}

/** Is a tile next to a thing (so you can use it from there)? */
export function nextTo(p, it) {
  if (it.wall === 'right') return p.x === 0 && p.y === it.y;
  if (it.wall === 'left') return p.y === 0 && p.x === it.x;
  const dx = Math.max(it.x - p.x, 0, p.x - (it.x + it.w - 1)), dy = Math.max(it.y - p.y, 0, p.y - (it.y + it.h - 1));
  return dx + dy === 1;
}

/**
 * The shortest walk from one tile to another (A*, four directions), not counting the start.
 * Returns [] if you're already there, null if there's no way through.
 */
export function findPath(from, to, room, block) {
  const key = (p) => `${p.x},${p.y}`;
  const inside = (p) => p.x >= 0 && p.y >= 0 && p.x < room.w && p.y < room.h;
  if (!inside(to) || block.has(key(to))) return null;
  if (from.x === to.x && from.y === to.y) return [];
  const open = [{ ...from, g: 0, f: Math.abs(to.x - from.x) + Math.abs(to.y - from.y) }];
  const came = new Map(), best = new Map([[key(from), 0]]);
  while (open.length) {
    open.sort((a, b) => a.f - b.f);
    const cur = open.shift();
    if (cur.x === to.x && cur.y === to.y) {
      const path = []; let k = key(cur);
      while (came.has(k)) { const [x, y] = k.split(',').map(Number); path.unshift({ x, y }); k = came.get(k); }
      return path;
    }
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const n = { x: cur.x + dx, y: cur.y + dy };
      if (!inside(n) || block.has(key(n))) continue;
      const g = cur.g + 1;
      if (g >= (best.get(key(n)) ?? Infinity)) continue;
      best.set(key(n), g); came.set(key(n), key(cur));
      open.push({ ...n, g, f: g + Math.abs(to.x - n.x) + Math.abs(to.y - n.y) });
    }
  }
  return null;
}

/** Which way someone faces when stepping from a to b: 'se' (down-right), 'sw', 'ne' or 'nw' on screen. */
export function facing(a, b) {
  if (b.x > a.x) return 'se';
  if (b.x < a.x) return 'nw';
  if (b.y > a.y) return 'sw';
  return 'ne';
}

/** Draw order: things further back first. */
export const depth = (it) => it.x + it.y + (it.w + it.h) / 2 + (it.wall ? -100 : 0) + (KINDS[it.kind]?.hang ? 100 : 0);

/** Where you start: just inside the door. */
export function startSpot(items, room) {
  const door = items.find((i) => i.kind === 'door');
  return standSpot(door, room, blocked(items), { x: 1, y: door.y }) || { x: 1, y: 1 };
}
