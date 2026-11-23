// DJ Life: drawing the town at night and the inside of venues. Shapes only, like sprites.js; your own PNGs in art/
// replace them (building-<id>, tree, lamp, car-<id>, person).
import { toScreen, TILE_W } from './iso.js';
import { box, art } from './sprites.js';
import { groundAt } from './town.js';

const pt = (x, y, z = 0) => toScreen(x, y, z);
function poly(ctx, pts, fill, stroke, lw = 1) {
  ctx.beginPath();
  pts.forEach((p, i) => (i ? ctx.lineTo(p.sx, p.sy) : ctx.moveTo(p.sx, p.sy)));
  ctx.closePath();
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.stroke(); }
}
const hash = (a, b, c = 0) => { let h = (a * 374761393 + b * 668265263 + c * 2147483647) | 0; h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
/** A picture drawn so its bottom middle sits on the front corner of the space (see art/README.md). */
function drawArt(ctx, img, it) {
  const wide = ((it.w + it.h) * TILE_W) / 2, left = pt(it.x, it.y + it.h), right = pt(it.x + it.w, it.y), front = pt(it.x + it.w, it.y + it.h);
  const hgt = (img.height / img.width) * wide;
  ctx.drawImage(img, (left.sx + right.sx) / 2 - wide / 2, front.sy - hgt, wide, hgt);
}

// ---------- the ground ----------
const GROUND = { road: ['#1b1a28', '#1d1c2b'], path: ['#3a3550', '#363149'], grass: ['#183126', '#1a3529'] };
export function drawGround(ctx, town, view) {
  for (let x = 0; x < town.w; x++) for (let y = 0; y < town.h; y++) {
    const c = pt(x + 0.5, y + 0.5);
    if (view && (c.sx < view.x0 - 64 || c.sx > view.x1 + 64 || c.sy < view.y0 - 64 || c.sy > view.y1 + 64)) continue;
    const g = groundAt(x, y);
    poly(ctx, [pt(x, y), pt(x + 1, y), pt(x + 1, y + 1), pt(x, y + 1)], GROUND[g][(x + y) % 2]);
  }
  // lane markings down the middle of each road
  ctx.save(); ctx.strokeStyle = 'rgba(250,204,21,.5)'; ctx.lineWidth = 2; ctx.setLineDash([10, 12]);
  for (const y of [11, 25]) { const a = pt(0, y), b = pt(town.w, y); ctx.beginPath(); ctx.moveTo(a.sx, a.sy); ctx.lineTo(b.sx, b.sy); ctx.stroke(); }
  for (const x of [12, 23]) { const a = pt(x, 0), b = pt(x, town.h); ctx.beginPath(); ctx.moveTo(a.sx, a.sy); ctx.lineTo(b.sx, b.sy); ctx.stroke(); }
  ctx.restore();
}

// ---------- buildings ----------
// how your home looks from the street, by where you live
const HOME_LOOK = {
  parents: { tall: 58, wall: '#8a6a55', roof: '#5b3b2e' },
  flat: { tall: 92, wall: '#5b6b8a', roof: '#3b4560' },
  studio: { tall: 92, wall: '#6b5b8a', roof: '#45395c' },
  loft: { tall: 88, wall: '#7c4536', roof: '#4a2a22' },
  house: { tall: 74, wall: '#e8e1d0', roof: '#3b3b4a' },
  penthouse: { tall: 170, wall: '#2b4a66', roof: '#1d3346', glass: true },
  mansion: { tall: 78, wall: '#f4efe6', roof: '#2b2b38', gold: true },
};
const LOOK = {
  shop: { wall: '#3a3352', roof: '#262038' },
  bar: { wall: '#5a3b2a', roof: '#33221a' },
  house: { wall: '#6b4f6a', roof: '#3f2d3f' },
  showroom: { wall: '#2f3346', roof: '#1f2232', glass: true },
  club: { wall: '#2a2238', roof: '#1a1526' },
  arena: { wall: '#28324a', roof: '#1a2134' },
};

/** A patch on a building's front-left face (along x at y + h) or front-right face (along y at x + w). */
function face(ctx, b, side, u0, u1, z0, z1, fill) {
  const p = side === 'l'
    ? [pt(b.x + u0, b.y + b.h, z0), pt(b.x + u1, b.y + b.h, z0), pt(b.x + u1, b.y + b.h, z1), pt(b.x + u0, b.y + b.h, z1)]
    : [pt(b.x + b.w, b.y + u0, z0), pt(b.x + b.w, b.y + u1, z0), pt(b.x + b.w, b.y + u1, z1), pt(b.x + b.w, b.y + u0, z1)];
  poly(ctx, p, fill);
}

/**
 * One building. b: from townLayout (with homeId for your home). mark: 'gig' (your gig is here tonight), 'offer'
 * (they've got gigs for you this week) or null. t: seconds.
 */
export function drawBuilding(ctx, b, t, mark) {
  const img = art(`building-${b.id}`);
  if (img) { drawArt(ctx, img, b); return drawMark(ctx, b, t, mark); }
  const home = b.id === 'home' ? HOME_LOOK[b.homeId] || HOME_LOOK.parents : null;
  const look = home || LOOK[b.look] || LOOK.shop;
  const tall = home ? home.tall : b.tall;
  box(ctx, b.x, b.y, b.w, b.h, 0, tall, look.roof, { left: look.wall, right: shadeHex(look.wall, -0.3) });
  // windows: rows of lit and dark squares on both front faces
  const glass = look.glass;
  for (const [side, len] of [['l', b.w], ['r', b.h]]) {
    if (glass) { face(ctx, b, side, 0.08, len - 0.08, 6, tall - 6, 'rgba(103,232,249,.18)'); }
    for (let z = 34; z < tall - 14; z += 22) {
      for (let u = 0.35; u < len - 0.3; u += 0.8) {
        if (side === 'l' && Math.abs(b.x + u - (b.door + 0.5)) < 0.6 && z < 50) continue; // not over the door
        const on = hash(b.x * 7 + u * 10, z, side === 'l' ? 1 : 2) > 0.35;
        face(ctx, b, side, u, u + 0.4, z, z + 12, on ? (glass ? 'rgba(250,240,200,.75)' : '#f6d58a') : 'rgba(0,0,0,.35)');
      }
    }
  }
  // the door
  const du = b.door - b.x;
  face(ctx, b, 'l', du + 0.22, du + 0.78, 0, 30, '#120e1d');
  face(ctx, b, 'l', du + 0.28, du + 0.72, 2, 27, mark ? `rgba(244,114,182,${0.5 + 0.3 * Math.sin(t * 4)})` : 'rgba(250,204,21,.35)');
  // extras by kind of building
  if (b.look === 'bar') { face(ctx, b, 'l', du - 0.4, du + 1.4, 30, 36, '#b45309'); }
  if (b.look === 'club' || b.look === 'arena') {
    const hue = (t * 50) % 360;
    ctx.save(); ctx.shadowBlur = 12; ctx.shadowColor = ctx.strokeStyle = `hsl(${hue},90%,65%)`; ctx.lineWidth = 3;
    const a = pt(b.x, b.y + b.h, tall), c = pt(b.x + b.w, b.y + b.h, tall), d = pt(b.x + b.w, b.y, tall);
    ctx.beginPath(); ctx.moveTo(a.sx, a.sy); ctx.lineTo(c.sx, c.sy); ctx.lineTo(d.sx, d.sy); ctx.stroke();
    ctx.restore();
  }
  if (b.look === 'arena') { // the dome on top
    const c = pt(b.x + b.w / 2, b.y + b.h / 2, tall);
    ctx.beginPath(); ctx.ellipse(c.sx, c.sy - 6, b.w * 20, b.w * 11, 0, Math.PI, 0); ctx.fillStyle = '#334155'; ctx.fill();
    ctx.strokeStyle = 'rgba(34,211,238,.6)'; ctx.lineWidth = 2; ctx.stroke();
  }
  if (b.look === 'showroom') drawCar(ctx, { x: b.x + 1.2, y: b.y + b.h - 2.4, body: '#facc15' }, t, true);
  if (b.look === 'house' || (home && !home.glass && b.homeId !== 'flat' && b.homeId !== 'studio')) { // a pitched roof
    const r = home?.roof || look.roof;
    poly(ctx, [pt(b.x, b.y + b.h, tall), pt(b.x + b.w, b.y + b.h, tall), pt(b.x + b.w, b.y + b.h / 2, tall + 26), pt(b.x, b.y + b.h / 2, tall + 26)], shadeHex(r, 0.1));
    poly(ctx, [pt(b.x + b.w, b.y + b.h, tall), pt(b.x + b.w, b.y, tall), pt(b.x + b.w, b.y + b.h / 2, tall + 26)], shadeHex(r, -0.2));
  }
  if (home?.gold) face(ctx, b, 'l', 0, b.w, tall - 6, tall, '#d4a64a');
  // the sign
  const color = b.color || '#f4f0ff';
  const s = pt(b.door + 0.5, b.y + b.h, tall - 14);
  ctx.save();
  ctx.font = '800 12px system-ui, sans-serif';
  const w = ctx.measureText(b.name).width + 16;
  ctx.fillStyle = 'rgba(11,8,22,.88)'; ctx.shadowColor = color; ctx.shadowBlur = 10;
  roundRect(ctx, s.sx - w / 2, s.sy - 10, w, 20, 6); ctx.fill();
  ctx.shadowBlur = 0; ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.stroke();
  ctx.fillStyle = color; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(b.name, s.sx, s.sy + 0.5);
  ctx.restore();
  drawMark(ctx, b, t, mark);
}

/** A bouncing marker over a building: your gig tonight, or gigs on offer. */
function drawMark(ctx, b, t, mark) {
  if (!mark) return;
  const tall = b.id === 'home' ? (HOME_LOOK[b.homeId] || HOME_LOOK.parents).tall : b.tall;
  const p = pt(b.x + b.w / 2, b.y + b.h / 2, tall + 50 + Math.sin(t * 3) * 6);
  const col = mark === 'gig' ? '#f472b6' : '#4ade80', text = mark === 'gig' ? 'YOUR GIG' : mark === 'home' ? 'HOME' : 'GIGS';
  ctx.save();
  ctx.font = '900 11px system-ui, sans-serif';
  const w = ctx.measureText(text).width + 14;
  ctx.fillStyle = col; ctx.shadowColor = col; ctx.shadowBlur = 14;
  roundRect(ctx, p.sx - w / 2, p.sy - 11, w, 22, 11); ctx.fill();
  ctx.beginPath(); ctx.moveTo(p.sx - 6, p.sy + 10); ctx.lineTo(p.sx + 6, p.sy + 10); ctx.lineTo(p.sx, p.sy + 18); ctx.fill();
  ctx.shadowBlur = 0; ctx.fillStyle = '#0b0816'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, p.sx, p.sy + 0.5);
  ctx.restore();
}

