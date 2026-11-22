// DJ Life: the town. A few streets at night with your home, every venue on your career road, the shops, the estate
// agent and the car showroom. Walk up to a door and go in. DOM-free and tested (test/djlife-world.test.mjs).
//
// Same grid as your room: x runs down-right on screen, y down-left. Every building's door is on its front-left face
// (the y + h side), and you stand on the pavement just outside it.

import { homeById } from './homes.js';
import { carById } from './cars.js';

export const TOWN = { w: 34, h: 27 };

/** Roads: two streets across, two down. Everything that isn't road, building or tree is pavement or grass. */
const ROAD_ROWS = [10, 11, 24, 25], ROAD_COLS = [11, 12, 22, 23];
export const isRoad = (x, y) => ROAD_ROWS.includes(y) || ROAD_COLS.includes(x);
/** 'road', 'path' (pavement next to a road) or 'grass'. */
export function groundAt(x, y) {
  if (isRoad(x, y)) return 'road';
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (isRoad(x + dx, y + dy)) return 'path';
  return 'grass';
}

/**
 * The buildings. use: what going in does ('home', 'venue', 'shop', 'estate', 'cars'). slots: which shop shelves.
 * look: how it's drawn. door: the x of the door along the front face.
 */
export const BUILDINGS = [
  // the north side of the first street (fronts on y = 10)
  { id: 'home', name: 'Home', x: 1, y: 3, w: 5, h: 6, tall: 70, use: 'home', look: 'home', door: 3 },
  { id: 'estate', name: 'Keys & Co', sub: 'Estate agent', x: 7, y: 5, w: 3, h: 4, tall: 64, use: 'estate', look: 'shop', color: '#2563eb', door: 8 },
  { id: 'gear', name: 'Deck Dept', sub: 'DJ gear', x: 13, y: 4, w: 4, h: 5, tall: 72, use: 'shop', slots: ['controller', 'headphones', 'speakers', 'lights'], look: 'shop', color: '#22d3ee', door: 15 },
  { id: 'clothes', name: 'Thread', sub: 'Clothes', x: 18, y: 5, w: 3, h: 4, tall: 60, use: 'shop', slots: ['outfit'], look: 'shop', color: '#a78bfa', door: 19 },
  { id: 'basement', name: 'The Basement', sub: 'Bar', x: 24, y: 3, w: 5, h: 6, tall: 66, use: 'venue', venue: 'basement', look: 'bar', color: '#f59e0b', door: 26 },
  { id: 'decor', name: 'Home & Glow', sub: 'Decor', x: 30, y: 5, w: 3, h: 4, tall: 58, use: 'shop', slots: ['decor'], look: 'shop', color: '#4ade80', door: 31 },
  // the north side of the second street (fronts on y = 24)
  { id: 'party', name: 'Sam\'s house', sub: 'House parties', x: 1, y: 17, w: 5, h: 6, tall: 66, use: 'venue', venue: 'party', look: 'house', color: '#fb7185', door: 3 },
  { id: 'cars', name: 'Wheels', sub: 'Car showroom', x: 6, y: 18, w: 4, h: 5, tall: 56, use: 'cars', look: 'showroom', color: '#facc15', door: 8 },
  { id: 'warehouse', name: 'Warehouse', sub: 'Club', x: 13, y: 14, w: 8, h: 9, tall: 88, use: 'venue', venue: 'warehouse', look: 'club', color: '#f472b6', door: 17 },
  { id: 'main', name: 'The Dome', sub: 'Main room', x: 24, y: 13, w: 9, h: 10, tall: 110, use: 'venue', venue: 'main', look: 'arena', color: '#22d3ee', door: 28 },
];

/** Trees and street lamps. Trees block the way; lamps are only for looks. */
const TREES = [[0, 0], [3, 0], [8, 1], [15, 0], [19, 1], [26, 0], [31, 1], [0, 14], [8, 14], [9, 16], [27, 26], [3, 26], [15, 26], [33, 13], [33, 20], [6, 15]];
const LAMPS = [[2, 9], [9, 9], [16, 9], [21, 9], [28, 9], [33, 9], [2, 23], [10, 23], [19, 23], [30, 23], [10, 13], [21, 13], [13, 1], [24, 18]];

/**
 * Everything in town, from your life: buildings (with stand: the tile outside the door), trees, lamps, and your car
 * on the drive if you have one. Each: { id, kind, x, y, w, h, use?, say?, stand? }.
 */
export function townLayout(life) {
  const items = [];
  const homeName = homeById(life.home).name;
  for (const b of BUILDINGS) {
    const name = b.id === 'home' ? homeName : b.name;
    const say = b.use === 'home' ? `Go home (${homeName})` : `Go into ${b.name}`;
    items.push({ ...b, kind: 'building', name, say, stand: { x: b.door, y: b.y + b.h }, ...(b.id === 'home' ? { homeId: life.home } : {}) });
  }
  for (const [x, y] of TREES) items.push({ id: `tree-${x}-${y}`, kind: 'tree', x, y, w: 1, h: 1 });
  for (const [x, y] of LAMPS) items.push({ id: `lamp-${x}-${y}`, kind: 'lamp', x, y, w: 1, h: 1, deco: true });
  const car = carById(life.car);
  if (car) items.push({ id: 'car', kind: 'car', x: 4, y: 9, w: 2, h: 1, car: car.id, body: car.body }); // parked out front
  return items;
}

/** Tiles you can't walk on: buildings, trees and your car. */
export function townBlocked(items) {
  const out = new Set();
  for (const it of items) {
    if (it.deco) continue;
    for (let i = 0; i < it.w; i++) for (let j = 0; j < it.h; j++) out.add(`${it.x + i},${it.y + j}`);
  }
  return out;
}

/** Where you appear when you come out of a building (or home). */
export function outside(items, id = 'home') {
  const b = items.find((i) => i.kind === 'building' && i.id === id) || items.find((i) => i.id === 'home');
  return { ...b.stand };
}
