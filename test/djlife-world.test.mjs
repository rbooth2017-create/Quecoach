import test from 'node:test';
import assert from 'node:assert/strict';
import { toScreen, toTile, layout, blocked, findPath, standSpot, nextTo, roomSize, startSpot, facing, fits, KINDS, ROOM_SIZE } from '../js/packs/djlife/iso.js';
import { newLife } from '../js/packs/djlife/economy.js';
import { HOMES } from '../js/packs/djlife/homes.js';
import { GEAR } from '../js/packs/djlife/gear.js';

const close = (a, b) => Math.abs(a - b) < 1e-9;

test('tiles to screen and back', () => {
  for (const [x, y] of [[0, 0], [3, 1], [2.5, 7.25], [11, 9]]) {
    const { sx, sy } = toScreen(x, y);
    const t = toTile(sx, sy);
    assert.ok(close(t.x, x) && close(t.y, y), `${x},${y}`);
  }
  assert.deepEqual(toScreen(1, 0), { sx: 32, sy: 16 });
  assert.deepEqual(toScreen(0, 1), { sx: -32, sy: 16 });
});

test('every home has a room, and they get bigger', () => {
  for (const h of HOMES) assert.ok(ROOM_SIZE[h.id], h.id);
  const areas = HOMES.map((h) => roomSize(h.id).w * roomSize(h.id).h);
  for (let i = 1; i < areas.length; i++) assert.ok(areas[i] > areas[i - 1]);
});

// a fully kitted-out life in every home: all the gear, as much decor as fits
const kitted = (home) => {
  const l = newLife();
  const top = (slot) => GEAR.filter((g) => g.slot === slot).sort((a, b) => b.tier - a.tier)[0].id;
  const decor = GEAR.filter((g) => g.slot === 'decor').map((g) => g.id);
  return { ...l, home, owned: GEAR.map((g) => g.id), decor: decor.slice(0, HOMES.find((h) => h.id === home).decor),
    equipped: { controller: top('controller'), headphones: top('headphones'), speakers: top('speakers'), lights: top('lights'), outfit: top('outfit') } };
};

for (const h of HOMES) {
  for (const [name, life] of [['starter', { ...newLife(), home: h.id }], ['kitted', kitted(h.id)]]) {
    test(`${h.name} (${name}): nothing overlaps, and you can walk to everything you can use`, () => {
      const items = layout(life), room = roomSize(h.id), block = blocked(items);
      const floor = items.filter((i) => !i.wall && !KINDS[i.kind].hang);
      floor.forEach((it, i) => assert.ok(fits(it, floor.filter((_, j) => j !== i), room.w, room.h), `${it.id} fits`));
      for (const k of ['door', 'booth', 'laptop', 'wardrobe', 'bed']) assert.ok(items.some((i) => i.kind === k), k);
      const start = startSpot(items, room);
      assert.ok(!block.has(`${start.x},${start.y}`));
      for (const it of items.filter((i) => i.use)) {
        const spot = standSpot(it, room, block, start);
        assert.ok(spot, `somewhere to stand by ${it.id}`);
        assert.ok(nextTo(spot, it), `${it.id}: the spot is next to it`);
        assert.ok(findPath(start, spot, room, block), `a way to ${it.id}`);
      }
    });
  }
}

test('the decor you put up shows in the room', () => {
  const l = { ...newLife(), home: 'flat', decor: ['dec-plant', 'dec-neon', 'dec-disco'] };
  const kinds = layout(l).map((i) => i.kind);
  assert.ok(kinds.includes('plant') && kinds.includes('neon') && kinds.includes('disco'));
  assert.ok(!layout(newLife()).some((i) => i.kind === 'speaker'), 'laptop speakers don\'t stand on the floor');
});

test('paths go round furniture and never through it', () => {
  const room = { w: 5, h: 5 };
  const block = new Set(['2,0', '2,1', '2,2', '2,3']);
  const p = findPath({ x: 0, y: 0 }, { x: 4, y: 0 }, room, block);
  assert.ok(p);
  assert.equal(p.length, 12);
  assert.ok(p.every((s) => !block.has(`${s.x},${s.y}`)));
  for (let i = 1; i < p.length; i++) assert.equal(Math.abs(p[i].x - p[i - 1].x) + Math.abs(p[i].y - p[i - 1].y), 1);
  assert.deepEqual(findPath({ x: 1, y: 1 }, { x: 1, y: 1 }, room, block), []);
  assert.equal(findPath({ x: 0, y: 0 }, { x: 2, y: 1 }, room, block), null, 'not onto furniture');
  const walled = new Set(['2,0', '2,1', '2,2', '2,3', '2,4']);
  assert.equal(findPath({ x: 0, y: 0 }, { x: 4, y: 0 }, room, walled), null, 'no way through');
});

test('facing follows the step', () => {
  assert.equal(facing({ x: 1, y: 1 }, { x: 2, y: 1 }), 'se');
  assert.equal(facing({ x: 1, y: 1 }, { x: 0, y: 1 }), 'nw');
  assert.equal(facing({ x: 1, y: 1 }, { x: 1, y: 2 }), 'sw');
  assert.equal(facing({ x: 1, y: 1 }, { x: 1, y: 0 }), 'ne');
});

// ---------- the town ----------
import { TOWN, BUILDINGS, townLayout, townBlocked, outside, groundAt, isRoad } from '../js/packs/djlife/town.js';
import { VENUES } from '../js/career.js';

