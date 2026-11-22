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
