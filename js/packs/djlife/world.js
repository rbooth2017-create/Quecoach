// DJ Life world: walk round as your DJ, in isometric 2D. Three kinds of place:
//   room   your home. The decks, the laptop (gigs), the wardrobe (shop), the door out. Build mode moves things.
//   town   the streets: your home, the venues, the shops, the estate agent, the car showroom.
//   venue  inside a club or bar: the booth on the stage, the bar, a dancing crowd.
// Click a spot to walk there (or arrow keys / WASD), walk up to things and press E to use them.
// Layouts come from iso.js, town.js and venue.js; drawing from sprites.js and townsprites.js.
import { icon } from '../../icons.js';
import { venueById } from '../../career.js';
import {
  layout, blocked, findPath, standSpot, nextTo, roomSize, startSpot, facing, toScreen, toTile, KINDS,
  movable, turned, fits, blocksFloor, canReachAll,
} from './iso.js';
import { drawRoom, drawThing, drawWallThing, drawDJ, drawHover, drawFootprint, WALL_H, box } from './sprites.js';
import { drawGround, drawBuilding, drawTree, drawLamp, drawLampGlow, drawCar, drawPerson } from './townsprites.js';
import { TOWN, townLayout, townBlocked, outside } from './town.js';
import { venueLayout } from './venue.js';
import { gearById } from './gear.js';
import { homeById } from './homes.js';
import { money, weekOf, weekday, DAY_NAMES } from './economy.js';

const SPEED = 3.6; // tiles a second
const KEYS = { ArrowUp: [0, -1], KeyW: [0, -1], ArrowRight: [1, 0], KeyD: [1, 0], ArrowDown: [0, 1], KeyS: [0, 1], ArrowLeft: [-1, 0], KeyA: [-1, 0] };
const HOUSE = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 11l9-7 9 7M5 9.5V20h14V9.5M10 20v-5h4v5"/></svg>';
const MOVE = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3"/></svg>';

/**
 * getLife(): the current save. use(what, item): DJ Life does something ('decks', 'laptop', 'look', 'sofa', 'shop',
 * 'estate', 'cars', 'set'). marks(): { buildingId: 'gig' | 'offer' } for the town. saveMove(home, id, move): build
 * mode put something down. djName(): for the neon sign. sound(name): a little sound effect. onClose(): closed.
 * goal(scene, venue): what to do next, for new players: { id (the thing to point at, or null), text } or null.
 */
