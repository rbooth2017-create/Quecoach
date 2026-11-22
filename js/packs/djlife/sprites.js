// DJ Life world: drawing the room, everything in it, and you. Everything starts as simple shapes drawn in code.
// Drop a picture into js/packs/djlife/art/ and list it in art/art.js, and it's used instead (see art/README.md).
import { toScreen, TILE_W, TILE_H, KINDS } from './iso.js';
import { ART } from './art/art.js';

// ---------- pictures from the art folder ----------
const images = {};
for (const name of ART) {
  const img = new Image();
  img.src = new URL(`./art/${name}.png`, import.meta.url).href;
  img.onload = () => { images[name] = img; };
}
/** A drawn picture for this name, if one has loaded. */
export const art = (name) => images[name] || null;

// ---------- colours for each home ----------
export const PALETTE = {
  parents: { floorA: '#3b2f4f', floorB: '#36294a', wall: '#2a2045', wallTop: '#3d3063', trim: '#4b3a75' },
  flat: { floorA: '#4a3a2e', floorB: '#44352a', wall: '#24324a', wallTop: '#33476a', trim: '#41598a' },
  studio: { floorA: '#2c2a38', floorB: '#282633', wall: '#2d1f45', wallTop: '#432e66', trim: '#5b3f8a' },
  loft: { floorA: '#3a3633', floorB: '#34302d', wall: '#4a2a22', wallTop: '#6a3b30', trim: '#7c4536' },
  house: { floorA: '#2f2a24', floorB: '#2a2520', wall: '#1d2b3a', wallTop: '#2b3f55', trim: '#d4a64a' },
};
export const WALL_H = 96;

// ---------- shapes ----------
const pt = (x, y, z = 0) => toScreen(x, y, z);
function poly(ctx, pts, fill, stroke) {
  ctx.beginPath();
  pts.forEach((p, i) => (i ? ctx.lineTo(p.sx, p.sy) : ctx.moveTo(p.sx, p.sy)));
  ctx.closePath();
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.stroke(); }
}
/** A box standing on tiles (x, y) to (x + w, y + h), from z0 up `tall` pixels. Shaded like light from the left. */
export function box(ctx, x, y, w, h, z0, tall, color, { top, left, right } = {}) {
  const z1 = z0 + tall;
  poly(ctx, [pt(x, y + h, z0), pt(x + w, y + h, z0), pt(x + w, y + h, z1), pt(x, y + h, z1)], left || shade(color, -0.18));
  poly(ctx, [pt(x + w, y, z0), pt(x + w, y + h, z0), pt(x + w, y + h, z1), pt(x + w, y, z1)], right || shade(color, -0.34));
  poly(ctx, [pt(x, y, z1), pt(x + w, y, z1), pt(x + w, y + h, z1), pt(x, y + h, z1)], top || color);
}
/** A flat diamond on the floor (or any height). */
const tile = (ctx, x, y, w, h, z, fill) => poly(ctx, [pt(x, y, z), pt(x + w, y, z), pt(x + w, y + h, z), pt(x, y + h, z)], fill);
/** A shape painted on a back wall. 'left' wall: along y = 0 from x = a to b. 'right' wall: along x = 0 from y = a to b. */
function onWall(ctx, wall, a, b, z0, z1, fill) {
  const p = wall === 'left' ? [pt(a, 0, z0), pt(b, 0, z0), pt(b, 0, z1), pt(a, 0, z1)] : [pt(0, a, z0), pt(0, b, z0), pt(0, b, z1), pt(0, a, z1)];
  poly(ctx, p, fill);
}
function shade(hex, k) {
  const n = parseInt(hex.slice(1), 16);
  const f = (c) => Math.max(0, Math.min(255, Math.round(c + (k < 0 ? c * k : (255 - c) * k))));
  return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
}