test('town: buildings sit inside the map, off the roads, and never overlap', () => {
  for (const b of BUILDINGS) {
    assert.ok(b.x >= 0 && b.y >= 0 && b.x + b.w <= TOWN.w && b.y + b.h <= TOWN.h, b.id);
    for (let i = 0; i < b.w; i++) for (let j = 0; j < b.h; j++) assert.ok(!isRoad(b.x + i, b.y + j), `${b.id} on a road`);
    assert.ok(b.door >= b.x && b.door < b.x + b.w, `${b.id} door on its front`);
  }
  for (let i = 0; i < BUILDINGS.length; i++) for (let j = i + 1; j < BUILDINGS.length; j++) {
    const a = BUILDINGS[i], b = BUILDINGS[j];
    assert.ok(!(a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h), `${a.id} / ${b.id}`);
  }
});

test('town: every venue past your bedroom has a building, plus the shops, the estate agent and the showroom', () => {
  for (const v of VENUES.filter((x) => x.id !== 'bedroom')) assert.ok(BUILDINGS.some((b) => b.venue === v.id), v.id);
  for (const u of ['home', 'estate', 'cars', 'shop']) assert.ok(BUILDINGS.some((b) => b.use === u), u);
  const shelves = BUILDINGS.filter((b) => b.use === 'shop').flatMap((b) => b.slots);
  for (const s of ['controller', 'headphones', 'speakers', 'lights', 'outfit', 'decor']) assert.ok(shelves.includes(s), s);
});

test('town: from your front door you can walk to every door, with or without a car on the drive', () => {
  for (const life of [newLife(), { ...newLife(), car: 'car-van', carsOwned: ['car-van'] }]) {
    const items = townLayout(life), block = townBlocked(items), start = outside(items);
    assert.ok(!block.has(`${start.x},${start.y}`));
    for (const b of items.filter((i) => i.kind === 'building')) {
      assert.ok(!block.has(`${b.stand.x},${b.stand.y}`), `${b.id}: outside the door is free`);
      assert.ok(findPath(start, b.stand, TOWN, block), `a way to ${b.id}`);
      assert.ok(nextTo(b.stand, b), `${b.id}: standing at the door counts as next to it`);
    }
  }
});

test('town: roads, then pavement beside them, then grass', () => {
  assert.equal(groundAt(5, 10), 'road');
  assert.equal(groundAt(5, 9), 'path');
  assert.equal(groundAt(5, 1), 'grass');
});

// ---------- inside venues ----------
import { venueLayout, VENUE_ROOM } from '../js/packs/djlife/venue.js';

test('venues: a room for every venue with a building, and you can walk from the door to the booth', () => {
  for (const b of BUILDINGS.filter((x) => x.use === 'venue')) {
    assert.ok(VENUE_ROOM[b.venue], b.venue);
    const { room, items, crowd } = venueLayout(b.venue);
    const block = blocked(items);
    const door = items.find((i) => i.id === 'door'), booth = items.find((i) => i.id === 'booth');
    const start = standSpot(door, room, block);
    const spot = standSpot(booth, room, block, start);
    assert.ok(start && spot && findPath(start, spot, room, block), `${b.venue}: door to booth`);
    assert.ok(crowd.length > 0, 'a crowd');
    assert.ok(crowd.every((p) => p.x >= 0 && p.y >= 0 && p.x < room.w && p.y < room.h), 'crowd inside');
  }
  assert.equal(venueLayout('main', 48).crowd.length, 48);
});

// ---------- build mode ----------
import { applyMoves, canReachAll, movable, turned } from '../js/packs/djlife/iso.js';

test('build mode: moved things stay where you put them, turned round', () => {
  const l = { ...newLife(), home: 'flat', layout: { flat: { bed: { x: 0, y: 2, turn: 1 } } } };
  const bed = layout(l).find((i) => i.id === 'bed');
  assert.deepEqual([bed.x, bed.y, bed.w, bed.h, bed.turn], [0, 2, 3, 2, 1]);
});

test('build mode: a move that doesn\'t fit, or walls you in, is ignored', () => {
  const base = { ...newLife(), home: 'parents' };
  const plain = layout(base).find((i) => i.id === 'bed');
  for (const move of [{ x: 6, y: 5 }, { x: 2, y: 0 }, { x: -1, y: 0 }]) {
    const bed = layout({ ...base, layout: { parents: { bed: move } } }).find((i) => i.id === 'bed');
    assert.deepEqual([bed.x, bed.y], [plain.x, plain.y], JSON.stringify(move));
  }
  // a bed across the doorway would cut you off from everything
  const items = layout(base);
  const door = items.find((i) => i.kind === 'door');
  const blocking = items.map((i) => (i.id === 'bed' ? { ...turned(i, 1), x: 0, y: door.y - 1 } : i));
  assert.equal(canReachAll(blocking, roomSize('parents')), false);
  assert.ok(canReachAll(items, roomSize('parents')));
});

test('build mode: the door can\'t be moved; furniture can', () => {
  const items = layout({ ...newLife(), home: 'flat' });
  assert.ok(!movable(items.find((i) => i.kind === 'door')));
  assert.ok(movable(items.find((i) => i.kind === 'bed')) && movable(items.find((i) => i.kind === 'booth')));
});