// ---------- trees, lamps, cars ----------
export function drawTree(ctx, it, t) {
  const img = art('tree'); if (img) return drawArt(ctx, img, it);
  box(ctx, it.x + 0.42, it.y + 0.42, 0.16, 0.16, 0, 22, '#4a3626');
  const c = pt(it.x + 0.5, it.y + 0.5, 40);
  for (const [dx, dy, r, col] of [[0, 4, 18, '#14532d'], [-9, -4, 13, '#166534'], [9, -6, 12, '#15803d'], [0, -14, 11, '#1c8a44']]) {
    ctx.beginPath(); ctx.arc(c.sx + dx + Math.sin(t * 0.8 + it.x) * 0.8, c.sy + dy, r, 0, Math.PI * 2); ctx.fillStyle = col; ctx.fill();
  }
}
export function drawLampGlow(ctx, it) {
  const c = pt(it.x + 0.5, it.y + 0.5);
  const g = ctx.createRadialGradient(c.sx, c.sy, 4, c.sx, c.sy, 70);
  g.addColorStop(0, 'rgba(250,204,21,.22)'); g.addColorStop(1, 'rgba(250,204,21,0)');
  ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(c.sx, c.sy, 70, 36, 0, 0, Math.PI * 2); ctx.fill();
}
export function drawLamp(ctx, it) {
  const img = art('lamp'); if (img) return drawArt(ctx, img, it);
  const b = pt(it.x + 0.5, it.y + 0.5), top = pt(it.x + 0.5, it.y + 0.5, 62);
  ctx.strokeStyle = '#4b4560'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(b.sx, b.sy); ctx.lineTo(top.sx, top.sy); ctx.stroke();
  ctx.save(); ctx.shadowColor = '#facc15'; ctx.shadowBlur = 16; ctx.fillStyle = '#fde68a';
  ctx.beginPath(); ctx.arc(top.sx, top.sy, 5, 0, Math.PI * 2); ctx.fill(); ctx.restore();
}
/** A car on two tiles, running along y (w 1, h 2) or along x (w 2, h 1). parked: sitting in a showroom. */
export function drawCar(ctx, it, t, parked = false) {
  const along = (it.w || 1) > (it.h || 2) ? 'x' : 'y';
  const img = art(it.car || 'car'); if (img && !parked) return drawArt(ctx, img, { ...it, w: it.w || 1, h: it.h || 2 });
  const { x, y } = it, body = it.body || '#facc15';
  // (u, v): u along the car, v across it, both 0..1, mapped onto the right tiles
  const at = (u, v, z) => (along === 'y' ? pt(x + v, y + u * 2, z) : pt(x + u * 2, y + v, z));
  const bx = (u0, u1, v0, v1, z0, tall, color, o) => (along === 'y' ? box(ctx, x + v0, y + u0 * 2, v1 - v0, (u1 - u0) * 2, z0, tall, color, o) : box(ctx, x + u0 * 2, y + v0, (u1 - u0) * 2, v1 - v0, z0, tall, color, o));
  const sh = at(0.5, 0.5, 0);
  ctx.beginPath(); ctx.ellipse(sh.sx, sh.sy, 34, 16, 0, 0, Math.PI * 2); ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fill();
  ctx.fillStyle = '#0b0816';
  for (const [u, v] of [[0.22, 0.12], [0.78, 0.12], [0.22, 0.88], [0.78, 0.88]]) { const p = at(u, v, 5); ctx.beginPath(); ctx.arc(p.sx, p.sy, 4, 0, Math.PI * 2); ctx.fill(); }
  bx(0.05, 0.95, 0.12, 0.88, 6, 12, body);
  bx(0.28, 0.72, 0.2, 0.8, 18, 10, '#1e293b', { top: shadeHex(body, -0.1) });
  ctx.fillStyle = '#fef9c3';
  for (const v of [0.3, 0.7]) { const p = at(0.95, v, 12); ctx.beginPath(); ctx.arc(p.sx, p.sy, 2.5, 0, Math.PI * 2); ctx.fill(); }
}