// ---------- the room ----------
export function drawRoom(ctx, room, home, t, lights) {
  const c = PALETTE[home] || PALETTE.parents;
  // walls
  poly(ctx, [pt(0, 0), pt(room.w, 0), pt(room.w, 0, WALL_H), pt(0, 0, WALL_H)], c.wall);
  poly(ctx, [pt(0, 0), pt(0, room.h), pt(0, room.h, WALL_H), pt(0, 0, WALL_H)], shade(c.wall, 0.08));
  poly(ctx, [pt(0, 0, WALL_H), pt(room.w, 0, WALL_H), pt(room.w, 0, WALL_H + 6), pt(0, 0, WALL_H + 6)], c.wallTop);
  poly(ctx, [pt(0, 0, WALL_H), pt(0, room.h, WALL_H), pt(0, room.h, WALL_H + 6), pt(0, 0, WALL_H + 6)], c.wallTop);
  if (home === 'loft') for (let z = 12; z < WALL_H; z += 14) {
    ctx.strokeStyle = 'rgba(0,0,0,.18)'; ctx.lineWidth = 1;
    for (const [a, b] of [[pt(0, 0, z), pt(room.w, 0, z)], [pt(0, 0, z), pt(0, room.h, z)]]) { ctx.beginPath(); ctx.moveTo(a.sx, a.sy); ctx.lineTo(b.sx, b.sy); ctx.stroke(); }
  }
  // skirting
  poly(ctx, [pt(0, 0), pt(room.w, 0), pt(room.w, 0, 6), pt(0, 0, 6)], c.trim);
  poly(ctx, [pt(0, 0), pt(0, room.h), pt(0, room.h, 6), pt(0, 0, 6)], c.trim);
  // floor
  for (let x = 0; x < room.w; x++) for (let y = 0; y < room.h; y++) tile(ctx, x, y, 1, 1, 0, (x + y) % 2 ? c.floorA : c.floorB);
  // a rug in the middle
  tile(ctx, room.w / 2 - 1.5, room.h / 2 - 1, 3, 2, 0.5, 'rgba(244,114,182,.16)');
  // coloured light on the floor when your lights are on
  if (lights >= 1) {
    const hue = (t * 40) % 360;
    tile(ctx, 0, 0, room.w, room.h, 0.6, `hsla(${hue},80%,60%,${0.04 + lights * 0.02})`);
  }
}

/** Light the tile under the mouse, and a soft ring round something you can use. */
export function drawHover(ctx, x, y, usable) {
  tile(ctx, x, y, 1, 1, 1, usable ? 'rgba(74,222,128,.28)' : 'rgba(255,255,255,.12)');
}
export function drawFootprint(ctx, it) {
  if (it.wall || KINDS[it.kind].hang) return;
  tile(ctx, it.x - 0.08, it.y - 0.08, it.w + 0.16, it.h + 0.16, 1, 'rgba(74,222,128,.22)');
}

