// The Play view: a simple, game-like screen for brand-new DJs ("Afterhours"). Two glowing discs, two circles
// that lock together when the beats match, one handover slider, and a crowd that reacts. Your career runs
// from the bedroom to the main room (js/career.js); the venue map and the booking screen live here too.
// learn.js owns the decks and the mix guide and hands this view a small api.
import { icon } from './icons.js';
import { lockAmount, speedAdvice, nudgeAdvice, vibeStep, vibeWords, starsFor } from './playscore.js';
import { VENUES, venueById, venueIndex, gigProgress, GIG } from './career.js';
import { emit, filter } from './packs.js';

const SIDES = ['left', 'right'];
const OTHER = { left: 'right', right: 'left' };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const $ = (sel, el) => el.querySelector(sel);
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : w.endsWith('x') ? 'es' : 's'}`;
const STAR = (on = true) => `<svg class="pv-star ${on ? 'on' : ''}" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4l-5.9 3.1 1.2-6.5L2.5 9.4l6.6-.9z"/></svg>`;
const stars = (n) => `<span class="pv-stars" role="img" aria-label="${n} of 3 stars">${[0, 1, 2].map((i) => STAR(i < n)).join('')}</span>`;
const VENUE_ICON = {
  bedroom: 'M3 18v-6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v6M3 18h18M3 21v-3M21 21v-3M6 10V7a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3',
  party: 'M3 11l9-7 9 7M5 9.5V20h14V9.5M10 20v-5h4v5',
  basement: 'M7 3h10l-1 8a4 4 0 0 1-8 0zM12 15v5M8 21h8',
  warehouse: 'M3 21V9l9-5 9 5v12M3 21h18M8 21v-6h8v6M8 11h.01M12 11h.01M16 11h.01',
  main: 'M2 21h20M5 21v-4h14v4M8 17l-3-12M16 17l3-12M12 17V4',
};
const venueSvg = (id, size = 18) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${VENUE_ICON[id]}"/></svg>`;

// The mix guide's steps, said the Play view's way (no deck letters, no mixer words).
const STEP_PILL = { pick: 'Pick', match: 'Match', cue: 'Ready', levels: 'Hide it', start: 'Start', fade: 'Fade in', highs: 'Highs', mids: 'Mids', swap: 'Bass', out: 'Finish', ready: 'Ready' };
const BASS_CUT = -30;

/**
 * root: the Play view's element. layer: the overlay for the venue map and bookings (works in every view).
 * api: { decks, now(), beatmatch(ref, other), gain(side), xfader(), setXfader(x), play(side), tempo(side, pct),
 *   bend(side, dir), ready(side), load(side, track), suggest(ref, { exclude, limit }), career(),
 *   takeBooking(), djName(), setDjName(name), fullDecks(), tempoStep, seek(side, t), mixZone(side),
 *   openLibrary(side, slot), closeLibrary(), vol(side), setVol(side, v), bass(side), setBass(side, db), controls(),
 *   count(side), phraseGap(), align(side) }
 * The beat lane, the lesson card and the library are the full decks' own elements, lent to this view
 * (see slots in the returned object).
 */