// ---------- people (the crowd at venues) ----------
/** Someone dancing on tile (x, y). k: how hard they're dancing, 0..1. seed: picks their colours and moves. */
export function drawPerson(ctx, x, y, t, k, seed) {
  const img = art('person');
  const p = pt(x, y);
  const r = (n) => hash(seed, n);
  const bounce = Math.abs(Math.sin(t * (6 + r(1) * 2) + r(2) * 6)) * (2 + 6 * k);
  ctx.beginPath(); ctx.ellipse(p.sx, p.sy, 10, 5, 0, 0, Math.PI * 2); ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fill();
  ctx.save(); ctx.translate(p.sx, p.sy - bounce);
  if (r(9) < 0.5) ctx.scale(-1, 1);
  if (img) { const h = 58, w = (img.width / img.height) * h; ctx.drawImage(img, -w / 2, -h, w, h); ctx.restore(); return; }
  const top = `hsl(${Math.floor(r(3) * 360)},65%,${45 + r(4) * 20}%)`, skin = ['#f2c7a5', '#c68e65', '#8d5a3b', '#e9b48a'][Math.floor(r(5) * 4)];
  ctx.lineCap = 'round'; ctx.lineWidth = 4; ctx.strokeStyle = '#1e293b';
  ctx.beginPath(); ctx.moveTo(-3, -15); ctx.lineTo(-3, -1); ctx.moveTo(3, -15); ctx.lineTo(3, -1); ctx.stroke();
  ctx.fillStyle = top; ctx.beginPath(); ctx.roundRect?.(-7, -33, 14, 20, 5); if (!ctx.roundRect) ctx.rect(-7, -33, 14, 20); ctx.fill();
  // arms: up in the air when the place is going off
  const up = k > 0.6 && r(6) < k;
  const sw = Math.sin(t * 6 + r(7) * 6) * 4;
  ctx.strokeStyle = top; ctx.lineWidth = 4;
  ctx.beginPath();
  if (up) { ctx.moveTo(-6, -30); ctx.lineTo(-10 + sw, -46); ctx.moveTo(6, -30); ctx.lineTo(10 - sw, -46); }
  else { ctx.moveTo(-6, -30); ctx.lineTo(-9, -18 + sw); ctx.moveTo(6, -30); ctx.lineTo(9, -18 - sw); }
  ctx.stroke();
  ctx.beginPath(); ctx.arc(0, -40, 7, 0, Math.PI * 2); ctx.fillStyle = skin; ctx.fill();
  ctx.beginPath(); ctx.arc(0, -42, 7, Math.PI, Math.PI * 2); ctx.fillStyle = ['#2b1d14', '#facc15', '#0b0816', '#b45309', '#f472b6'][Math.floor(r(8) * 5)]; ctx.fill();
  ctx.restore();
}

// ---------- helpers ----------
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
function shadeHex(hex, k) {
  const n = parseInt(hex.slice(1), 16);
  const f = (c) => Math.max(0, Math.min(255, Math.round(c + (k < 0 ? c * k : (255 - c) * k))));
  return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
}