// ---------- things ----------
/** Draw one thing. t: seconds (for anything that moves). name: your DJ name, for the neon sign. */
export function drawThing(ctx, it, t, name, room) {
  const img = art(`${it.kind}${it.tier ? `-${it.tier}` : ''}`) || art(it.kind);
  if (img && !it.wall) return drawArt(ctx, img, it);
  const { x, y, w, h } = it;
  switch (it.kind) {
    case 'bed':
      box(ctx, x, y, w, h, 0, 14, '#5b4a7a');
      box(ctx, x + 0.1, y + 0.1, w - 0.2, h - 0.2, 14, 6, '#7c5cc4', { top: '#8b6dd6' });
      box(ctx, x + 0.25, y + 0.15, w - 0.5, 0.7, 20, 6, '#e9e4ff');
      return;
    case 'booth': {
      box(ctx, x, y, w, h, 0, 26, '#1f1a33', { top: '#2c2449' });
      const col = ['#6b7280', '#22d3ee', '#a78bfa', '#f472b6'][it.tier || 0];
      box(ctx, x + 0.15, y + 0.15, w - 0.3, h - 0.3, 26, 4, '#111', { top: '#1b1b22' });
      for (const cx of [x + 0.55, x + w - 0.55]) {
        const c = pt(cx, y + h / 2, 31);
        ctx.save(); ctx.translate(c.sx, c.sy); ctx.scale(1, 0.5);
        ctx.beginPath(); ctx.arc(0, 0, 12, 0, Math.PI * 2); ctx.fillStyle = '#2a2a33'; ctx.fill();
        ctx.lineWidth = 2; ctx.strokeStyle = col; ctx.shadowColor = col; ctx.shadowBlur = 8; ctx.stroke();
        ctx.rotate(t * 3); ctx.fillStyle = col; ctx.fillRect(-1, -11, 2, 6);
        ctx.restore();
      }
      return;
    }
    case 'laptop': {
      box(ctx, x + 0.1, y + 0.1, 0.8, 0.8, 0, 22, '#3a2f55');
      box(ctx, x + 0.25, y + 0.3, 0.5, 0.4, 22, 2, '#9ca3af');
      const a = pt(x + 0.25, y + 0.3, 24), b = pt(x + 0.75, y + 0.3, 24);
      poly(ctx, [a, b, { sx: b.sx, sy: b.sy - 18 }, { sx: a.sx, sy: a.sy - 18 }], '#0b0816');
      poly(ctx, [{ sx: a.sx + 2, sy: a.sy - 2 }, { sx: b.sx - 2, sy: b.sy - 2 }, { sx: b.sx - 2, sy: b.sy - 16 }, { sx: a.sx + 2, sy: a.sy - 16 }], `rgba(34,211,238,${0.6 + 0.2 * Math.sin(t * 2)})`);
      return;
    }
    case 'wardrobe':
      box(ctx, x + 0.05, y + 0.05, 0.9, 0.9, 0, 72, '#4a3626', { top: '#5c4430' });
      poly(ctx, [pt(x + 0.5, y + 0.95, 6), pt(x + 0.5, y + 0.95, 66)], null, '#2a1d14');
      ctx.beginPath(); const k = pt(x + 0.4, y + 0.95, 36); ctx.arc(k.sx, k.sy, 2, 0, Math.PI * 2); ctx.fillStyle = '#d4a64a'; ctx.fill();
      return;
    case 'speaker': {
      const tall = it.tier >= 2 ? 56 : 40;
      box(ctx, x + 0.15, y + 0.15, 0.7, 0.7, 0, tall, '#1a1330');
      for (const [zz, r] of [[tall * 0.3, 7], [tall * 0.72, 4]]) {
        const c = pt(x + 0.5, y + 0.85, zz);
        ctx.beginPath(); ctx.ellipse(c.sx, c.sy, r, r * 1.1, 0, 0, Math.PI * 2); ctx.fillStyle = '#0b0816'; ctx.fill();
        ctx.strokeStyle = '#3d3063'; ctx.lineWidth = 2; ctx.stroke();
      }
      return;
    }
    case 'plant': {
      box(ctx, x + 0.3, y + 0.3, 0.4, 0.4, 0, 16, '#7c4536');
      const c = pt(x + 0.5, y + 0.5, 34);
      for (const [dx, dy, r, col] of [[-8, 2, 11, '#166534'], [8, 0, 10, '#15803d'], [0, -10, 12, '#22a04b'], [0, 4, 9, '#14532d']]) {
        ctx.beginPath(); ctx.arc(c.sx + dx, c.sy + dy + Math.sin(t + dx) * 0.6, r, 0, Math.PI * 2); ctx.fillStyle = col; ctx.fill();
      }
      return;
    }
    case 'shelf':
      box(ctx, x + 0.05, y + 0.2, w - 0.1, 0.6, 0, 40, '#3a2a1e');
      for (let i = 0; i < 9; i++) {
        const a = pt(x + 0.15 + i * 0.19, y + 0.8, 4), hue = (i * 47) % 360;
        ctx.fillStyle = `hsl(${hue},55%,45%)`; ctx.fillRect(a.sx - 2, a.sy - 30, 4, 26);
      }
      return;
    case 'sofa':
      box(ctx, x, y + 0.1, w, 0.8, 0, 14, '#3a1631');
      box(ctx, x, y + 0.1, w, 0.25, 14, 16, '#4a1d3f');
      return;
    case 'disco': {
      const c = pt(x + 0.5, y + 0.5, WALL_H + 10), top = pt(x + 0.5, y + 0.5, WALL_H + 50);
      ctx.strokeStyle = '#9ca3af'; ctx.beginPath(); ctx.moveTo(top.sx, top.sy); ctx.lineTo(c.sx, c.sy - 12); ctx.stroke();
      const g = ctx.createRadialGradient(c.sx - 4, c.sy - 4, 2, c.sx, c.sy, 13);
      g.addColorStop(0, '#fff'); g.addColorStop(1, '#64748b');
      ctx.beginPath(); ctx.arc(c.sx, c.sy, 12, 0, Math.PI * 2); ctx.fillStyle = g; ctx.fill();
      for (let i = 0; i < 6; i++) { const a = t * 1.5 + i; ctx.fillStyle = 'rgba(255,255,255,.8)'; ctx.fillRect(c.sx + Math.cos(a) * 8 - 1, c.sy + Math.sin(a) * 8 - 1, 2, 2); }
      return;
    }
    case 'heads': {
      for (const [dx, hue] of [[-1.5, 190], [1.5, 330]]) {
        const c = pt(x + dx, y - 1, WALL_H + 30), sw = Math.sin(t * 1.2 + dx) * 60;
        ctx.save();
        ctx.fillStyle = `hsla(${hue},90%,70%,.13)`;
        ctx.beginPath(); ctx.moveTo(c.sx, c.sy); ctx.lineTo(c.sx + sw - 40, c.sy + 230); ctx.lineTo(c.sx + sw + 40, c.sy + 230); ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#111'; ctx.fillRect(c.sx - 6, c.sy - 6, 12, 10);
        ctx.restore();
      }
      if (it.tier >= 3 && room) { // the laser show: a fan of green beams from the back corner, landing on the floor
        const o = pt(0, 0, WALL_H - 2);
        ctx.save(); ctx.strokeStyle = 'rgba(74,222,128,.55)'; ctx.shadowColor = '#4ade80'; ctx.shadowBlur = 6; ctx.lineWidth = 1.2;
        for (let i = 0; i < 7; i++) {
          const u = Math.max(0.05, Math.min(1.95, 0.25 + i * 0.25 + Math.sin(t * 1.7) * 0.2)); // along the front edges
          const e = u < 1 ? pt(room.w, room.h * u) : pt(room.w * (2 - u), room.h);
          ctx.beginPath(); ctx.moveTo(o.sx, o.sy); ctx.lineTo(e.sx, e.sy); ctx.stroke();
        }
        ctx.restore();
      }
      return;
    }
    default:
  }
}

