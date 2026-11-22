// DJ Life world: your room, in isometric 2D. Walk round it (click a spot, or the arrow keys / WASD) and use things:
// the decks to mix, the laptop for gigs, the wardrobe for the shop, the door to head out. The layout comes from
// iso.js, the drawing from sprites.js; this file is the screen, the controls and the walking.
import { icon } from '../../icons.js';
import { layout, blocked, findPath, standSpot, nextTo, roomSize, startSpot, facing, depth, toScreen, toTile, KINDS } from './iso.js';
import { drawRoom, drawThing, drawWallThing, drawDJ, drawHover, drawFootprint, WALL_H } from './sprites.js';
import { gearById } from './gear.js';
import { homeById } from './homes.js';
import { money, weekOf, weekday, DAY_NAMES } from './economy.js';

const SPEED = 3.4; // tiles a second
const KEYS = { ArrowUp: [0, -1], KeyW: [0, -1], ArrowRight: [1, 0], KeyD: [1, 0], ArrowDown: [0, 1], KeyS: [0, 1], ArrowLeft: [-1, 0], KeyA: [-1, 0] };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/**
 * getLife(): the current save. use(what): the room asks DJ Life to do something ('decks', 'laptop', 'look', 'door',
 * 'sofa'). djName(): for the neon sign. onClose(): the room was closed.
 */
