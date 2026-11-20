// On-screen DJ controls for the Learn app: a jog wheel you spin with the mouse or a finger, and rotary dials.
import { angleDelta, jogBendFromSpeed, scrubSeconds, dialValue, dialAngle, TURNS_PER_SECOND } from './deckmath.js';

// ---------- jog wheel ----------
export const jogHTML = (side, tip) => `<div class="jog" data-jog="${side}" role="slider" aria-label="${side} jog wheel" tabindex="-1"><canvas></canvas>${tip ? `<span class="jog-tip">${tip}</span>` : ''}</div>`;

/**
 * Spin while playing = nudge (a short speed bend, like pushing a turntable's platter).
 * Turn while paused = move through the track. Scroll wheel works too.
 * getDeck() returns the audio.js Deck; onUse(kind) tells the page what happened: 'touch', 'jog' (nudge) or 'scrub'.
 */
export class JogWheel {
  constructor(el, getDeck, onUse = () => {}) {
    this.el = el; this.cv = el.querySelector('canvas'); this.getDeck = getDeck; this.onUse = onUse;
    this.touching = false; this.last = 0; this.lastT = 0; this.lastMove = 0; this.omega = 0; this.wheelUntil = 0;
    el.addEventListener('pointerdown', (e) => this.down(e));
    el.addEventListener('pointermove', (e) => this.move(e));
    el.addEventListener('pointerup', () => this.up());
    el.addEventListener('pointercancel', () => this.up());
    el.addEventListener('wheel', (e) => this.wheel(e), { passive: false });
  }
  angle(e) { const r = this.el.getBoundingClientRect(); return Math.atan2(e.clientX - (r.left + r.width / 2), -(e.clientY - (r.top + r.height / 2))); }
  down(e) {
    const d = this.getDeck(); if (!d.buffer) return;
    try { this.el.setPointerCapture(e.pointerId); } catch { /* pointer already gone */ }
    this.touching = true; this.last = this.angle(e); this.lastT = performance.now(); this.omega = 0;
    this.el.classList.add('touching'); this.onUse('touch');
  }
  move(e) {
    if (!this.touching) return;
    const d = this.getDeck(), now = performance.now(), a = this.angle(e);
    const da = angleDelta(this.last, a), dt = Math.max(0.008, (now - this.lastT) / 1000);
    this.last = a; this.lastT = now;
    if (d.playing) {
      this.omega = this.omega * 0.6 + (da / dt) * 0.4; // smooth out jittery pointer events
      d.setBend(jogBendFromSpeed(this.omega)); this.lastMove = now; this.onUse('jog');
    } else { d.seek(Math.max(0, Math.min(d.buffer.duration - 0.1, d.position() + scrubSeconds(da)))); this.onUse('scrub'); }
  }
  up() {
    if (!this.touching) return;
    this.touching = false; this.el.classList.remove('touching');
    this.getDeck().setBend(0);
  }
  wheel(e) {
    const d = this.getDeck(); if (!d.buffer) return;
    e.preventDefault();
    const dir = Math.sign(e.deltaY || e.deltaX);
    if (d.playing) { d.setBend(dir * 0.04); this.wheelUntil = performance.now() + 120; this.onUse('jog'); }
    else { d.seek(Math.max(0, d.position() + dir * 0.05)); this.onUse('scrub'); }
  }
  /** Call every frame: lets go of the bend when the hand stops moving, and draws the platter. */
  draw(colors, side) {
    const d = this.getDeck(), now = performance.now();
    if (this.touching && d.playing && now - this.lastMove > 90) { this.omega = 0; d.setBend(0); }
    if (!this.touching && this.wheelUntil && now > this.wheelUntil) { this.wheelUntil = 0; d.setBend(0); }
    const cv = this.cv, dpr = devicePixelRatio || 1, size = this.el.clientWidth;
    if (!size) return;
    if (cv.width !== Math.round(size * dpr)) { cv.width = cv.height = Math.round(size * dpr); }
    const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const c = size / 2, R = c - 3, col = colors[side];
    g.clearRect(0, 0, size, size);
    // outer ring (the part you touch) and platter
    g.fillStyle = colors['line-2']; g.beginPath(); g.arc(c, c, R, 0, Math.PI * 2); g.fill();
    g.fillStyle = colors['card-2']; g.beginPath(); g.arc(c, c, R * 0.86, 0, Math.PI * 2); g.fill();
    if (this.touching) { g.strokeStyle = col; g.lineWidth = 4; g.beginPath(); g.arc(c, c, R - 2, 0, Math.PI * 2); g.stroke(); }
    // grip ticks rotate with the music
    const rot = d.buffer ? d.position() * TURNS_PER_SECOND * Math.PI * 2 : 0;
    g.strokeStyle = colors['ink-3']; g.lineWidth = 1.5; g.globalAlpha = 0.6;
    for (let i = 0; i < 48; i++) {
      const a = rot + (i / 48) * Math.PI * 2;
      g.beginPath(); g.moveTo(c + Math.sin(a) * R * 0.9, c - Math.cos(a) * R * 0.9); g.lineTo(c + Math.sin(a) * R * 0.97, c - Math.cos(a) * R * 0.97); g.stroke();
    }
    g.globalAlpha = 1;
    // position marker, like the sticker on a record
    g.strokeStyle = col; g.lineWidth = 5; g.lineCap = 'round';
    g.beginPath(); g.moveTo(c + Math.sin(rot) * R * 0.3, c - Math.cos(rot) * R * 0.3); g.lineTo(c + Math.sin(rot) * R * 0.8, c - Math.cos(rot) * R * 0.8); g.stroke();
    // centre cap
    g.fillStyle = col; g.beginPath(); g.arc(c, c, R * 0.2, 0, Math.PI * 2); g.fill();
    g.fillStyle = colors.card; g.beginPath(); g.arc(c, c, R * 0.06, 0, Math.PI * 2); g.fill();
  }
}