export function createWorld({ getLife, use, marks, saveMove, djName, sound, onClose, goal }) {
  const el = document.createElement('div');
  el.className = 'dl-world hidden';
  el.tabIndex = -1;
  el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', 'Your DJ world');
  el.innerHTML = `<canvas aria-hidden="true"></canvas>
    <div class="dl-whud">
      <div class="dl-wl"><b data-w="title"></b><span data-w="sub"></span></div>
      <div class="dl-wr"><span class="pv-chip dl-cash" data-w="cash"></span>
        <button class="pv-chip" data-wa="build" data-w="buildbtn">${MOVE}Move things</button>
        <button class="pv-chip" data-wa="home" data-w="homebtn">${HOUSE}Home</button>
        <button class="pv-chip" data-wa="laptop">${icon('disc', 15)}Gigs</button>
        <button class="pv-chip" data-wa="decks">${icon('sliders', 15)}Decks</button>
        <button class="pv-x" data-wa="close" aria-label="Close" title="Close (Esc)">${icon('x', 16)}</button></div>
    </div>
    <div class="dl-goal hidden" data-w="goal" role="status"></div>
    <div class="dl-prompt hidden" data-w="prompt"><kbd>E</kbd><span data-w="say"></span></div>
    <div class="dl-whelp" data-w="help"></div>`;
  document.body.append(el);
  const cv = el.querySelector('canvas'), ctx = cv.getContext('2d');
  const W = (k) => el.querySelector(`[data-w="${k}"]`);

  const st = {
    open: false, raf: 0, last: 0, t: 0,
    scene: 'room', venue: null, items: [], crowd: [], room: { w: 7, h: 6 }, block: new Set(), key: '',
    pos: { x: 1, y: 1 }, at: { x: 1, y: 1 }, path: [], face: 'se', walk: null, goal: null,
    keys: new Set(), mouse: null, cam: { x: 0, y: 0, s: 1 }, near: null, fixed: true,
    build: null, // { pick: item | null, turn, x, y } while moving things
  };

  // ---------- places ----------
  /** Lay the place out again (after buying, moving house, moving things). Keeps you where you are if you still fit. */
  function refresh() {
    const life = getLife();
    let key;
    if (st.scene === 'town') {
      st.items = townLayout(life); st.room = TOWN; st.block = townBlocked(st.items); st.crowd = [];
      key = 'town';
    } else if (st.scene === 'venue') {
      const v = venueLayout(st.venue, crowdTonight());
      st.items = v.items; st.room = v.room; st.block = blocked(v.items); st.crowd = v.crowd;
      key = `venue:${st.venue}`;
    } else {
      st.items = layout(life); st.room = roomSize(life.home); st.block = blocked(st.items); st.crowd = [];
      key = `room:${life.home}`;
    }
    if (key !== st.key || st.block.has(`${st.at.x},${st.at.y}`) || st.at.x >= st.room.w || st.at.y >= st.room.h) place(startFor());
    st.key = key;
    st.fixed = st.scene !== 'town';
    const title = st.scene === 'town' ? 'Town' : st.scene === 'venue' ? venueById(st.venue).name : homeById(life.home).name;
    W('title').textContent = title;
    W('sub').textContent = `Week ${weekOf(life.day) + 1} · ${DAY_NAMES[weekday(life.day)]}`;
    W('cash').textContent = money(life.cash);
    W('buildbtn').hidden = st.scene !== 'room';
    W('buildbtn').classList.toggle('on', !!st.build);
    W('homebtn').hidden = st.scene === 'room';
    help();
    resize();
  }
  function startFor() {
    if (st.scene === 'town') return outside(st.items, st.from || 'home');
    if (st.scene === 'venue') { const door = st.items.find((i) => i.id === 'door'); return standSpot(door, st.room, st.block, { x: 1, y: door.y }); }
    return startSpot(st.items, st.room);
  }
  function place(p) { st.at = { ...p }; st.pos = { ...p }; st.path = []; st.goal = null; st.face = st.scene === 'town' ? 'sw' : 'se'; }
  /** How many people are in tonight: a full house for your gig, a quieter night otherwise. */
  function crowdTonight() {
    const life = getLife(), v = venueById(st.venue);
    return life.gig && !life.gig.offer.hosted && life.gig.offer.venue === st.venue ? v.crowd : Math.max(3, Math.round(v.crowd * 0.4));
  }
  /** Go somewhere else. from: the building you came out of (town) or venue id (venue). */
  function go(scene, from = null) {
    if (st.build) endBuild();
    st.scene = scene; st.from = scene === 'town' ? from : null; st.venue = scene === 'venue' ? from : null;
    st.key = ''; // force a fresh start spot
    sound?.('door');
    refresh();
  }

  function open(scene = 'room') {
    st.scene = scene; st.key = '';
    el.classList.remove('hidden'); st.open = true;
    refresh(); st.last = performance.now();
    cancelAnimationFrame(st.raf); st.raf = requestAnimationFrame(tick);
    el.focus({ preventScroll: true });
  }
  function close(quiet) {
    if (!st.open) return;
    if (st.build) endBuild();
    st.open = false; el.classList.add('hidden'); cancelAnimationFrame(st.raf); st.keys.clear();
    if (!quiet) onClose?.();
  }

  // ---------- the camera ----------
  function resize() {
    if (!st.open) return;
    const r = el.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    if (!r.width) return;
    cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr);
    cv.style.width = `${r.width}px`; cv.style.height = `${r.height}px`;
    st.view = { w: r.width, h: r.height, dpr };
    if (st.scene === 'town') { st.cam.s = Math.max(0.75, Math.min(1.4, r.width / (18 * 64))) * dpr; follow(true); return; }
    const { w, h } = st.room;
    const xs = [toScreen(0, h).sx, toScreen(w, 0).sx], top = toScreen(0, 0, WALL_H + 60).sy, bottom = toScreen(w, h).sy;
    const rw = xs[1] - xs[0], rh = bottom - top;
    const s = Math.min((r.width - 40) / rw, (r.height - 150) / rh, 1.8);
    st.cam = { s: s * dpr, x: (r.width / 2 - (xs[0] + rw / 2) * s) * dpr, y: ((r.height - rh * s) / 2 + 20 - top * s) * dpr };
  }
  /** In town the camera follows you, easing along. */
  function follow(snap) {
    const v = st.view; if (!v) return;
    const p = toScreen(st.pos.x + 0.5, st.pos.y + 0.5, 30);
    const tx = (v.w / 2) * v.dpr - p.sx * st.cam.s, ty = (v.h / 2 + 30) * v.dpr - p.sy * st.cam.s;
    const k = snap ? 1 : 0.12;
    st.cam.x += (tx - st.cam.x) * k; st.cam.y += (ty - st.cam.y) * k;
  }
  const ro = new ResizeObserver(() => resize());
  ro.observe(el);

  /** Screen point (CSS px) → tile, with the raw screen point too. */
  function tileAt(cx, cy) {
    const dpr = window.devicePixelRatio || 1;
    const sx = (cx * dpr - st.cam.x) / st.cam.s, sy = (cy * dpr - st.cam.y) / st.cam.s;
    const t = toTile(sx, sy);
    return { x: Math.floor(t.x), y: Math.floor(t.y), sx, sy };
  }
  const inside = (p) => p.x >= 0 && p.y >= 0 && p.x < st.room.w && p.y < st.room.h;
  /** The tall it's drawn at, for clicking on its picture. */
  const tallOf = (it) => (it.kind === 'building' ? (it.tall || 70) + 20 : KINDS[it.kind]?.tall || 30);
  /** The outline of something as drawn on screen (a box: six corners; a thing on a wall: a patch of wall). */
  function outline(it) {
    const z = tallOf(it);
    if (it.wall === 'right') return [toScreen(0, it.y, 0), toScreen(0, it.y + it.w, 0), toScreen(0, it.y + it.w, z), toScreen(0, it.y, z)];
    if (it.wall === 'left') return [toScreen(it.x, 0, 0), toScreen(it.x + it.w, 0, 0), toScreen(it.x + it.w, 0, z), toScreen(it.x, 0, z)];
    return [toScreen(it.x, it.y + it.h), toScreen(it.x + it.w, it.y + it.h), toScreen(it.x + it.w, it.y), toScreen(it.x + it.w, it.y, z), toScreen(it.x, it.y, z), toScreen(it.x, it.y + it.h, z)];
  }
  function inPoly(pts, x, y) {
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const a = pts[i], b = pts[j];
      if ((a.sy > y) !== (b.sy > y) && x < ((b.sx - a.sx) * (y - a.sy)) / (b.sy - a.sy) + a.sx) inside = !inside;
    }
    return inside;
  }
  /** What's under the mouse: the front-most thing you can use (or, in build mode, move) drawn over that point. */
  function thingAt(p, want = (it) => it.use) {
    const hits = st.items.filter((it) => want(it) && inPoly(outline(it), p.sx, p.sy));
    hits.sort((a, b) => (b.x + b.w + b.y + b.h) - (a.x + a.w + a.y + a.h) + (a.wall ? 100 : 0) - (b.wall ? 100 : 0));
    if (hits[0]) return hits[0];
    // the pavement outside a door counts as the building too
    return st.items.find((it) => want(it) && it.stand && it.stand.x === p.x && it.stand.y === p.y) || null;
  }

  // ---------- walking ----------
  function walkTo(target, goal = null) {
    const path = findPath(st.at, target, st.room, st.block);
    if (!path) return false;
    st.path = path; st.goal = goal;
    if (!path.length && goal) arrive();
    return true;
  }
  function goUse(it) {
    if (nextTo(st.at, it) && !st.path.length) { faceTowards(it); return doUse(it); }
    const spot = standSpot(it, st.room, st.block, st.at);
    if (spot) walkTo(spot, it);
  }
  function faceTowards(it) {
    if (it.stand) { st.face = 'ne'; return; }
    const cx = it.wall === 'right' ? -1 : it.x + it.w / 2 - 0.5, cy = it.wall === 'left' ? -1 : it.y + it.h / 2 - 0.5;
    const dx = cx - st.at.x, dy = cy - st.at.y;
    st.face = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'se' : 'nw') : (dy > 0 ? 'sw' : 'ne');
  }
  function arrive() {
    const g = st.goal; st.goal = null;
    if (g && nextTo(st.at, g)) { faceTowards(g); doUse(g); }
  }
  /** Using something: moving between places happens here; everything else is DJ Life's job. */
  function doUse(it) {
    const u = it.use; if (!u) return;
    if (u === 'door') return go('town', 'home');
    if (u === 'home') return go('room');
    if (u === 'venue') return go('venue', it.venue);
    if (u === 'exit') return go('town', st.venue); // each venue's building has the venue's id
    if (u === 'set') return use('set', { venue: st.venue });
    use(u, it);
  }
  /** What the prompt says next to something (some things change with what's going on). */
  function sayFor(it) {
    if (it.use === 'set') {
      const g = getLife().gig;
      return g && !g.offer.hosted && g.offer.venue === st.venue ? 'Start your set' : 'Ask about gigs here';
    }
    return it.say;
  }

  function step(dt) {
    if (!st.path.length && st.keys.size && !st.build?.pick) {
      const [dx, dy] = KEYS[[...st.keys].pop()];
      const n = { x: st.at.x + dx, y: st.at.y + dy };
      st.face = facing(st.at, n);
      if (inside(n) && !st.block.has(`${n.x},${n.y}`)) { st.path = [n]; st.goal = null; }
    }
    if (!st.path.length) { st.walk = null; return; }
    const n = st.path[0];
    st.face = facing(st.at, n);
    const dx = n.x - st.pos.x, dy = n.y - st.pos.y, d = Math.hypot(dx, dy), mv = SPEED * dt;
    st.walk = ((st.walk || 0) + dt * 2.2) % 1;
    if (d <= mv) {
      st.pos = { ...n }; st.at = { ...n }; st.path.shift();
      if (!st.path.length) arrive();
    } else { st.pos.x += (dx / d) * mv; st.pos.y += (dy / d) * mv; }
  }

  // ---------- build mode (your room only) ----------
  function startBuild() {
    if (st.scene !== 'room') return;
    st.build = { pick: null, turn: 0 };
    st.path = []; st.goal = null;
    refreshButtons(); help();
  }
  function endBuild() { st.build = null; refreshButtons(); help(); }
  function refreshButtons() { W('buildbtn').classList.toggle('on', !!st.build); W('buildbtn').lastChild.textContent = st.build ? 'Done moving' : 'Move things'; }
  /** Where the thing you're holding would go, and whether it can. */
  function ghost() {
    const b = st.build; if (!b?.pick || !st.mouse) return null;
    const p = tileAt(st.mouse.x, st.mouse.y);
    const it = { ...turned(b.pick, b.turn), x: p.x, y: p.y };
    const rest = st.items.filter((i) => i.id !== it.id);
    const youThere = st.at.x >= it.x && st.at.x < it.x + it.w && st.at.y >= it.y && st.at.y < it.y + it.h;
    const ok = !youThere && fits(it, rest.filter(blocksFloor), st.room.w, st.room.h) && canReachAll([...rest, it], st.room);
    return { it, ok };
  }
  function buildClick(p) {
    const b = st.build;
    if (!b.pick) {
      const it = thingAt(p, movable) || st.items.find((i) => movable(i) && p.x >= i.x && p.x < i.x + i.w && p.y >= i.y && p.y < i.y + i.h);
      if (!it) return;
      b.pick = it; b.turn = it.turn || 0;
      sound?.('pick');
      return help();
    }
    const g = ghost();
    if (!g?.ok) { sound?.('nope'); return; }
    saveMove(getLife().home, g.it.id, { x: g.it.x, y: g.it.y, turn: b.turn });
    b.pick = null; sound?.('drop');
    refresh(); help();
  }

  // ---------- drawing ----------
  function draw() {
    const life = getLife(), name = djName();
    st.marks = st.scene === 'town' ? marks() : {};
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.setTransform(st.cam.s, 0, 0, st.cam.s, st.cam.x, st.cam.y);
    const look = { outfit: life.equipped.outfit, headphones: gearById(life.equipped.headphones)?.tier || 0 };
    const you = { you: true, x: st.pos.x, y: st.pos.y };
    const hov = st.mouse && !st.build?.pick ? tileAt(st.mouse.x, st.mouse.y) : null;
    const hovThing = hov && (st.build ? thingAt(hov, movable) : thingAt(hov));

    if (st.scene === 'town') {
      const v = st.view, inv = 1 / st.cam.s;
      drawGround(ctx, TOWN, { x0: -st.cam.x * inv, x1: (v.w * v.dpr - st.cam.x) * inv, y0: -st.cam.y * inv, y1: (v.h * v.dpr - st.cam.y) * inv });
      for (const it of st.items.filter((i) => i.kind === 'lamp')) drawLampGlow(ctx, it);
    } else {
      const lights = st.scene === 'venue' ? 3 : gearById(life.equipped.lights)?.tier || 0;
      drawRoom(ctx, st.room, st.scene === 'venue' ? venueRoomLook(st.venue) : life.home, st.t, lights);
      for (const it of st.items.filter((i) => i.wall && i.kind !== 'led')) drawWallThing(ctx, it, st.t, name, st.room);
      for (const it of st.items.filter((i) => KINDS[i.kind]?.deco)) drawThing(ctx, it, st.t, name, st.room); // the stage, under everything
    }
    // hover and "you can use this"
    if (hovThing) drawFootprint(ctx, hovThing.stand ? { ...hovThing, x: hovThing.stand.x, y: hovThing.stand.y, w: 1, h: 1, kind: 'plant' } : hovThing);
    else if (hov && inside(hov) && !st.block.has(`${hov.x},${hov.y}`)) drawHover(ctx, hov.x, hov.y, false);
    if (st.near && !hovThing && !st.build) drawFootprint(ctx, st.near.stand ? { ...st.near, x: st.near.stand.x, y: st.near.stand.y, w: 1, h: 1, kind: 'plant' } : st.near);
    const g = ghost();
    cv.style.cursor = st.build ? (st.build.pick ? (g?.ok ? 'copy' : 'not-allowed') : hovThing ? 'grab' : 'default') : hovThing ? 'pointer' : 'default';

    // things on the floor, the crowd and you: further back first. You go behind anything you're not in front of.
    const floor = st.items.filter((i) => !i.wall && !KINDS[i.kind]?.hang && !KINDS[i.kind]?.deco && !(st.build?.pick && i.id === st.build.pick.id));
    const people = st.crowd.map((c) => ({ person: true, ...c }));
    const front = (it, p) => p.x >= it.x + it.w || p.y >= it.y + it.h;
    const behindYou = floor.filter((it) => front(it, you)), afterYou = floor.filter((it) => !front(it, you));
    const sortKey = (o) => (o.person || o.you ? o.x + o.y : o.x + o.y + o.w + o.h - 1);
    const drawOne = (o) => {
      if (o.you) return drawDJ(ctx, o.x + 0.5, o.y + 0.5, st.face, st.walk, look);
      if (o.person) return drawPerson(ctx, o.x, o.y, st.t, venueEnergy(), o.seed);
      drawItem(o, life, name);
    };
    const peopleBehind = people.filter((p) => p.x + p.y < you.x + you.y + 1), peopleAfter = people.filter((p) => p.x + p.y >= you.x + you.y + 1);
    [...behindYou, ...peopleBehind].sort((a, b) => sortKey(a) - sortKey(b)).forEach(drawOne);
    drawOne(you);
    // anything big in front of you goes see-through, so you never get lost behind a building
    const me = toScreen(you.x + 0.5, you.y + 0.5, 30);
    [...afterYou, ...peopleAfter].sort((a, b) => sortKey(a) - sortKey(b)).forEach((o) => {
      const hide = !o.person && (o.kind === 'building' || o.kind === 'tree' || tallOf(o) > 50) && inPoly(outline(o), me.sx, me.sy);
      if (hide) { ctx.save(); ctx.globalAlpha = 0.35; drawOne(o); ctx.restore(); } else drawOne(o);
    });
    // ceiling things and lights on top
    for (const it of st.items.filter((i) => KINDS[i.kind]?.hang)) drawThing(ctx, it, st.t, name, st.room);
    for (const it of st.items.filter((i) => i.kind === 'led')) drawWallThing(ctx, it, st.t, name, st.room);
    // your gig is off screen: an arrow at the edge points the way
    if (st.scene === 'town') pointToGig();
    // what to do next: a bouncing arrow over it
    const next = st.goalNow?.id && !st.build ? st.items.find((i) => i.id === st.goalNow.id) : null;
    if (next) drawGoalArrow(next);
    // the thing you're holding in build mode
    if (g) {
      ctx.save(); ctx.globalAlpha = 0.75; drawThing(ctx, g.it, st.t, name, st.room); ctx.restore();
      const t = g.it;
      ctx.save(); ctx.globalAlpha = 0.45;
      box(ctx, t.x, t.y, t.w, t.h, 0, 1, g.ok ? '#4ade80' : '#fb7185');
      ctx.restore();
    }
  }
  function drawGoalArrow(it) {
    const pts = outline(it);
    const x = pts.reduce((a, p) => a + p.sx, 0) / pts.length, top = Math.min(...pts.map((p) => p.sy));
    const y = top - 10 - Math.abs(Math.sin(st.t * 4)) * 10;
    ctx.save();
    ctx.fillStyle = '#facc15'; ctx.shadowColor = '#facc15'; ctx.shadowBlur = 14;
    ctx.beginPath();
    ctx.moveTo(x, y); ctx.lineTo(x - 13, y - 15); ctx.lineTo(x - 5, y - 15); ctx.lineTo(x - 5, y - 30);
    ctx.lineTo(x + 5, y - 30); ctx.lineTo(x + 5, y - 15); ctx.lineTo(x + 13, y - 15); ctx.closePath(); ctx.fill();
    ctx.restore();
  }
  function pointToGig() {
    const id = Object.keys(st.marks).find((k) => st.marks[k] === 'gig'); if (!id) return;
    const b = st.items.find((i) => i.kind === 'building' && i.id === id); if (!b) return;
    const v = st.view, p = toScreen(b.x + b.w / 2, b.y + b.h / 2, 40);
    const x = (p.sx * st.cam.s + st.cam.x) / v.dpr, y = (p.sy * st.cam.s + st.cam.y) / v.dpr;
    const m = 60;
    if (x > m && x < v.w - m && y > 90 && y < v.h - 110) return; // you can see it
    const cx = v.w / 2, cy = v.h / 2, ang = Math.atan2(y - cy, x - cx);
    const k = Math.min((v.w / 2 - m) / Math.abs(Math.cos(ang) || 1e-6), (v.h / 2 - 100) / Math.abs(Math.sin(ang) || 1e-6));
    const ax = cx + Math.cos(ang) * k, ay = cy + Math.sin(ang) * k;
    ctx.save(); ctx.setTransform(v.dpr, 0, 0, v.dpr, 0, 0);
    ctx.translate(ax, ay); ctx.rotate(ang);
    const pulse = 1 + Math.sin(st.t * 5) * 0.08; ctx.scale(pulse, pulse);
    ctx.fillStyle = '#f472b6'; ctx.shadowColor = '#f472b6'; ctx.shadowBlur = 16;
    ctx.beginPath(); ctx.moveTo(18, 0); ctx.lineTo(-10, -13); ctx.lineTo(-4, 0); ctx.lineTo(-10, 13); ctx.closePath(); ctx.fill();
    ctx.restore();
    ctx.save(); ctx.setTransform(v.dpr, 0, 0, v.dpr, 0, 0);
    ctx.font = '800 11px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = '#f9a8d4';
    ctx.fillText(b.name.toUpperCase(), ax - Math.cos(ang) * 34, ay - Math.sin(ang) * 26 + 4);
    ctx.restore();
  }
  function drawItem(it, life, name) {
    if (it.kind === 'building') return drawBuilding(ctx, it, st.t, st.marks[it.id] || null);
    if (it.kind === 'tree') return drawTree(ctx, it, st.t);
    if (it.kind === 'lamp') return drawLamp(ctx, it);
    if (it.kind === 'car') return drawCar(ctx, it, st.t);
    drawThing(ctx, it, st.t, name, st.room);
  }
  /** How hard the crowd dances: your gig here tonight gets them going. */
  function venueEnergy() {
    const g = getLife().gig;
    return g && g.offer.venue === st.venue ? 0.95 : 0.45;
  }

  function tick(now) {
    if (!st.open) return;
    const dt = Math.min(0.05, (now - st.last) / 1000); st.last = now; st.t += dt;
    step(dt);
    if (st.scene === 'town') follow(false);
    const gl = st.build ? null : goal?.(st.scene, st.venue) || null;
    const gt = gl?.text || '';
    if (gt !== (st.goalNow?.text || '')) { W('goal').textContent = gt; W('goal').classList.toggle('hidden', !gt); }
    st.goalNow = gl;
    const near = st.path.length || st.build ? null : st.items.find((i) => i.use && nextTo(st.at, i)) || null;
    const say = near ? sayFor(near) : '';
    if (near !== st.near || say !== st.say) {
      st.near = near; st.say = say;
      W('prompt').classList.toggle('hidden', !near);
      if (near) W('say').textContent = say;
    }
    draw();
    st.raf = requestAnimationFrame(tick);
  }
  function help() {
    W('help').innerHTML = st.build
      ? (st.build.pick ? 'Click to put it down · <kbd>R</kbd> to turn it · <kbd>Esc</kbd> to put it back' : 'Click something to pick it up · <kbd>B</kbd> or <kbd>Esc</kbd> when you\'re done')
      : `Click to walk · Arrow keys or WASD · <kbd>E</kbd> to use${st.scene === 'room' ? ' · <kbd>B</kbd> to move things' : ''}`;
  }

  // ---------- input ----------
  cv.addEventListener('pointermove', (e) => { const r = cv.getBoundingClientRect(); st.mouse = { x: e.clientX - r.left, y: e.clientY - r.top }; });
  cv.addEventListener('pointerleave', () => { st.mouse = null; });
  cv.addEventListener('click', (e) => {
    const r = cv.getBoundingClientRect(), p = tileAt(e.clientX - r.left, e.clientY - r.top);
    if (st.build) return buildClick(p);
    const it = thingAt(p);
    if (it) return goUse(it);
    if (inside(p)) walkTo({ x: p.x, y: p.y });
  });
  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-wa]'); if (!b) return;
    const a = b.dataset.wa;
    if (a === 'close') return close();
    if (a === 'build') return st.build ? endBuild() : startBuild();
    if (a === 'home') return go('room');
    use(a);
  });
  W('prompt').addEventListener('click', () => { if (st.near) doUse(st.near); });
  const onKey = (e) => {
    if (!st.open || e.target.closest?.('input, textarea')) return;
    if (document.querySelector('.dl-layer:not(.hidden), dialog[open]')) return; // a card is open on top
    if (e.type === 'keyup') { st.keys.delete(e.code); return; }
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    e.stopImmediatePropagation(); // while you're walking round, keys move you, not the decks
    if (e.code === 'Escape') {
      e.preventDefault();
      if (st.build?.pick) { st.build.pick = null; return help(); }
      if (st.build) return endBuild();
      return close();
    }
    if (st.build && e.code === 'KeyR' && st.build.pick) { st.build.turn = (st.build.turn + 1) % 4; return; }
    if (e.code === 'KeyB' && st.scene === 'room') { e.preventDefault(); return st.build ? endBuild() : startBuild(); }
    if (KEYS[e.code]) { e.preventDefault(); st.keys.delete(e.code); st.keys.add(e.code); st.path = st.path.slice(0, 1); st.goal = null; return; }
    if ((e.code === 'KeyE' || e.code === 'Space' || e.code === 'Enter') && st.near) { e.preventDefault(); doUse(st.near); }
  };
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('keyup', onKey, true);
  const onBlur = () => st.keys.clear();
  window.addEventListener('blur', onBlur);

  return {
    open, close, refresh, go,
    isOpen: () => st.open,
    scene: () => st.scene,
    destroy() { close(true); ro.disconnect(); window.removeEventListener('keydown', onKey, true); window.removeEventListener('keyup', onKey, true); window.removeEventListener('blur', onBlur); el.remove(); },
  };
}

const venueRoomLook = (id) => ({ party: 'party', basement: 'bar', warehouse: 'club', main: 'arena' }[id] || 'bar');