export function createWorld({ getLife, use, djName, onClose }) {
  const el = document.createElement('div');
  el.className = 'dl-world hidden';
  el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', 'Your room');
  el.innerHTML = `<canvas aria-hidden="true"></canvas>
    <div class="dl-whud">
      <div class="dl-wl"><b data-w="home"></b><span data-w="day"></span></div>
      <div class="dl-wr"><span class="pv-chip dl-cash" data-w="cash"></span>
        <button class="pv-chip" data-wa="laptop">${icon('disc', 15)}Gigs</button>
        <button class="pv-chip" data-wa="decks">${icon('sliders', 15)}Decks</button>
        <button class="pv-x" data-wa="close" aria-label="Close your room" title="Close (Esc)">${icon('x', 16)}</button></div>
    </div>
    <div class="dl-prompt hidden" data-w="prompt"><kbd>E</kbd><span data-w="say"></span></div>
    <div class="dl-whelp">Click to walk · Arrow keys or WASD · <kbd>E</kbd> to use</div>`;
  document.body.append(el);
  const cv = el.querySelector('canvas'), ctx = cv.getContext('2d');
  const W = (k) => el.querySelector(`[data-w="${k}"]`);

  const st = {
    open: false, raf: 0, last: 0, t: 0,
    items: [], room: { w: 7, h: 6 }, block: new Set(), home: '',
    pos: { x: 1, y: 1 }, at: { x: 1, y: 1 }, path: [], face: 'se', walk: null, goal: null,
    keys: new Set(), mouse: null, cam: { x: 0, y: 0, s: 1 }, near: null,
  };

  /** Lay the room out again (after buying, moving, putting up decor). Keeps you where you are if you still fit. */
  function refresh() {
    const life = getLife();
    st.items = layout(life); st.room = roomSize(life.home); st.block = blocked(st.items);
    if (st.home !== life.home || st.block.has(`${st.at.x},${st.at.y}`) || st.at.x >= st.room.w || st.at.y >= st.room.h) {
      st.at = startSpot(st.items, st.room); st.pos = { ...st.at }; st.path = []; st.goal = null; st.face = 'se';
    }
    st.home = life.home;
    W('home').textContent = homeById(life.home).name;
    W('day').textContent = `Week ${weekOf(life.day) + 1} · ${DAY_NAMES[weekday(life.day)]}`;
    W('cash').textContent = money(life.cash);
  }

  function open() {
    refresh();
    el.classList.remove('hidden'); st.open = true;
    resize(); st.last = performance.now();
    cancelAnimationFrame(st.raf); st.raf = requestAnimationFrame(tick);
    el.focus?.();
  }
  function close(quiet) {
    if (!st.open) return;
    st.open = false; el.classList.add('hidden'); cancelAnimationFrame(st.raf); st.keys.clear();
    if (!quiet) onClose?.();
  }

  // ---------- fitting the room on screen ----------
  function resize() {
    const r = el.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr);
    cv.style.width = `${r.width}px`; cv.style.height = `${r.height}px`;
    // the room's outline on screen, walls included
    const { w, h } = st.room;
    const xs = [toScreen(0, h).sx, toScreen(w, 0).sx], top = toScreen(0, 0, WALL_H + 60).sy, bottom = toScreen(w, h).sy;
    const rw = xs[1] - xs[0], rh = bottom - top;
    const s = Math.min((r.width - 40) / rw, (r.height - 150) / rh, 1.8);
    st.cam = { s: s * dpr, x: (r.width / 2 - (xs[0] + rw / 2) * s) * dpr, y: ((r.height - rh * s) / 2 + 20 - top * s) * dpr };
  }
  const ro = new ResizeObserver(() => { if (st.open) resize(); });
  ro.observe(el);

  /** Screen point (CSS px) → tile. */
  function tileAt(cx, cy) {
    const dpr = window.devicePixelRatio || 1;
    const sx = (cx * dpr - st.cam.x) / st.cam.s, sy = (cy * dpr - st.cam.y) / st.cam.s;
    const t = toTile(sx, sy);
    return { x: Math.floor(t.x), y: Math.floor(t.y), sx, sy };
  }
  /** What's under the mouse: the front-most thing you can use whose drawn shape covers the point. */
  function thingAt(p) {
    const hits = st.items.filter((it) => {
      if (!it.use) return false;
      const k = KINDS[it.kind];
      const corners = it.wall === 'right' ? [toScreen(0, it.y, 0), toScreen(0, it.y + it.w, 0), toScreen(0, it.y, k.tall), toScreen(0, it.y + it.w, k.tall)]
        : it.wall === 'left' ? [toScreen(it.x, 0, 0), toScreen(it.x + it.w, 0, 0), toScreen(it.x, 0, k.tall), toScreen(it.x + it.w, 0, k.tall)]
        : [toScreen(it.x, it.y + it.h), toScreen(it.x + it.w, it.y), toScreen(it.x + it.w, it.y + it.h), toScreen(it.x, it.y, k.tall)];
      const xs = corners.map((c) => c.sx), ys = corners.map((c) => c.sy);
      return p.sx >= Math.min(...xs) && p.sx <= Math.max(...xs) && p.sy >= Math.min(...ys) && p.sy <= Math.max(...ys);
    });
    hits.sort((a, b) => depth(b) - depth(a));
    // standing on the floor in front of something beats its picture behind
    const onFloor = p.x >= 0 && p.y >= 0 && p.x < st.room.w && p.y < st.room.h && !st.block.has(`${p.x},${p.y}`);
    return hits.find((it) => !onFloor || it.wall || p.x >= it.x && p.x < it.x + it.w && p.y >= it.y && p.y < it.y + it.h) || (onFloor ? null : hits[0] || null);
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
    const cx = it.wall === 'right' ? -1 : it.x + it.w / 2 - 0.5, cy = it.wall === 'left' ? -1 : it.y + it.h / 2 - 0.5;
    const dx = cx - st.at.x, dy = cy - st.at.y;
    st.face = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'se' : 'nw') : (dy > 0 ? 'sw' : 'ne');
  }
  function arrive() {
    const g = st.goal; st.goal = null;
    if (g && nextTo(st.at, g)) { faceTowards(g); doUse(g); }
  }
  function doUse(it) { if (it.use) use(it.use); }

  function step(dt) {
    // keys: one tile at a time while held
    if (!st.path.length && st.keys.size) {
      const [dx, dy] = KEYS[[...st.keys].pop()];
      const n = { x: st.at.x + dx, y: st.at.y + dy };
      st.face = facing(st.at, n);
      if (n.x >= 0 && n.y >= 0 && n.x < st.room.w && n.y < st.room.h && !st.block.has(`${n.x},${n.y}`)) { st.path = [n]; st.goal = null; }
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

  // ---------- drawing ----------
  function draw() {
    const life = getLife();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.setTransform(st.cam.s, 0, 0, st.cam.s, st.cam.x, st.cam.y);
    const lights = gearById(life.equipped.lights)?.tier || 0;
    drawRoom(ctx, st.room, life.home, st.t, lights);
    const name = djName();
    for (const it of st.items.filter((i) => i.wall && i.kind !== 'led')) drawWallThing(ctx, it, st.t, name, st.room);
    // hover
    const hov = st.mouse && tileAt(st.mouse.x, st.mouse.y);
    const hovThing = hov && thingAt(hov);
    if (hovThing) drawFootprint(ctx, hovThing);
    else if (hov && hov.x >= 0 && hov.y >= 0 && hov.x < st.room.w && hov.y < st.room.h && !st.block.has(`${hov.x},${hov.y}`)) drawHover(ctx, hov.x, hov.y, false);
    if (st.near && !hovThing) drawFootprint(ctx, st.near);
    cv.style.cursor = hovThing ? 'pointer' : 'default';
    // floor things and you, back to front
    const you = { you: true, d: st.pos.x + st.pos.y + 1.01 };
    const list = [...st.items.filter((i) => !i.wall && !KINDS[i.kind].hang).map((i) => ({ it: i, d: i.x + i.y + i.w + i.h - 1 })), you];
    list.sort((a, b) => a.d - b.d);
    for (const x of list) {
      if (x.you) drawDJ(ctx, st.pos.x + 0.5, st.pos.y + 0.5, st.face, st.walk, { outfit: life.equipped.outfit, headphones: gearById(life.equipped.headphones)?.tier || 0 });
      else drawThing(ctx, x.it, st.t, name);
    }
    // things hanging from the ceiling and lights, on top
    for (const it of st.items.filter((i) => KINDS[i.kind].hang)) drawThing(ctx, it, st.t, name, st.room);
    for (const it of st.items.filter((i) => i.kind === 'led')) drawWallThing(ctx, it, st.t, name, st.room);
  }

  function tick(now) {
    if (!st.open) return;
    const dt = Math.min(0.05, (now - st.last) / 1000); st.last = now; st.t += dt;
    step(dt);
    // the prompt: what you're standing next to
    const near = st.path.length ? null : st.items.find((i) => i.use && nextTo(st.at, i)) || null;
    if (near !== st.near) {
      st.near = near;
      W('prompt').classList.toggle('hidden', !near);
      if (near) W('say').textContent = near.say;
    }
    draw();
    st.raf = requestAnimationFrame(tick);
  }

  // ---------- input ----------
  cv.addEventListener('pointermove', (e) => { const r = cv.getBoundingClientRect(); st.mouse = { x: e.clientX - r.left, y: e.clientY - r.top }; });
  cv.addEventListener('pointerleave', () => { st.mouse = null; });
  cv.addEventListener('click', (e) => {
    const r = cv.getBoundingClientRect(), p = tileAt(e.clientX - r.left, e.clientY - r.top);
    const it = thingAt(p);
    if (it) return goUse(it);
    if (p.x >= 0 && p.y >= 0 && p.x < st.room.w && p.y < st.room.h) walkTo({ x: p.x, y: p.y });
  });
  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-wa]'); if (!b) return;
    if (b.dataset.wa === 'close') return close();
    use(b.dataset.wa);
  });
  el.querySelector('[data-w="prompt"]').addEventListener('click', () => { if (st.near) doUse(st.near); });
  const onKey = (e) => {
    if (!st.open || e.target.closest?.('input, textarea')) return;
    if (document.querySelector('.dl-layer:not(.hidden)')) return; // the gig board or shop is open on top
    if (e.type === 'keyup') { st.keys.delete(e.code); return; }
    if (e.code === 'Escape') { e.preventDefault(); e.stopPropagation(); return close(); }
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    e.stopPropagation(); // while you're in your room, keys move you, not the decks
    if (KEYS[e.code]) { e.preventDefault(); e.stopPropagation(); st.keys.delete(e.code); st.keys.add(e.code); st.path = st.path.slice(0, 1); st.goal = null; return; }
    if ((e.code === 'KeyE' || e.code === 'Space' || e.code === 'Enter') && st.near) { e.preventDefault(); e.stopPropagation(); doUse(st.near); }
  };
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('keyup', onKey, true);
  window.addEventListener('blur', () => st.keys.clear());

  return {
    open, close, refresh,
    isOpen: () => st.open,
    destroy() { close(true); ro.disconnect(); window.removeEventListener('keydown', onKey, true); window.removeEventListener('keyup', onKey, true); el.remove(); },
  };
}