// ---------- dials ----------
const P = (a, r = 24) => `${(32 + r * Math.sin(a)).toFixed(2)} ${(32 - r * Math.cos(a)).toFixed(2)}`;
function arc(a0, a1) {
  if (Math.abs(a1 - a0) < 1e-3) return '';
  const [s, e] = a0 < a1 ? [a0, a1] : [a1, a0];
  return `M ${P(s)} A 24 24 0 ${e - s > Math.PI ? 1 : 0} 1 ${P(e)}`;
}

/** A rotary dial. Drag up/down (or scroll, or arrow keys) to turn; double-click to reset. */
export function dialHTML({ id, label, value, min, max, def = value, cut = false }) {
  return `<div class="dial-wrap"><div class="dial" data-dial="${id}" data-min="${min}" data-max="${max}" data-def="${def}" data-value="${value}"
      tabindex="0" role="slider" aria-label="${label}" aria-valuemin="${min}" aria-valuemax="${max}" aria-valuenow="${value}" title="${label}: drag up or down · double-click to reset">
    <svg viewBox="0 0 64 64" aria-hidden="true"><path class="dial-track" d="${arc(dialAngle(0), dialAngle(1))}"/><path class="dial-fill"/>
      <circle class="dial-cap" cx="32" cy="32" r="17"/><line class="dial-ptr" x1="32" y1="32" x2="32" y2="19"/></svg></div>
    <span class="dial-label">${label}</span>${cut ? `<button class="cut" data-cut="${id}">Cut</button>` : ''}</div>`;
}

export function setDial(el, value) {
  const min = +el.dataset.min, max = +el.dataset.max, def = +el.dataset.def;
  const v = Math.max(min, Math.min(max, value));
  el.dataset.value = v; el.setAttribute('aria-valuenow', Math.round(v * 100) / 100);
  const t = (v - min) / (max - min), t0 = (def - min) / (max - min);
  el.querySelector('.dial-fill').setAttribute('d', arc(dialAngle(t0), dialAngle(t)));
  el.querySelector('.dial-ptr').setAttribute('transform', `rotate(${(dialAngle(t) * 180) / Math.PI} 32 32)`);
  el.classList.toggle('low', v <= min + (max - min) * 0.05);
  return v;
}

/** Wire up every dial under root. onChange(id, value) fires as it turns. */
export function bindDials(root, onChange) {
  root.querySelectorAll('[data-dial]').forEach((el) => setDial(el, +el.dataset.value));
  let drag = null;
  root.addEventListener('pointerdown', (e) => {
    const el = e.target.closest('[data-dial]'); if (!el) return;
    try { el.setPointerCapture(e.pointerId); } catch { /* pointer already gone */ }
    el.classList.add('turning');
    drag = { el, y: e.clientY, start: +el.dataset.value };
  });
  root.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const { el } = drag;
    const v = setDial(el, dialValue(drag.start, e.clientY - drag.y, +el.dataset.min, +el.dataset.max, e.shiftKey ? 600 : 160));
    onChange(el.dataset.dial, v);
  });
  const end = () => { drag?.el.classList.remove('turning'); drag = null; };
  root.addEventListener('pointerup', end); root.addEventListener('pointercancel', end);
  root.addEventListener('dblclick', (e) => {
    const el = e.target.closest('[data-dial]'); if (!el) return;
    onChange(el.dataset.dial, setDial(el, +el.dataset.def));
  });
  const nudgeDial = (el, steps) => {
    const span = +el.dataset.max - +el.dataset.min;
    onChange(el.dataset.dial, setDial(el, +el.dataset.value + steps * span / 40));
  };
  root.addEventListener('wheel', (e) => {
    const el = e.target.closest('[data-dial]'); if (!el) return;
    e.preventDefault(); nudgeDial(el, -Math.sign(e.deltaY));
  }, { passive: false });
  root.addEventListener('keydown', (e) => {
    const el = e.target.closest?.('[data-dial]'); if (!el) return;
    const k = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1 }[e.key];
    if (k) { e.preventDefault(); e.stopPropagation(); nudgeDial(el, k); }
  });
}