/** Things on the back walls: the door, posters, the neon sign, LED strips. */
export function drawWallThing(ctx, it, t, name, room) {
  const img = art(it.kind);
  switch (it.kind) {
    case 'door':
      onWall(ctx, it.wall, it.y + 0.1, it.y + 0.9, 0, 72, '#4a3626');
      onWall(ctx, it.wall, it.y + 0.16, it.y + 0.84, 4, 68, '#5c4430');
      { const k = pt(0, it.y + 0.75, 34); ctx.beginPath(); ctx.arc(k.sx, k.sy, 2.5, 0, Math.PI * 2); ctx.fillStyle = '#d4a64a'; ctx.fill(); }
      return;
    case 'poster': {
      if (img) return drawWallArt(ctx, img, it, 36, 76);
      onWall(ctx, it.wall, it.x + 0.1, it.x + 0.9, 36, 78, '#f472b6');
      onWall(ctx, it.wall, it.x + 0.1, it.x + 0.9, 36, 56, '#7c3aed');
      onWall(ctx, it.wall, it.x + 0.2, it.x + 0.8, 62, 70, '#0b0816');
      return;
    }
    case 'neon': {
      // written from the front end of the wall towards the back, so it reads left to right
      const a = pt(0, it.y + 1.8, 62), b = pt(0, it.y + 0.2, 62);
      ctx.save(); ctx.translate(a.sx, a.sy); ctx.rotate(Math.atan2(b.sy - a.sy, b.sx - a.sx));
      ctx.font = 'italic 800 20px system-ui, sans-serif';
      ctx.shadowColor = '#f472b6'; ctx.shadowBlur = 12 + Math.sin(t * 4) * 3; ctx.fillStyle = '#f9a8d4';
      ctx.fillText((name || 'DJ').slice(0, 10), 0, 0);
      ctx.restore();
      return;
    }
    case 'led': {
      const hue = (t * 60) % 360;
      ctx.save(); ctx.shadowBlur = 14; ctx.lineWidth = 3;
      for (const [a, b, h2] of [[pt(0, 0, WALL_H - 4), pt(room.w, 0, WALL_H - 4), hue], [pt(0, 0, WALL_H - 4), pt(0, room.h, WALL_H - 4), hue + 120]]) {
        ctx.strokeStyle = ctx.shadowColor = `hsl(${h2 % 360},90%,65%)`;
        ctx.beginPath(); ctx.moveTo(a.sx, a.sy); ctx.lineTo(b.sx, b.sy); ctx.stroke();
      }
      ctx.restore();
      return;
    }
    default:
  }
}