export function createPlayView({ root, layer, api }) {
  const st = { vibe: 0.55, venue: null, crowdOn: -1, picker: null, resultTimer: 0, nextKey: '', sayKey: '', stepsKey: '', roles: { floor: 'left', inc: 'right' }, hold: null };
  const D = api.decks;

  root.innerHTML = `<div class="pv" data-venue="bedroom">
    <div class="pv-scene" aria-hidden="true">
      <div class="sc sc-window"></div><div class="sc sc-poster"></div><div class="sc sc-bricks"></div><div class="sc sc-cabinets"></div>
      <div class="sc sc-lights">${Array.from({ length: 18 }, (_, i) => `<i style="--i:${i}"></i>`).join('')}</div>
      <div class="sc sc-beams"><i></i><i></i><i></i><i></i></div>
      <div class="sc sc-lasers"><i></i><i></i><i></i></div>
      <div class="sc sc-glow"></div>
      <div class="sc sc-pack" data-pv-packscene></div>
    </div>
    <div class="pv-main">
      <header class="pv-top">
        <div class="pv-top-l">
          <button class="pv-chip pv-venue" data-pv="map" title="Your road from the bedroom to the main room"><span data-pv-vicon></span><span data-pv-venue></span></button>
          <button class="pv-chip pv-music" data-pv="music" title="Your music: every song in your library (/)">${icon('library', 15)}Your music</button>
        </div>
        <div class="pv-coach" data-pv-coachslot></div>
        <div class="pv-top-r">
          <span class="pv-packchips" data-pv-packchips></span>
          <span class="pv-chip" data-pv-streak title="Mixes in a row with 2 stars or more"></span>
          <span class="pv-chip" data-pv-starcount title="Stars from all your mixes"></span>
          <button class="pv-chip" data-pv="decks" title="Show the full decks, mixer, library and lessons">${icon('sliders', 15)}Full decks</button>
        </div>
      </header>
      <div class="pv-say" aria-live="polite"><ol class="pv-steps" data-pv-steps aria-label="Mix steps"></ol><div class="pv-kicker" data-pv-kicker></div><h1 data-pv-title></h1><p data-pv-detail></p></div>
      <div class="pv-stage">
        ${deckHTML('left')}
        <div class="pv-center">
          <div class="pv-lock" data-pv-lock aria-hidden="true"><i class="pv-ring l"></i><i class="pv-ring r"></i><b data-pv-locktext></b></div>
          <div class="pv-count" data-pv-count hidden><b data-pv-big></b><span data-pv-unit></span></div>
          <div class="pv-speed" data-pv-speed hidden>
            <div class="pv-seg"><button data-hold="slower">${icon('minus', 16)}Slower</button><button data-hold="faster">${icon('plus', 16)}Faster</button></div>
            <div class="pv-seg small"><button data-hold="back" title="Hold to slow it down for a moment">Push back</button><button data-hold="ahead" title="Hold to speed it up for a moment">Push ahead</button></div>
            <span class="pv-advice" data-pv-advice></span>
          </div>
          <button class="pv-cta" data-pv="ready" hidden>Get it ready</button>
          <button class="pv-cta" data-pv="pick" hidden>Choose a song</button>
        </div>
        ${deckHTML('right')}
      </div>
      <div class="pv-phrase" data-pv-phrase hidden aria-label="Where each song is in its phrase">
        ${phraseHTML('left')}
        <div class="pv-pmid"><span data-pv-pstatus></span><button class="pv-align" data-pv="align" hidden>Line up the phrase</button></div>
        ${phraseHTML('right')}
      </div>
      <div class="pv-laneslot" data-pv-laneslot></div>
      <div class="pv-hand pv-bassrow" data-pv-bassrow>
        <span class="pv-hl" data-pv-bl></span>
        <input type="range" min="0" max="1" step="0.005" value="0" data-pv-bass aria-label="Bass slider: towards a side gives that song the bass and takes it from the other">
        <span class="pv-hr" data-pv-br></span>
        <span class="pv-tag">Bass</span>
      </div>
      <div class="pv-hand" data-pv-hand>
        <span class="pv-hl" data-pv-hl></span>
        <input type="range" min="0" max="1" step="0.005" value="0" data-pv-xf aria-label="Handover slider: left plays the left song to the room, right plays the right song">
        <span class="pv-hr" data-pv-hr></span>
        <span class="pv-tag">Handover</span>
      </div>
      <div class="pv-bars" data-pv-bars aria-hidden="true"></div>
      <div class="pv-bottom">
        <div class="pv-vibe"><span class="pv-label">The vibe in here</span><div class="pv-meter"><s data-pv-vibe></s></div><span data-pv-vibetext></span></div>
        <div class="pv-crowd" data-pv-crowd aria-hidden="true"></div>
        <div class="pv-gig"><span class="pv-label" data-pv-giglabel>Gig progress</span><div class="pv-gigbars" data-pv-gigbars></div><span data-pv-gigtext></span></div>
      </div>
    </div>
    <aside class="pv-next" data-pv-next aria-label="Play next">
      <div class="pv-next-head"><b data-pv-nexttitle>Play next</b><button class="pv-link" data-pv="all">All songs</button></div>
      <p class="pv-next-sub" data-pv-nextsub></p>
      <div class="pv-cards" data-pv-cards></div>
    </aside>
    <div class="pv-picker hidden" data-pv-picker role="dialog" aria-modal="true" aria-label="Choose a song">
      <div class="pv-picker-card">
        <div class="pv-picker-head"><b data-pv-ptitle>Choose a song</b><span class="pv-picker-tip">Double-click a song to put it on</span><button class="pv-x" data-pv="close-picker" aria-label="Close">${icon('x', 16)}</button></div>
        <div class="pv-libslot" data-pv-libslot></div>
      </div>
    </div>
    <div class="pv-result hidden" data-pv-result role="status"></div>
  </div>`;
  const el = (k) => $(`[data-pv-${k}]`, root);
  const pv = $('.pv', root);

  // a phrase is 16 bars: four blocks of four, and four beats in each bar
  function phraseHTML(side) {
    return `<div class="pv-pc" data-pv-pc="${side}" title="Beat in the bar, and bar in the 16-bar phrase">
      <span class="pv-pbeats">${'<i></i>'.repeat(4)}</span>
      <span class="pv-pbars">${Array.from({ length: 4 }, () => `<span>${'<i></i>'.repeat(4)}</span>`).join('')}</span>
      <small>Phrase <b data-pv-pn>–</b></small>
    </div>`;
  }

  function deckHTML(side) {
    return `<div class="pv-deck" data-side="${side}">
      <div class="pv-discrow">
      <label class="pv-vol" title="Volume">
        <input type="range" min="0" max="1" step="0.01" value="1" data-pv-vol="${side}" aria-label="Volume, ${side} song">
        <span>Vol</span>
      </label>
      <div class="pv-disc">
        <i class="pv-glow"></i>
        <svg class="pv-arc" viewBox="0 0 220 220" aria-hidden="true"><circle class="bg" cx="110" cy="110" r="106"/><circle class="fg" cx="110" cy="110" r="106" pathLength="100"/></svg>
        <div class="pv-platter"><i class="pv-mark"></i></div>
        <button class="pv-play" data-pv-play="${side}"></button>
      </div>
      </div>
      <div class="pv-role" data-role></div>
      <div class="pv-name" data-name></div>
      <div class="pv-sub" data-sub></div>
      <div class="pv-seek" data-pv-seek="${side}" role="slider" tabindex="0" aria-label="Skip through the song" aria-valuemin="0" aria-valuemax="100" title="Click or drag to skip through the song">
        <i class="pv-zone" title="The mix: bring the next song in here"></i><i class="pv-done"></i><i class="pv-head"></i>
      </div>
      <button class="pv-skip" data-pv-skip="${side}" hidden>Skip to the mix ${icon('chevron', 13, 'style="transform:rotate(-90deg)"')}</button>
    </div>`;
  }

  // ---------- events ----------
  root.addEventListener('click', (e) => {
    const p = e.target.closest('[data-pv-play]');
    if (p) { const side = p.dataset.pvPlay; return D[side].buffer ? api.play(side) : openPicker(side); }
    const sk = e.target.closest('[data-pv-skip]');
    if (sk) return skipToMix(sk.dataset.pvSkip);
    const b = e.target.closest('[data-pv]'); if (!b) {
      const row = e.target.closest('[data-pv-load]');
      if (row) { const t = row._track; const side = row.dataset.pvLoad; if (t) api.load(side, t); }
      if (e.target === el('picker')) closePicker();
      return;
    }
    const a = b.dataset.pv;
    if (a === 'map') return filter('openMap', false) || openMap(); // an expansion pack can show its own screen here
    if (a === 'music') return openPicker(pickSide());
    if (a === 'align') { const gap = api.phraseGap(); if (gap?.canAlign) api.align(gap.mover); return; }
    if (a === 'decks') return api.fullDecks();
    if (a === 'ready') return api.ready(st.roles.inc);
    if (a === 'pick' || a === 'all') return openPicker(pickSide());
    if (a === 'close-picker') return closePicker();
    if (a === 'close-result') return hideResult();
  });
  // keyboard (Enter / Space): one step, or a short push
  root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-hold]'); if (!b || e.detail !== 0) return;
    const side = st.roles.inc, what = b.dataset.hold;
    if (what === 'faster' || what === 'slower') return api.tempo(side, (what === 'faster' ? 1 : -1) * api.tempoStep);
    api.bend(side, what === 'back' ? -1 : 1); setTimeout(() => api.bend(side, 0), 250);
  });
  root.addEventListener('input', (e) => {
    if (e.target.matches('[data-pv-xf]')) api.setXfader(+e.target.value);
    if (e.target.matches('[data-pv-vol]')) api.setVol(e.target.dataset.pvVol, +e.target.value);
    if (e.target.matches('[data-pv-bass]')) setBassSlider(+e.target.value);
  });
  // double-click a volume slider for full volume, the bass slider for both basses back to normal
  root.addEventListener('dblclick', (e) => {
    if (e.target.matches('[data-pv-vol]')) api.setVol(e.target.dataset.pvVol, 1);
    if (e.target.matches('[data-pv-bass]')) setBassSlider(0.5);
  });
  root.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && st.picker) { e.stopPropagation(); closePicker(); return; }
    // the seek strip: arrow keys skip a bar (a phrase with Shift)
    const sb = e.target.closest?.('[data-pv-seek]');
    if (sb && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      e.preventDefault(); e.stopPropagation();
      const d = D[sb.dataset.pvSeek]; if (!d.buffer) return;
      const bar = d.track.grid ? (240 / d.track.grid.bpm) : 2;
      api.seek(sb.dataset.pvSeek, d.position() + (e.key === 'ArrowRight' ? 1 : -1) * bar * (e.shiftKey ? 16 : 1));
    }
  });
  // the seek strip: click or drag to skip through a song, like clicking the waveform on the full decks
  root.addEventListener('pointerdown', (e) => {
    const sb = e.target.closest('[data-pv-seek]'); if (!sb) return;
    const side = sb.dataset.pvSeek, d = D[side]; if (!d.buffer) return;
    e.preventDefault(); try { sb.setPointerCapture?.(e.pointerId); } catch { /* not a real pointer */ }
    const at = (ev) => { const r = sb.getBoundingClientRect(); return Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width)) * d.buffer.duration; };
    sb.classList.add('drag'); st.drag = { side, t: at(e) };
    const move = (ev) => { st.drag.t = at(ev); };
    const up = () => { sb.classList.remove('drag'); api.seek(side, st.drag.t); st.drag = null; sb.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up); };
    sb.addEventListener('pointermove', move); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up);
  });
  // Faster / Slower repeat while held (and speed up); Push back / ahead bend while held, like a jog wheel.
  root.addEventListener('pointerdown', (e) => {
    const b = e.target.closest('[data-hold]'); if (!b || b.disabled) return;
    e.preventDefault(); try { b.setPointerCapture?.(e.pointerId); } catch { /* not a real pointer */ }
    const side = st.roles.inc, what = b.dataset.hold;
    const end = () => { clearTimeout(st.hold?.t); if (what === 'back' || what === 'ahead') api.bend(side, 0); st.hold = null; b.classList.remove('down'); };
    b.classList.add('down');
    if (what === 'back' || what === 'ahead') { api.bend(side, what === 'back' ? -1 : 1); st.hold = { end }; }
    else {
      const dir = what === 'faster' ? 1 : -1; let n = 0;
      const tick = () => { api.tempo(side, dir * (n > 12 ? api.tempoStep * 6 : n > 4 ? api.tempoStep * 2 : api.tempoStep)); n++; st.hold.t = setTimeout(tick, n === 1 ? 350 : 90); };
      st.hold = { end }; tick();
    }
    const up = () => { end(); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up); };
    window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up);
  });

  // ---------- the bass slider: one move swaps the bass from one song to the other ----------
  // 0: only the left song's bass, 0.5: both (muddy), 1: only the right song's.
  function setBassSlider(x) {
    const cut = (k) => Math.max(0, Math.min(1, k)) * BASS_CUT; // 0..1 → 0..-30 dB
    api.setBass('left', cut((x - 0.5) * 2));
    api.setBass('right', cut((0.5 - x) * 2));
  }
  function bassSliderValue() {
    const amt = (db) => Math.max(0, Math.min(1, db / BASS_CUT));
    return 0.5 + 0.5 * (amt(api.bass('left')) - amt(api.bass('right')));
  }
  const bassOn = (side) => api.bass(side) > -12;

  // ---------- who's who ----------
  const LATER = [{ id: 'start', status: 'todo' }, { id: 'fade', status: 'todo' }, { id: 'out', status: 'todo' }];
  const stepItems = (n) => (n?.waiting ? [...n.waiting.items, ...LATER] : n?.guide?.items || []);
  function roles(n) {
    if (n?.plan) return { floor: n.plan.from, inc: n.plan.to };
    if (n?.waiting) return { floor: n.waiting.from, inc: n.waiting.to };
    const L = D.left, R = D.right;
    if (L.playing !== R.playing) { const f = L.playing ? 'left' : 'right'; return { floor: f, inc: OTHER[f] }; }
    if (L.buffer && !R.buffer) return { floor: 'left', inc: 'right' };
    if (R.buffer && !L.buffer) return { floor: 'right', inc: 'left' };
    const f = api.xfader() <= 0.5 ? 'left' : 'right';
    return { floor: f, inc: OTHER[f] };
  }
  const pickSide = () => (!D[st.roles.floor].buffer ? st.roles.floor : st.roles.inc);
  const songName = (side) => D[side].track?.title || 'the other song';

  const deadline = (g) => (g?.toDeadline != null ? { big: String(g.toDeadline), unit: g.toDeadline === 1 ? 'bar' : 'bars', phase: 'blend' } : null);
  const note = (g) => g?.note?.text || '';
  /** What to say right now: { kicker, title, detail, cta, count, step, hl (controls to light up) }. */
  function say(n, r, bm) {
    const F = D[r.floor], T = D[r.inc];
    const inc = songName(r.inc), floor = songName(r.floor);
    if (!F.buffer && !T.buffer) return { kicker: 'Let\'s go', title: 'Pick your first song', detail: 'Choose something you love. It goes on the left and you press play.', cta: 'pick' };
    if (!F.playing && !T.playing) {
      const side = F.buffer ? r.floor : r.inc;
      return { kicker: 'Ready when you are', title: 'Press play', detail: `Start ${songName(side)} with the button in the middle of its disc.` };
    }
    const g = n?.guide, cur = g?.current;
    const id = n?.waiting ? 'pick' : cur?.id;
    const items = stepItems(n);
    const shown = items.filter((x) => x.id !== 'load' && x.status !== 'missed');
    const i = shown.findIndex((x) => x.id === id || (id === 'load' && x.id === 'pick'));
    const kicker = i >= 0 ? `Step ${i + 1} of ${shown.length}` : '';
    const cue = n?.cue;
    switch (id) {
      case 'pick': case 'load':
        return { kicker, title: 'Pick what\'s next', detail: 'Choose a song from Play next. The green ones blend best with this one.', step: 'pick' };
      case 'match': {
        const adv = speedAdvice(bm?.bpmDiff);
        return { kicker, title: 'Lock the pulse', detail: `${adv.text} When the two circles sit on top of each other, the speeds match.`, step: 'match' };
      }
      case 'cue':
        return { kicker, title: 'Get it ready', detail: `Press "Get it ready" so ${inc} waits on its very first beat.`, cta: 'ready', step: 'cue' };
      case 'levels': case 'ready': {
        const c = api.controls();
        if (!c.volume) return { kicker, title: 'Keep it secret', detail: `Slide the handover all the way to ${floor}, so nobody hears ${inc} yet.`, step: 'levels', hl: ['hand'] };
        const volDown = api.vol(r.inc) <= 0.1, bassDown = !c.low || api.bass(r.inc) <= -20;
        const todo = [!volDown && `${inc}'s volume all the way down`, !bassDown && `the bass slider all the way to ${floor}`].filter(Boolean);
        return { kicker, title: 'Hide it: volume and bass down', detail: `${todo.length ? `Slide ${todo.join(', and ')}.` : 'Done.'} Then put the handover in the middle: the volume does the mixing now.`, step: 'levels', hl: [!volDown && `vol:${r.inc}`, !bassDown && 'bass', 'hand'].filter(Boolean) };
      }
      case 'start': {
        const count = cue && ['soon', 'count', 'go'].includes(cue.phase) ? { big: cue.big, unit: cue.unit, phase: cue.phase } : null;
        if (cue?.phase === 'go') return { kicker, title: 'GO: press play now', detail: `Start ${inc} right on this beat.`, count, step: 'start' };
        if (cue?.phase === 'count') return { kicker, title: 'Get your finger ready…', detail: `Press play on ${inc} when the count hits GO.`, count, step: 'start' };
        if (cue?.phase === 'late') return { kicker, title: 'Missed it: no problem', detail: cue.detail.replace(/A's bar \d+, /, ''), count: { big: cue.big, unit: cue.unit, phase: 'late' }, step: 'start' };
        const bars = cue && Number.isFinite(+cue.big) ? +cue.big : null;
        return { kicker, title: bars ? `Start it in ${plural(bars, 'bar')}` : 'Start it on the 1', detail: `Wait for the countdown, then press play on ${inc}. Nobody hears it yet.`, count, step: 'start' };
      }
      case 'fade': {
        const vol = api.controls().volume;
        return { kicker, title: vol ? 'Fade it in, slowly' : 'Slide it over, slowly', detail: note(g) || (vol ? `Raise ${inc}'s volume a little every bar: all the way up by the end of the countdown. Keep its bass down.` : `Move the handover towards ${inc}, a little every bar. Halfway by the end of the countdown.`), count: deadline(g), step: 'fade', slide: true, hl: [vol ? `vol:${r.inc}` : 'hand'] };
      }
      case 'swap':
        return { kicker, title: `Swap the bass on bar ${cur.bar}`, detail: note(g) || `On the "1", slide the bass all the way over to ${inc}. Two basslines at once sound muddy, so do it in one go.`, count: deadline(g), step: 'swap', slide: true, hl: ['bass'] };
      case 'out': {
        const vol = api.controls().volume;
        return { kicker, title: `Fade ${floor} out`, detail: note(g) || (vol ? `Lower ${floor}'s volume slowly until it's silent. Then it can stop.` : `Keep sliding until it's all ${inc}. Then ${floor} can stop.`), count: deadline(g), step: 'out', slide: true, hl: [vol ? `vol:${r.floor}` : 'hand'] };
      }
      default:
        if (cur && id) return { kicker, title: cur.title, detail: note(g) || cur.detail, count: deadline(g), step: id, slide: true };
        break;
    }
    if (n?.plan && !F.playing) return { kicker: '', title: `Press play on ${floor}`, detail: 'The countdown to the next mix starts when it plays.' };
    if (g && !cur && g.next) return { kicker, title: 'Nice. Hold it there', detail: `Next: ${g.next.short.toLowerCase()} in ${plural(g.toNext, 'bar')}.`, count: { big: String(g.toNext), unit: g.toNext === 1 ? 'bar' : 'bars', phase: 'blend' } };
    if (g && !cur) return { kicker: 'Mix done', title: 'Mix done', detail: `${inc} owns the room now. Pick what's next and go again.`, cta: 'pick' };
    if (F.playing && !T.buffer) return { kicker: '', title: 'Pick what\'s next', detail: 'Choose a song from Play next.', cta: 'pick' };
    return { kicker: '', title: 'Keep it moving', detail: 'Match the speed, then start the next song on the 1.' };
  }

  // ---------- per frame ----------
  function update(dt) {
    const n = api.now();
    const r = roles(n); st.roles = r;
    const F = D[r.floor], T = D[r.inc];
    const career = api.career();
    const venueId = filter('venue', career.venue); // a pack may put you somewhere else tonight
    if (st.venue !== venueId) setVenue(venueId);
    const venue = venueById(venueId);

    // beats: the incoming deck measured against the floor
    const bm = F.buffer && T.buffer ? api.beatmatch(F, T) : null;
    const offsetMs = bm?.both ? (bm.phase * 60000) / (F.bpm || 120) : null;
    const lock = bm ? lockAmount(bm.bpmDiff, offsetMs) : 0;

    // discs
    for (const side of SIDES) {
      const d = D[side], de = $(`.pv-deck[data-side="${side}"]`, root);
      const loaded = !!d.buffer, pos = loaded ? d.position() : 0;
      de.classList.toggle('empty', !loaded); de.classList.toggle('playing', loaded && d.playing);
      de.classList.toggle('floor', side === r.floor);
      const audible = loaded && d.playing && api.gain(side) > 0.12;
      const role = !loaded ? 'Empty' : audible ? 'On the floor' : d.playing ? 'In your headphones' : side === r.inc && F.playing ? 'Up next' : 'Ready';
      setText($('[data-role]', de), role);
      setText($('[data-name]', de), loaded ? d.track.title : side === pickSide() ? 'Choose a song' : '');
      const left = loaded ? Math.max(0, d.buffer.duration - pos) : 0;
      setText($('[data-sub]', de), loaded ? `${d.track.artist ? `${d.track.artist} · ` : ''}${Math.floor(left / 60)}:${String(Math.floor(left % 60)).padStart(2, '0')} left` : '');
      $('.pv-platter', de).style.transform = `rotate(${(pos * 200) % 360}deg)`;
      $('.pv-arc .fg', de).style.strokeDashoffset = loaded ? String(100 - (pos / d.buffer.duration) * 100) : '100';
      const ph = loaded && d.playing ? d.beatPhase() : null;
      de.style.setProperty('--pulse', ph == null ? '0.25' : (1 - ph) ** 2 * 0.75 + 0.25);
      // seek strip: where you are, and where the mix happens
      const sb = $('.pv-seek', de), dur = loaded ? d.buffer.duration : 1;
      const shown = st.drag?.side === side ? st.drag.t : pos;
      sb.style.setProperty('--at', loaded ? (shown / dur).toFixed(4) : '0');
      sb.classList.toggle('off', !loaded);
      sb.setAttribute('aria-valuenow', String(loaded ? Math.round((pos / dur) * 100) : 0));
      const zone = loaded ? api.mixZone(side) : null;
      sb.classList.toggle('has-zone', !!zone);
      if (zone) { sb.style.setProperty('--z0', (zone.start / dur).toFixed(4)); sb.style.setProperty('--z1', (zone.end / dur).toFixed(4)); }
      const skip = $('.pv-skip', de);
      skip.hidden = !zone || side !== r.floor || pos >= zone.start - zone.lead - 1;
      const pb = $('.pv-play', de), want = !loaded ? 'add' : d.playing ? 'pause' : 'play';
      if (pb.dataset.state !== want) {
        pb.dataset.state = want;
        pb.innerHTML = icon(want === 'add' ? 'plus' : want, 26);
        pb.setAttribute('aria-label', want === 'add' ? 'Choose a song' : `${want === 'play' ? 'Play' : 'Pause'} ${d.track.title}`);
      }
    }

    // the lock
    const lk = el('lock');
    lk.style.setProperty('--sep', String(1 - lock));
    lk.dataset.state = !bm ? 'off' : lock >= 0.99 ? 'locked' : lock >= 0.8 ? 'close' : 'apart';
    lk.classList.toggle('flip', r.floor === 'right');
    setText(el('locktext'), !bm ? '' : lock >= 0.99 ? 'LOCKED' : `${Math.round(lock * 100)}%`);

    // what to say, and which controls matter now
    const s = say(n, r, bm);
    const key = `${s.kicker}|${s.title}|${s.detail}`;
    if (key !== st.sayKey) { st.sayKey = key; setText(el('kicker'), s.kicker); setText(el('title'), s.title); setText(el('detail'), s.detail); }
    const cnt = el('count'); cnt.hidden = !s.count;
    if (s.count) { setText(el('big'), s.count.big); setText(el('unit'), s.count.unit); cnt.dataset.phase = s.count.phase; }
    $('[data-pv="ready"]', root).hidden = s.cta !== 'ready' || !T.buffer;
    $('[data-pv="pick"]', root).hidden = s.cta !== 'pick';
    const sp = el('speed'); sp.hidden = !T.buffer || !F.buffer;
    if (!sp.hidden) {
      const adv = bm && Math.abs(bm.bpmDiff) > 0.1 ? speedAdvice(bm.bpmDiff) : null;
      const nud = !adv && bm?.both ? nudgeAdvice(offsetMs) : null;
      $('[data-hold="faster"]', sp).classList.toggle('hint', adv?.dir === 'faster');
      $('[data-hold="slower"]', sp).classList.toggle('hint', adv?.dir === 'slower');
      $('[data-hold="back"]', sp).classList.toggle('hint', nud?.dir === 'back');
      $('[data-hold="ahead"]', sp).classList.toggle('hint', nud?.dir === 'ahead');
      $('.pv-seg.small', sp).hidden = !T.playing; // pushing the beats only matters once both play
      setText(el('advice'), adv ? adv.text : nud?.text || (bm ? 'Same speed.' : ''));
      sp.classList.toggle('focus', s.step === 'match');
    }

    // steps
    const items = stepItems(n).filter((x) => x.id !== 'load');
    const cur = n?.waiting ? 'pick' : n?.guide?.current?.id === 'load' ? 'pick' : n?.guide?.current?.id;
    const sk = items.map((x) => `${x.id}:${x.status}`).join() + cur;
    if (sk !== st.stepsKey) {
      st.stepsKey = sk;
      el('steps').hidden = !items.length;
      el('kicker').hidden = items.length > 0; // the pills already say which step
      el('steps').innerHTML = items.map((x) => `<li class="${x.status}${x.id === cur ? ' current' : ''}">${STEP_PILL[x.id] || esc(x.short)}</li>`).join('');
    }

    // volume and bass sliders, and which control the step wants
    const hl = new Set(s.hl || []);
    for (const side of SIDES) {
      const v = $(`[data-pv-vol="${side}"]`, root);
      if (document.activeElement !== v) v.value = api.vol(side);
      v.disabled = !D[side].buffer;
      v.closest('.pv-vol').classList.toggle('hint', hl.has(`vol:${side}`));
      v.closest('.pv-vol').classList.toggle('low', D[side].buffer && api.vol(side) < 0.05);
    }
    const bs = el('bass');
    if (document.activeElement !== bs) bs.value = bassSliderValue();
    el('bassrow').classList.toggle('hint', hl.has('bass'));
    const bl = bassOn('left'), br = bassOn('right');
    const bothBass = bl && br && D.left.buffer && D.right.buffer;
    setText(el('bl'), D.left.buffer ? (bl ? 'Bass on' : 'Bass off') : 'Left');
    setText(el('br'), D.right.buffer ? (br ? 'Bass on' : 'Bass off') : 'Right');
    el('bl').classList.toggle('on', !!(D.left.buffer && bl)); el('br').classList.toggle('on', !!(D.right.buffer && br));
    el('bassrow').classList.toggle('muddy', !!(bothBass && D.left.playing && D.right.playing && api.gain('left') > 0.12 && api.gain('right') > 0.12));
    el('hand').classList.toggle('hint', hl.has('hand'));

    // the phrase counter, and lining the phrases up
    const prow = el('phrase');
    prow.hidden = !(D.left.buffer && D.right.buffer);
    if (!prow.hidden) {
      for (const side of SIDES) {
        const c = api.count(side), pc = $(`[data-pv-pc="${side}"]`, prow);
        const ck = c ? `${c.beat}|${c.barInPhrase}|${c.phrase}` : 'none';
        if (pc.dataset.key === ck) continue;
        pc.dataset.key = ck;
        pc.classList.toggle('before', !c);
        [...$('.pv-pbeats', pc).children].forEach((x, i) => x.classList.toggle('on', !!c && i + 1 === c.beat));
        [...pc.querySelectorAll('.pv-pbars i')].forEach((x, i) => { x.classList.toggle('on', !!c && i < c.barInPhrase); x.classList.toggle('now', !!c && i + 1 === c.barInPhrase); });
        setText($('[data-pv-pn]', pc), c ? String(c.phrase) : '–');
      }
      const gap = api.phraseGap();
      const gk = gap ? `${gap.mover}|${gap.beats}|${gap.canAlign}` : 'none';
      if (prow.dataset.key !== gk) {
        prow.dataset.key = gk;
        const name = gap ? songName(gap.mover) : '';
        setText(el('pstatus'), !gap ? '' : gap.beats === 0 ? 'Same bar of the phrase ✓' : gap.far ? 'Different parts of the phrase' : `${name} is ${gap.words} ${gap.beats > 0 ? 'behind' : 'ahead'}`);
        prow.classList.toggle('same', !!gap && gap.beats === 0);
        prow.classList.toggle('off', !!gap && gap.beats !== 0);
        const ab = $('[data-pv="align"]', prow);
        ab.hidden = !gap?.canAlign;
        if (gap?.canAlign) ab.title = `Jump ${name} ${gap.beats > 0 ? 'forward' : 'back'} ${gap.words}, so both songs are on the same beat and bar of the phrase. It keeps playing.`;
      }
      // light it up when both play and the phrases are apart
      $('[data-pv="align"]', prow).classList.toggle('hint', !!gap?.canAlign && gap.beats !== 0 && D.left.playing && D.right.playing);
    }

    // handover slider
    const xf = el('xf');
    if (document.activeElement !== xf) xf.value = api.xfader();
    setText(el('hl'), D.left.buffer ? D.left.track.title : 'Left');
    setText(el('hr'), D.right.buffer ? D.right.track.title : 'Right');
    el('hand').classList.toggle('go', !!s.slide && (!s.hl || s.hl.includes('hand')));
    el('hand').classList.toggle('flip', r.floor === 'right');
    const bars = el('bars');
    if (s.slide && n?.guide?.current) {
      const c = n.guide.current, total = Math.max(1, Math.round(c.by - c.bar)), done = Math.max(0, Math.min(total, Math.floor(n.bar - c.bar)));
      const bk = `${c.id}|${total}|${done}`;
      if (bars.dataset.key !== bk) { bars.dataset.key = bk; bars.innerHTML = Array.from({ length: Math.min(total, 32) }, (_, i) => `<i class="${i < done ? 'on' : ''}"></i>`).join(''); }
      bars.hidden = false;
    } else bars.hidden = true;

    // the room
    const audibleA = F.buffer && F.playing && api.gain(r.floor) > 0.12, audibleB = T.buffer && T.playing && api.gain(r.inc) > 0.12;
    const both = audibleA && audibleB;
    const muddy = both && bassOn(r.floor) && bassOn(r.inc); // two basslines at once: the floor notices
    const clash = both && ((bm && (Math.abs(bm.bpmDiff) > 0.3 || (offsetMs != null && Math.abs(offsetMs) > 45))) || muddy);
    const locked = both && lock >= 0.99;
    if (st.heard || audibleA || audibleB) { // the room waits for the first song
      const prev = st.vibe;
      st.vibe = filter('vibe', vibeStep(prev, { audible: audibleA || audibleB, clash, locked }, dt, venue.picky), { prev, venue: venueId });
    }
    emit('frame', { vibe: st.vibe, dt, live: !!(audibleA || audibleB) });
    el('vibe').style.width = `${Math.round(st.vibe * 100)}%`;
    el('vibe').dataset.tone = st.vibe >= 0.6 ? 'ok' : st.vibe >= 0.35 ? 'close' : 'warn';
    setText(el('vibetext'), audibleA || audibleB || st.heard ? vibeWords(st.vibe, venue.crowd) : 'Waiting for the music.');
    if (audibleA || audibleB) st.heard = true;
    const on = audibleA || audibleB ? Math.max(1, Math.round(st.vibe * venue.crowd)) : 0;
    if (on !== st.crowdOn) { st.crowdOn = on; [...el('crowd').children].forEach((p, i) => p.classList.toggle('on', +p.dataset.rank < on)); }
    const beatDeck = audibleA ? F : audibleB ? T : null;
    const ph = beatDeck ? beatDeck.beatPhase() : null;
    pv.style.setProperty('--bounce', ph == null ? '0' : Math.sin(Math.PI * ph).toFixed(3));
    pv.style.setProperty('--vibe', st.vibe.toFixed(3));
    pv.classList.toggle('live', !!beatDeck);

    // career
    const gp = gigProgress(career);
    const hud = filter('gigHud', null); // a pack's own gig: { label, done, of, text }
    setText(el('venue'), filter('venueName', venue.name));
    setText(el('streak'), `×${career.streak} streak`);
    el('starcount').innerHTML = `${STAR(true)}${career.stars}`;
    const gb = hud || gp;
    const gk = `${gb.done}|${gb.of}|${gp.booked}|${!!hud}`;
    if (el('gigbars').dataset.key !== gk) {
      el('gigbars').dataset.key = gk;
      el('gigbars').innerHTML = Array.from({ length: gb.of }, (_, i) => `<i class="${i < gb.done ? 'on' : ''}"></i>`).join('');
    }
    setText(el('giglabel'), hud ? hud.label : 'Gig progress');
    setText(el('gigtext'), hud ? hud.text : gp.last ? 'Headline set. Keep that floor full.' : gp.booked ? `You're booked at ${gp.next.name}. Open the map.` : `${plural(gp.of - gp.done, 'more mix')} with ${GIG.stars} stars or more and you're booked at ${gp.next.name}.`);

    // Play next: when there's room for another song
    // Play next: always there once a song is on. Mid-mix it already lists what goes after the new song.
    const showNext = !!(F.buffer || T.buffer);
    pv.classList.toggle('has-next', showNext);
    if (showNext) {
      const mixing = !!(F.buffer && T.buffer && F.playing && T.playing);
      const refSide = mixing || !F.buffer ? r.inc : r.floor;
      const spent = T.buffer && T.position() > T.buffer.duration * 0.5; // the song you just mixed out of: no "changed your mind"
      renderNext(D[refSide].track, mixing ? 'wait' : T.buffer && F.buffer && !spent ? 'swap' : 'pick', mixing ? r.floor : OTHER[refSide]);
    }
  }

  function setText(node, t) { if (node && node.textContent !== t) node.textContent = t; }

  /**
   * mode: 'pick' (the other deck is empty), 'swap' (it has a song you could change your mind about), 'wait'
   * (mid-mix: these go after the song coming in, once the old one has finished). side: where a card loads.
   */
  function renderNext(ref, mode, side) {
    const key = `${ref.id}|${mode}|${side}|${SIDES.map((x) => D[x].track?.id).join()}|${api.trackCount()}`;
    if (st.nextKey === key) return;
    st.nextKey = key;
    setText(el('nexttitle'), mode === 'wait' ? 'Up after this mix' : 'Play next');
    setText(el('nextsub'), mode === 'wait' ? `These blend with ${ref.title}. Pick one once the handover is done.`
      : mode === 'swap' ? `Changed your mind? These blend with ${ref.title} too.` : `These blend with ${ref.title}.`);
    const rows = api.suggest(ref, { exclude: SIDES.map((x) => D[x].track?.id).filter(Boolean), limit: 5 });
    const box = el('cards');
    box.innerHTML = rows.length ? '' : '<p class="pv-empty">No other songs yet. Add some music in Full decks.</p>';
    for (const row of rows) { const c = cardEl(row, side); c.disabled = mode === 'wait'; box.append(c); }
  }
  function cardEl({ track: t, match: m }, side) {
    const b = document.createElement('button');
    b.className = 'pv-card'; b.dataset.pvLoad = side; b._track = t;
    const hue = t.camelot ? (parseInt(t.camelot, 10) * 30 + 180) % 360 : 260;
    b.innerHTML = `<span class="pv-art" style="--h:${hue}" aria-hidden="true"></span><span class="pv-ct"><b>${esc(t.title)}</b><span class="pv-cl"><small>${esc(t.artist || '')}</small>${m ? `<span class="pv-match ${m.level}">${{ great: 'Perfect', good: 'Good', tricky: 'A jump' }[m.level]}</span>` : ''}</span></span>`;
    b.title = m ? m.why.join(' · ') : '';
    return b;
  }

  // ---------- picking a song: your library, lent by the full decks ----------
  function openPicker(side) {
    st.picker = { side };
    const other = D[OTHER[side]];
    setText(el('ptitle'), other.buffer ? `What goes after ${other.track.title}?` : 'Choose a song to start with');
    el('picker').classList.remove('hidden');
    api.openLibrary(side, el('libslot'));
  }
  function closePicker() {
    if (!st.picker) return;
    st.picker = null; el('picker').classList.add('hidden');
    api.closeLibrary();
  }

  // ---------- skipping to the mix ----------
  function skipToMix(side) {
    const z = api.mixZone(side); if (!z) return;
    api.seek(side, Math.max(0, z.start - z.lead));
  }

  // ---------- after a mix ----------
  function showResult(report, career) {
    const n = starsFor(report.score), gp = gigProgress(career);
    const line = report.praise || report.tips[0]?.text || '';
    const tip = report.praise && report.tips[0] ? report.tips[0].text : '';
    const box = el('result');
    box.innerHTML = `<div class="pv-res-head">${stars(n)}<button class="pv-x" data-pv="close-result" aria-label="Close">${icon('x', 15)}</button></div>
      <b class="pv-res-grade">${esc(report.grade)}</b>
      ${line ? `<p>${esc(line)}</p>` : ''}${tip ? `<p class="pv-res-tip">Next time: ${esc(tip)}</p>` : ''}
      <p class="pv-res-gig">${esc(filter('resultGigLine', `${n >= GIG.stars ? 'That one counts for your gig.' : `${GIG.stars} stars or more counts for your gig.`} ${gp.last ? '' : `${gp.done} of ${gp.of} done.`}`))}</p>`;
    box.classList.remove('hidden');
    clearTimeout(st.resultTimer);
    st.resultTimer = setTimeout(hideResult, 12000);
  }
  function hideResult() { el('result').classList.add('hidden'); }

  // ---------- venues ----------
  function setVenue(id) {
    st.venue = id;
    const v = venueById(id);
    pv.dataset.venue = id;
    el('vicon').innerHTML = venueSvg(id, 16);
    // the crowd: silhouettes in a random-looking but fixed order, the front row a little bigger
    const crowd = el('crowd');
    let seed = 7;
    const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
    const people = Array.from({ length: v.crowd }, (_, i) => ({ i, h: 0.75 + rnd() * 0.5, arm: rnd() < 0.22, k: 0.6 + rnd() * 0.8, rank: 0 }));
    [...people].sort(() => rnd() - 0.5).forEach((p, r) => { p.rank = r; });
    crowd.style.setProperty('--n', v.crowd);
    crowd.innerHTML = (id === 'bedroom' ? '<span class="pv-sofa"></span><span class="pv-cat"></span>' : '')
      + people.map((p) => `<span class="pv-person${p.arm ? ' arm' : ''}" data-rank="${p.rank}" style="--h:${p.h.toFixed(2)};--k:${p.k.toFixed(2)}"></span>`).join('');
    st.crowdOn = -1;
  }

  // ---------- the venue map and bookings (in the layer, any view) ----------
  function openMap() {
    const career = api.career(), here = venueIndex(career.venue), gp = gigProgress(career);
    layer.innerHTML = `<div class="cl-card cl-map" role="dialog" aria-modal="true" aria-labelledby="clMapTitle">
      <button class="pv-x cl-close" data-cl="close" aria-label="Close">${icon('x', 18)}</button>
      <h2 id="clMapTitle">Your road to the main room</h2>
      <p class="cl-lead">Play a good gig at each venue to get booked at the next one. Bigger rooms hand you more of the decks.</p>
      <ol class="cl-road">${VENUES.map((v, i) => {
        const state = i < here ? 'done' : i === here ? 'here' : 'locked';
        return `<li class="cl-venue ${state}" style="--i:${i}">
          <div class="cl-vhead"><span class="cl-vicon">${venueSvg(v.id, 22)}</span><span class="cl-tag">${state === 'done' ? 'Played' : state === 'here' ? 'You are here' : 'Locked'}</span></div>
          <b>${esc(v.name)}</b><span class="cl-who">${esc(v.who)}</span>
          <span class="cl-unl">${esc(v.unlocks[0])}${v.unlocks.length > 1 ? ` +${v.unlocks.length - 1} more` : ''}</span></li>`;
      }).join('')}</ol>
      <div class="cl-gig">
        <div><span class="cl-kick">${gp.last ? 'Headline slot' : `Tonight's gig · ${esc(venueById(career.venue).name)}`}</span>
          <b>${gp.last ? 'You made it. Keep the main room dancing.' : gp.booked ? `You're booked at ${esc(gp.next.name)}` : `Play ${GIG.mixes} mixes with ${GIG.stars} stars or more`}</b>
          <div class="pv-gigbars">${Array.from({ length: gp.of }, (_, i) => `<i class="${i < gp.done ? 'on' : ''}"></i>`).join('')}</div></div>
        ${gp.booked ? '<button class="cl-go" data-cl="booked">See the booking</button>' : '<button class="cl-go" data-cl="close">Start the gig</button>'}
      </div>
      <p class="cl-foot">${career.mixes ? `${plural(career.mixes, 'mix')} so far · ${career.stars} stars · best streak ${career.best}` : 'Your first mix starts the journey.'}</p>
    </div>`;
    showLayer();
  }

  function openBooked() {
    const career = api.career(); if (!career.offer) return;
    const v = venueById(career.offer), from = venueById(career.venue);
    const name = api.djName();
    layer.innerHTML = `<div class="cl-card cl-booked" role="dialog" aria-modal="true" aria-labelledby="clBookTitle">
      <div class="cl-poster" data-venue="${v.id}">
        <span class="cl-pk">FRIDAY · LIVE DJ</span>
        <div><b class="cl-pv">${esc(v.name)}</b><span class="cl-pf">featuring</span><b class="cl-pn" data-cl-pn>DJ ${esc(name || 'You')}</b></div>
        <span class="cl-pk">DOORS 9PM</span>
      </div>
      <div class="cl-bk">
        <span class="cl-kick ok">Gig complete · ${esc(from.name)}</span>
        <h2 id="clBookTitle">You've been booked</h2>
        <p class="cl-lead">${esc(from.name)} loved it. ${esc(v.name)} wants you next. ${esc(v.who)}</p>
        <label class="cl-name">Your DJ name<input type="text" data-cl-name maxlength="24" value="${esc(name)}" placeholder="Type a name for the poster" spellcheck="false"></label>
        <div class="cl-new"><span class="cl-kick">New at this venue</span><ul>${v.unlocks.map((u) => `<li>${icon('sparkle', 15)}${esc(u)}</li>`).join('')}</ul>
          ${v.level !== from.level ? '<p class="cl-quiet">The coach gets quieter here: shorter tips, and more of it is up to you.</p>' : ''}</div>
        <div class="cl-acts"><button class="cl-go" data-cl="take">Take the gig</button><button class="cl-ghost" data-cl="close">Stay at ${esc(from.name.replace(/^Your /, 'your '))} a bit longer</button></div>
      </div>
    </div>`;
    showLayer();
    $('[data-cl-name]', layer).focus();
  }

  function showLayer() { layer.classList.remove('hidden'); }
  function closeLayer() { layer.classList.add('hidden'); layer.innerHTML = ''; }
  layer.addEventListener('click', (e) => {
    if (e.target === layer) return closeLayer();
    const b = e.target.closest('[data-cl]'); if (!b) return;
    const a = b.dataset.cl;
    if (a === 'close') return closeLayer();
    if (a === 'booked') return openBooked();
    if (a === 'take') { closeLayer(); api.takeBooking(); }
  });
  layer.addEventListener('input', (e) => {
    if (!e.target.matches('[data-cl-name]')) return;
    api.setDjName(e.target.value.trim());
    const pn = $('[data-cl-pn]', layer); if (pn) pn.textContent = `DJ ${e.target.value.trim() || 'You'}`;
  });
  layer.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); closeLayer(); } });

  return {
    update, showResult, openMap, openBooked, closeLayer, setVenue, openPicker, closePicker,
    slots: { coach: el('coachslot'), lane: el('laneslot'), packChips: el('packchips'), packScene: el('packscene') },
    pickerOpen: () => !!st.picker,
    incoming: () => st.roles.inc,
    resetVibe: () => { st.vibe = 0.55; },
    layerOpen: () => !layer.classList.contains('hidden'),
  };
}