function drawArt(ctx, img, it) {
  // the picture's bottom middle sits on the front corner of the thing's floor space; its width matches the space
  const front = pt(it.x + it.w, it.y + it.h), wide = ((it.w + it.h) * TILE_W) / 2;
  const left = pt(it.x, it.y + it.h), right = pt(it.x + it.w, it.y);
  const cx = (left.sx + right.sx) / 2, hgt = (img.height / img.width) * wide;
  ctx.drawImage(img, cx - wide / 2, front.sy - hgt, wide, hgt);
}
function drawWallArt(ctx, img, it, z0, z1) {
  const a = pt(it.x, 0, z1), b = pt(it.x + 1, 0, z0);
  ctx.drawImage(img, a.sx, a.sy, b.sx - a.sx, b.sy - a.sy + (z1 - z0) / 2);
}

// ---------- you ----------
const OUTFIT = { 'fit-hoodie': '#4b5563', 'fit-tee': '#f472b6', 'fit-stage': '#22d3ee' };
/**
 * Draw the DJ standing on fractional tile (x, y). face: 'se' | 'sw' | 'ne' | 'nw'. walk: 0..1 through a step
 * (or null standing still). look: { outfit, headphones (tier) }.
 */
export function drawDJ(ctx, x, y, face, walk, look) {
  const p = pt(x, y);
  const img = art('dj');
  // shadow
  ctx.beginPath(); ctx.ellipse(p.sx, p.sy, 13, 6, 0, 0, Math.PI * 2); ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fill();
  const bob = walk == null ? 0 : Math.abs(Math.sin(walk * Math.PI * 2)) * 2;
  ctx.save(); ctx.translate(p.sx, p.sy - bob);
  if (face === 'sw' || face === 'nw') ctx.scale(-1, 1); // drawn facing right; flip for left
  if (img) { const h = 70, w = (img.width / img.height) * h; ctx.drawImage(img, -w / 2, -h, w, h); ctx.restore(); return; }
  const back = face === 'ne' || face === 'nw';
  const swing = walk == null ? 0 : Math.sin(walk * Math.PI * 2) * 5;
  const body = OUTFIT[look.outfit] || '#4b5563';
  // legs
  ctx.lineCap = 'round'; ctx.lineWidth = 5; ctx.strokeStyle = '#1e293b';
  ctx.beginPath(); ctx.moveTo(-3, -18); ctx.lineTo(-3 + swing, -1); ctx.moveTo(4, -18); ctx.lineTo(4 - swing, -1); ctx.stroke();
  // body
  ctx.fillStyle = body; roundRect(ctx, -9, -40, 18, 24, 6); ctx.fill();
  if (look.outfit === 'fit-tee' && !back) { ctx.fillStyle = '#0b0816'; ctx.font = 'bold 7px system-ui'; ctx.fillText('DJ', -5, -26); }
  // arms
  ctx.strokeStyle = body; ctx.lineWidth = 5;
  ctx.beginPath(); ctx.moveTo(-8, -36); ctx.lineTo(-10 - swing * 0.6, -22); ctx.moveTo(8, -36); ctx.lineTo(10 + swing * 0.6, -22); ctx.stroke();
  // head
  ctx.beginPath(); ctx.arc(0, -49, 9, 0, Math.PI * 2); ctx.fillStyle = '#f2c7a5'; ctx.fill();
  ctx.beginPath(); ctx.arc(0, back ? -50 : -52, 9, Math.PI * (back ? 0 : 1), Math.PI * 2); ctx.fillStyle = '#2b1d14'; ctx.fill();
  if (back) { ctx.beginPath(); ctx.arc(0, -49, 9, 0, Math.PI * 2); ctx.fill(); }
  else { ctx.fillStyle = '#0b0816'; ctx.fillRect(3, -50, 2, 2.5); }
  // headphones
  if (look.headphones >= 1) {
    const col = ['#9ca3af', '#22d3ee', '#a78bfa', '#f472b6'][look.headphones];
    ctx.strokeStyle = col; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.arc(0, -50, 11, Math.PI * 1.05, Math.PI * 1.95); ctx.stroke();
    ctx.fillStyle = col; roundRect(ctx, back ? 7 : -12, -51, 5, 8, 2); ctx.fill();
  }
  ctx.restore();
}
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

export { TILE_H };
