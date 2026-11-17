import { parseRekordboxXML, demoLibrary, keyRelation, toCamelot } from './library.js';
import { suggestNext, scoreCandidate, structureFromEnergy, structureFromPhrases, mixInPoints, planTransition, barAt, timeOfBar, barLen, beatLen, fmtTime, pitchNeeded } from './engine.js';
import { ctx, Deck, setCrossfader, beatmatch, barEnergy, estimateGrid, synthDemoTrack } from './audio.js';
import * as midi from './midi.js';

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const store = { get(k, d) { try { return localStorage.getItem(k) ?? d; } catch { return d; } }, set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } }, del(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } } };

const state = {
  library: [], played: new Set(), history: [], direction: 'hold',
  files: new Map(), // fileName (lowercase) → FileSystemFileHandle
  chosenIn: { A: null, B: null }, xf: 0.5, lastMaster: null, apiKey: '',
  helper: null, rbNow: null, rbHistory: [], // rekordbox helper connection
};
const HELPER = 'http://127.0.0.1:8765';
const desktop = window.cueDesktop || null; // set by the desktop app's preload
const decks = { A: new Deck('A'), B: new Deck('B') };
const phraseBars = () => +$('#phrase').value;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.remove('show'), 2600); }

// ---------- Deck UI ----------
function buildDeckUI(id) {
  const el = $(`#deck${id}`);
  el.innerHTML = `
    <div class="title">Deck ${id} — empty</div><div class="artist">Load a track from the library or drop an audio file here</div>
    <div class="stats">
      <div><small>BPM</small><span data-f="bpm">–</span></div>
      <div><small>Pitch</small><span data-f="pitch">0.0%</span></div>
      <div><small>Key</small><span data-f="key">–</span></div>
      <div><small>Bar</small><span data-f="bar">–</span></div>
      <div><small>Time</small><span data-f="time">–</span></div>
      <div><small>Beat</small><div class="beats" style="margin-top:6px"><i class="one"></i><i></i><i></i><i></i></div></div>
    </div>
    <canvas class="wave" width="1200" height="220"></canvas>
    <canvas class="overview" width="1200" height="88" title="Click to jump (snaps to the bar)"></canvas>
    <div class="controls">
      <button data-a="play">▶ Play</button>
      <button data-a="cue" title="Back to the chosen start point">⏮ Cue</button>
      <button data-a="nudge-" title="Hold to slow down (like touching the jog wheel)">◀ Nudge</button>
      <button data-a="nudge+" title="Hold to speed up">Nudge ▶</button>
      <label>Tempo <span data-f="tempoVal">0.00%</span><input data-a="tempo" type="range" min="-8" max="8" step="0.02" value="0"></label>
      <label>Bass EQ<input data-a="low" type="range" min="-30" max="6" step="1" value="0"></label>
      <button data-a="kill" title="Cut the bass">Bass kill</button>
      <label>Volume<input data-a="vol" type="range" min="0" max="1" step="0.01" value="0.9"></label>
    </div>
    <div class="drop">Drop an audio file here</div>`;
  const d = decks[id];
  d.setVolume(0.9);
  const on = (a, ev, fn) => $(`[data-a="${a}"]`, el).addEventListener(ev, fn);
  on('play', 'click', () => { d.toggle(); });
  on('cue', 'click', () => { const p = state.chosenIn[id]; d.seek(p ? p.time : d.track?.grid?.firstDownbeat || 0); d.stop(); });
  for (const [a, b] of [['nudge-', -0.04], ['nudge+', 0.04]]) {
    on(a, 'pointerdown', () => d.setBend(b));
    for (const e of ['pointerup', 'pointerleave']) on(a, e, () => d.bend && d.setBend(0));
  }
  on('tempo', 'input', (e) => d.setTempo(+e.target.value));
  on('tempo', 'dblclick', (e) => { e.target.value = 0; d.setTempo(0); });
  on('low', 'input', (e) => { d.setLowEQ(+e.target.value); $('[data-a="kill"]', el).classList.toggle('on', +e.target.value <= -25); });
  on('kill', 'click', (e) => { const killed = d.low.gain.value <= -25; const v = killed ? 0 : -30; d.setLowEQ(v); $('[data-a="low"]', el).value = v; e.target.classList.toggle('on', !killed); });
  on('vol', 'input', (e) => d.setVolume(+e.target.value));
  $('canvas.overview', el).addEventListener('click', (e) => {
    if (!d.buffer) return;
    const r = e.target.getBoundingClientRect();
    let t = (e.clientX - r.left) / r.width * d.buffer.duration;
    if (d.track.grid) t = timeOfBar(d.track.grid, Math.max(1, Math.round((t - d.track.grid.firstDownbeat) / barLen(d.track.grid)) + 1));
    d.seek(t);
  });
  el.addEventListener('dragover', (e) => { e.preventDefault(); el.classList.add('dragover'); });
  el.addEventListener('dragleave', () => el.classList.remove('dragover'));
  el.addEventListener('drop', (e) => {
    e.preventDefault(); el.classList.remove('dragover');
    const f = e.dataTransfer.files[0]; if (f) loadFile(id, f);
  });
}

async function loadTrack(id, track) {
  const d = decks[id], el = $(`#deck${id}`);
  $('.title', el).textContent = `Loading ${track.title}…`;
  try {
    let buffer;
    if (track.helper && state.helper && !track.detailed) {
      const detail = await (await fetch(`${HELPER}/track/${encodeURIComponent(track.id)}`)).json();
      Object.assign(track, detail, { camelot: toCamelot(detail.key), detailed: true });
    }
    if (track.demo) buffer = synthDemoTrack(track);
    else {
      const h = state.files.get((track.fileName || '').toLowerCase());
      if (!h && track.helper && state.helper) {
        const r = await fetch(`${HELPER}/audio/${encodeURIComponent(track.id)}`);
        if (!r.ok) throw new Error((await r.json()).error || `audio ${r.status}`);
        buffer = await ctx.decodeAudioData(await r.arrayBuffer());
      } else if (!h) {
        // Still useful without audio: show plan & suggestions from metadata.
        d.load(track, null, null); state.chosenIn[id] = null; renderDeckHeader(id);
        toast(`No audio for "${track.title}". Link your music folder or drop the file on deck ${id}.`);
        return refreshAll();
      }
      else buffer = await ctx.decodeAudioData(await (await h.getFile()).arrayBuffer());
    }
    finishLoad(id, track, buffer);
  } catch (err) {
    console.error(err); toast(`Could not load: ${err.message}`); renderDeckHeader(id);
  }
}

async function loadFile(id, file) {
  $(`#deck${id} .title`).textContent = `Analysing ${file.name}…`;
  try {
    const buffer = await ctx.decodeAudioData(await file.arrayBuffer());
    let track = state.library.find((t) => t.fileName && t.fileName.toLowerCase() === file.name.toLowerCase());
    if (!track) {
      const grid = estimateGrid(buffer);
      track = { id: `file-${file.name}`, title: file.name.replace(/\.[^.]+$/, ''), artist: 'Not in library — BPM estimated', genre: '', bpm: grid.bpm, key: '', camelot: null, duration: buffer.duration, rating: 0, energy: null, grid, cues: [], fileName: file.name };
      toast(`Estimated ${grid.bpm} BPM. Import your rekordbox XML for exact beat grids and keys.`);
    }
    finishLoad(id, track, buffer);
  } catch (err) { console.error(err); toast(`Could not decode ${file.name}: ${err.message}`); renderDeckHeader(id); }
}

function finishLoad(id, track, buffer) {
  const d = decks[id];
  let analysis = null;
  if (track.grid?.approx) {
    // BPM from rekordbox but no beat-grid file: find where the beats start from the audio.
    const est = estimateGrid(buffer);
    if (Math.abs(est.bpm - track.grid.bpm) < 0.5) track.grid = { bpm: track.grid.bpm, firstDownbeat: est.firstDownbeat, approx: true };
  }
  if (track.grid) {
    const e = barEnergy(buffer, track.grid);
    // Prefer rekordbox's own phrase analysis; fall back to guessing from the bass energy.
    analysis = { barEnergy: e, structure: structureFromPhrases(track.phrases, track.grid) || structureFromEnergy(e, phraseBars()) };
  }
  d.load(track, buffer, analysis);
  d.setTempo(+$(`#deck${id} [data-a="tempo"]`).value);
  const pts = mixInPoints(track, analysis, phraseBars());
  state.chosenIn[id] = pts[0] || null;
  if (pts[0]) d.offset = pts[0].time;
  renderDeckHeader(id); refreshAll();
}

function renderDeckHeader(id) {
  const t = decks[id].track, el = $(`#deck${id}`);
  $('.title', el).textContent = t ? t.title : `Deck ${id} — empty`;
  $('.artist', el).textContent = t ? [t.artist, t.genre].filter(Boolean).join(' · ') : 'Load a track from the library or drop an audio file here';
  $('[data-f="key"]', el).textContent = t?.camelot || t?.key || '–';
}

// ---------- Master / now playing ----------
function masterId() {
  const a = decks.A, b = decks.B;
  if (a.playing && b.playing) return state.xf <= 0.5 ? 'A' : 'B';
  if (a.playing) return 'A';
  if (b.playing) return 'B';
  return state.lastMaster || (a.track ? 'A' : b.track ? 'B' : null);
}
const otherId = (id) => (id === 'A' ? 'B' : 'A');

/** The track that is playing "for real": rekordbox's (via the helper) or the live deck here. */
function currentTrack() {
  if (state.helper && state.rbNow) return { track: state.rbNow, where: 'rekordbox' };
  if (state.mode === 'panel') return state.manualNow ? { track: state.manualNow, where: 'manual' } : null;
  const m = masterId();
  return m && decks[m].track ? { track: decks[m].track, where: m } : null;
}

function updateMaster() {
  const m = masterId();
  if (m && m !== state.lastMaster) {
    const prev = state.lastMaster && decks[state.lastMaster].track;
    if (prev && !state.played.has(prev.id)) { state.played.add(prev.id); state.history.push(prev); }
    state.lastMaster = m; refreshAll();
  }
  const cur = currentTrack(), t = cur?.track;
  const where = cur?.where === 'rekordbox' ? 'in <b>rekordbox</b>' : cur?.where === 'manual' ? '(set by you)' : `on <b>${cur?.where}</b>`;
  const bpm = cur && decks[cur.where] ? decks[cur.where].bpm : t?.bpm;
  $('#nowPlaying').innerHTML = (state.helper ? '<span style="color:var(--ok)">● rekordbox</span> · ' : '') +
    (t ? `Now playing ${where}: <b>${esc(t.title)}</b> — ${esc(t.artist)} · ${(bpm || 0).toFixed(1)} BPM · ${esc(t.camelot || '?')}` : 'No track playing');
}

// ---------- Suggestions ----------
let lastSugg = [];
function renderSuggestions() {
  const m = masterId() || 'A', cur = currentTrack()?.track, box = $('#sugg');
  if (!cur) { box.innerHTML = '<div class="muted">Pick or play a track to get suggestions.</div>'; lastSugg = []; return; }
  if (!state.library.length) { box.innerHTML = '<div class="muted">Import your rekordbox XML (or the demo library) to get suggestions.</div>'; lastSugg = []; return; }
  lastSugg = suggestNext(cur, state.library, { played: new Set([...state.played, ...state.rbHistory, decks.A.track?.id, decks.B.track?.id]), direction: state.direction, limit: 25 });
  box.innerHTML = lastSugg.slice(0, 6).map((s) => `
    <div class="row">
      <div><div><b>${esc(s.track.title)}</b> <span class="muted">— ${esc(s.track.artist)}</span></div>
      <div class="meta">${esc(s.track.genre)} · ${s.track.bpm.toFixed(1)} BPM · ${s.reasons.map(esc).join(' · ')}</div></div>
      <div style="display:flex;gap:6px;align-items:center"><span class="score">${Math.round(s.score * 100)}</span>
      <button class="practice-only" data-load="${esc(s.track.id)}" data-deck="${otherId(m)}">Load ${otherId(m)}</button>
      <button class="panel-only" data-next="${esc(s.track.id)}">${state.nextId === s.track.id ? '✓ Next' : 'Set next'}</button></div>
    </div>`).join('') || '<div class="muted">Nothing compatible found.</div>';
}

// ---------- Transition plan ----------
function renderPlan() {
  const box = $('#plan');
  const m = masterId(); if (!m) { box.innerHTML = '<span class="muted">Load the playing track on one deck and the next track on the other.</span>'; return; }
  const o = otherId(m), A = decks[m], B = decks[o];
  if (!A.track || !B.track) { box.innerHTML = `<span class="muted">Deck ${m} is playing. Load the next track on deck ${o} — use a suggestion on the right.</span>`; return; }
  if (!A.track.grid || !B.track.grid) { box.innerHTML = '<span class="muted">Both tracks need a beat grid (BPM) to plan a mix.</span>'; return; }
  const plan = planTransition(A.track, B.track, A.analysis, B.analysis, phraseBars(), state.chosenIn[o]?.time);
  const inPts = mixInPoints(B.track, B.analysis, phraseBars());
  const chosen = state.chosenIn[o] && inPts.find((p) => Math.abs(p.time - state.chosenIn[o].time) < 0.05) || inPts[0];
  state.chosenIn[o] = chosen;
  const p = pitchNeeded(A.bpm, B.track.bpm);
  const key = keyRelation(A.track.camelot, B.track.camelot);
  box.dataset.outTime = plan.outTime; box.dataset.blend = plan.blendBars; box.dataset.m = m;
  box.innerHTML = `
    <div>Mix <b style="color:var(--${m.toLowerCase()})">${esc(A.track.title)}</b> → <b style="color:var(--${o.toLowerCase()})">${esc(B.track.title)}</b></div>
    <div class="muted" style="margin-top:4px">Set deck ${o} tempo to <b>${p.pct >= 0 ? '+' : ''}${p.pct.toFixed(2)}%</b>${p.mode !== '1x' ? ` (${p.mode} time)` : ''} · keys: ${esc(key.label)} · ${plan.blendBars}-bar blend</div>
    <div class="countdown" id="countdown">–</div>
    <div class="muted" style="font-size:12px">Mix-out on ${m}: bar ${plan.outBar} (${fmtTime(plan.outTime)}) — ${esc(plan.outWhy)}</div>
    <div style="margin-top:8px" class="muted">Start ${o} from:</div>
    <div class="points">${inPts.map((pt) => `<button data-in="${pt.time}" class="${pt === chosen ? 'sel' : ''}">${esc(pt.label)} · bar ${pt.bar}<small>${fmtTime(pt.time)} — ${esc(pt.detail)}</small></button>`).join('')}</div>
    <ol class="steps" id="steps">${plan.steps.map((s) => `<li data-bars="${s.bars}"><span class="t">+${s.bars} bars<br>${fmtTime(s.a)}</span><span>${esc(s.text.replace(/\{IN\}/g, o).replace(/\{OUT\}/g, m))}</span></li>`).join('')}</ol>`;
}

function tickPlan() {
  const box = $('#plan'); if (!box.dataset.outTime || box.dataset.m !== masterId()) return;
  const m = box.dataset.m, A = decks[m], g = A.track?.grid; if (!g || !$('#countdown')) return;
  const pos = A.position(), out = +box.dataset.outTime;
  const secs = (out - pos) / A.rate, bars = (out - pos) / barLen(g);
  const cd = $('#countdown');
  if (secs > 0) cd.textContent = `Press play on ${otherId(m)} in ${secs.toFixed(1)} s · ${Math.ceil(bars)} bars`;
  else cd.textContent = `In the mix: bar ${Math.floor(-bars) + 1} of ${box.dataset.blend}`;
  cd.style.color = secs > 0 && bars <= 4 ? 'var(--warn)' : '';
  const into = -bars;
  for (const li of box.querySelectorAll('#steps li')) {
    const b = +li.dataset.bars;
    li.classList.toggle('done', into > b + 0.01 && b !== +box.dataset.blend);
    li.classList.toggle('active', into >= b - 0.5 && into < b + 4);
  }
}

// ---------- Library ----------
function renderLibrary() {
  const q = $('#search').value.trim().toLowerCase();
  const cur = currentTrack()?.track;
  const rows = state.library.filter((t) => !q || `${t.title} ${t.artist} ${t.genre} ${t.camelot}`.toLowerCase().includes(q)).slice(0, 500);
  $('#libCount').textContent = state.library.length ? `${state.library.length} tracks` : '';
  $('#libBody').innerHTML = rows.map((t) => {
    let match = '';
    if (cur && cur.id !== t.id) {
      const k = keyRelation(cur.camelot, t.camelot), p = pitchNeeded(cur.bpm, t.bpm);
      const cls = k.score >= 0.85 && Math.abs(p.pct) <= 4 ? 'k-good' : k.score >= 0.55 && Math.abs(p.pct) <= 6 ? 'k-mid' : 'k-bad';
      match = `<span class="pill ${cls}" title="${esc(k.label)}">${esc(k.label.split(' ·')[0])} · ${p.pct >= 0 ? '+' : ''}${p.pct.toFixed(1)}%</span>`;
    }
    const playing = decks.A.track?.id === t.id || decks.B.track?.id === t.id;
    return `<tr class="${playing ? 'playing' : state.played.has(t.id) || state.rbHistory.includes(t.id) ? 'played' : ''}">
      <td class="t"><b>${esc(t.title)}</b><br><span class="muted">${esc(t.artist)}</span></td><td class="c-genre">${esc(t.genre)}</td><td>${t.bpm ? t.bpm.toFixed(1) : '–'}</td>
      <td>${esc(t.camelot || t.key || '–')}</td><td class="c-energy">${t.energy ?? '–'}</td><td class="c-rating">${'★'.repeat(t.rating || 0)}</td><td>${match}</td>
      <td><div class="rowbtns"><button class="practice-only" data-load="${esc(t.id)}" data-deck="A">A</button><button class="practice-only" data-load="${esc(t.id)}" data-deck="B">B</button>
      ${state.helper ? '' : `<button class="panel-only" data-now="${esc(t.id)}" title="Mark as playing now">Now</button>`}<button class="panel-only" data-next="${esc(t.id)}" title="Plan the mix into this track">Next</button></div></td></tr>`;
  }).join('') || `<tr><td colspan="8" class="muted">${state.library.length ? 'No matches.' : 'Import your rekordbox collection (File → Export Collection in xml format) or load the demo library.'}</td></tr>`;
}

function refreshAll() { renderLibrary(); renderSuggestions(); renderPlan(); renderPanel(); }

// ---------- Side panel (sits next to rekordbox) ----------
const PHRASE_COLOR = { Intro: '#5aa9ff', Up: '#b892ff', Down: '#46d68c', Chorus: '#ff6b78', Outro: '#5aa9ff', Bridge: '#9aa3b2' };
const phraseColor = (label) => PHRASE_COLOR[label] || (label.startsWith('Verse') ? '#ffcc4d' : '#7d8596');

async function ensureDetail(track) {
  if (!track?.helper || !state.helper || track.detailed) return track;
  try {
    const detail = await (await fetch(`${HELPER}/track/${encodeURIComponent(track.id)}`)).json();
    Object.assign(track, detail, { camelot: toCamelot(detail.key), detailed: true });
  } catch { /* keep the basic data */ }
  return track;
}

/** Coloured phrase bar for a track, with optional markers [{time, label}]. */
function phraseStrip(track, markers = []) {
  const dur = track.duration || (track.phrases?.length ? track.phrases[track.phrases.length - 1].end : 0);
  if (!dur) return '';
  const g = track.grid;
  let blocks;
  if (track.phrases?.length) {
    blocks = track.phrases.map((p) => `<div style="width:${((p.end - p.start) / dur * 100).toFixed(2)}%;background:${phraseColor(p.label)}" title="${esc(p.label)} · ${fmtTime(p.start)}">${esc(p.label)}</div>`);
    const lead = track.phrases[0].start / dur * 100;
    if (lead > 0.3) blocks.unshift(`<div style="width:${lead.toFixed(2)}%;background:#3a404c"></div>`);
  } else if (g) {
    // no phrase analysis: show 16-bar blocks
    const pl = barLen(g) * 16; blocks = [];
    for (let t = g.firstDownbeat, i = 0; t < dur; t += pl, i++) blocks.push(`<div style="width:${(Math.min(pl, dur - t) / dur * 100).toFixed(2)}%;background:${i % 2 ? '#454c5a' : '#3a404c'};color:var(--muted)">${i * 16 + 1}</div>`);
  } else return '';
  const marks = markers.map((m) => `<span class="mark" style="left:calc(${(m.time / dur * 100).toFixed(2)}% - 1px)" title="${esc(m.label)}"></span>`).join('');
  return `<div class="strip">${blocks.join('')}${marks}</div><div class="strip-scale"><span>0:00</span><span>${fmtTime(dur).replace(/\.\d$/, '')}</span></div>`;
}

function structureOf(track) {
  return track.grid ? { structure: structureFromPhrases(track.phrases, track.grid) } : null;
}

let panelToken = 0;
async function renderPanel() {
  if (state.mode !== 'panel') return;
  const token = ++panelToken;
  const cur = currentTrack()?.track;
  const next = state.library.find((t) => t.id === state.nextId) || lastSugg[0]?.track || null;
  await Promise.all([ensureDetail(cur), ensureDetail(next)]);
  if (token !== panelToken) return;
  const nowBox = $('#pvNow'), nextBox = $('#pvNext');
  nowBox.className = 'panel card now'; nextBox.className = 'panel card next';
  const source = state.helper ? '<span style="color:var(--ok)">● from rekordbox</span>' : '<span>set by you</span>';
  if (!cur) {
    nowBox.innerHTML = `<div class="eyebrow"><span>Now playing</span></div><div class="empty">${state.helper
      ? 'Waiting for rekordbox — play a track and it appears here once rekordbox adds it to its history.'
      : state.library.length ? 'Press <b>Now</b> on the track you are playing (Library below), or connect rekordbox.' : 'Connect rekordbox, or load the demo library from the ☰ menu.'}</div>`;
    nextBox.innerHTML = '<div class="eyebrow"><span>Up next</span></div><div class="empty">Suggestions and a mix plan appear once a track is playing.</div>';
    return;
  }
  const plan = next && cur.grid && next.grid ? planTransition(cur, next, structureOf(cur), structureOf(next), phraseBars(), state.panelIn) : null;
  nowBox.innerHTML = `
    <div class="eyebrow"><span>Now playing</span>${source}</div>
    <div class="big">${esc(cur.title)}</div><div class="sub">${esc([cur.artist, cur.genre].filter(Boolean).join(' · '))}</div>
    <div class="chips"><span class="chip"><b>${(cur.bpm || 0).toFixed(1)}</b> BPM</span><span class="chip"><b>${esc(cur.camelot || cur.key || '?')}</b></span>${cur.energy != null ? `<span class="chip">Energy <b>${cur.energy}</b></span>` : ''}${cur.grid?.approx ? '<span class="chip" title="No beat grid file — bars are approximate">grid ≈</span>' : ''}</div>
    ${phraseStrip(cur, plan ? [{ time: plan.outTime, label: 'Mix out' }] : [])}
    ${plan ? `<div class="callout">Start the next track at <b>bar ${plan.outBar}</b> · ${fmtTime(plan.outTime)} <span class="muted">— ${esc(plan.outWhy)}</span></div>` : ''}`;
  if (!next) { nextBox.innerHTML = '<div class="eyebrow"><span>Up next</span></div><div class="empty">Nothing compatible found in your library.</div>'; return; }
  const sc = scoreCandidate(cur, next, { direction: state.direction });
  const inPts = mixInPoints(next, structureOf(next), phraseBars());
  const chosen = plan?.inPoint;
  const tagIn = (txt) => txt.replace(/\{IN\}/g, 'the new track').replace(/\{OUT\}/g, 'the playing track').replace(/(^|\. )([a-z])/g, (_, a, c) => a + c.toUpperCase());
  nextBox.innerHTML = `
    <div class="eyebrow"><span>Up next ${state.nextId ? '' : '· top suggestion'}</span><span class="score">${Math.round(sc.score * 100)}</span></div>
    <div class="big">${esc(next.title)}</div><div class="sub">${esc([next.artist, next.genre].filter(Boolean).join(' · '))}</div>
    <div class="chips"><span class="chip"><b>${esc(next.camelot || '?')}</b> ${esc(sc.key.label)}</span>
      ${sc.pitch.pct != null ? `<span class="chip">Tempo <b>${sc.pitch.pct >= 0 ? '+' : ''}${sc.pitch.pct.toFixed(1)}%</b>${sc.pitch.mode !== '1x' ? ` (${sc.pitch.mode})` : ''}</span>` : ''}
      ${plan ? `<span class="chip"><b>${plan.blendBars}</b>-bar blend</span>` : ''}</div>
    ${phraseStrip(next, chosen ? [{ time: chosen.time, label: 'Start here' }] : [])}
    ${inPts.length ? `<div class="muted" style="font-size:12px;margin-top:6px">Start it from:</div><div class="points">${inPts.map((pt) => `<button data-pin="${pt.time}" class="${chosen && pt.time === chosen.time ? 'sel' : ''}">${esc(pt.label)} · bar ${pt.bar}<small>${fmtTime(pt.time)}</small></button>`).join('')}</div>` : ''}
    ${plan ? `<details class="pv-plan" ${state.stepsOpen === false ? '' : 'open'}><summary class="muted" style="font-size:12px;margin-top:8px;cursor:pointer">Mix steps (times on the playing track)</summary><ol class="pv-steps">${plan.steps.map((st) => `<li><span class="t">+${st.bars} bars<br>at ${fmtTime(st.a)}</span><span>${esc(tagIn(st.text))}</span></li>`).join('')}</ol></details>` : '<div class="empty">Both tracks need a BPM to plan the mix.</div>'}`;
  $('.pv-plan', nextBox)?.addEventListener('toggle', (e) => { state.stepsOpen = e.target.open; });
}

function setMode(mode, save = true) {
  state.mode = mode;
  document.body.classList.toggle('sidepanel', mode === 'panel');
  $('#modeBtn').textContent = mode === 'panel' ? 'Switch to practice decks' : 'Switch to side panel';
  if (save) store.set('cuecoach.mode', mode);
  if (desktop && state.modeReady) desktop.setMode(mode); // resize the window to fit the layout
  $('#menu').open = false;
  drawOverview.cache = {};
  refreshAll();
}

// ---------- Drawing ----------
function cssVar(n) { return getComputedStyle(document.documentElement).getPropertyValue(n).trim(); }
const COLORS = {};
function drawWave(id) {
  const d = decks[id], el = $(`#deck${id}`), cv = $('canvas.wave', el), c = cv.getContext('2d');
  const W = cv.width, H = cv.height; c.clearRect(0, 0, W, H);
  if (!d.peaks) return;
  const pos = d.position(), span = 6 * d.rate, t0 = pos - span / 2;
  c.fillStyle = COLORS[id];
  const pk = d.peaks;
  for (let x = 0; x < W; x += 2) {
    const i = Math.floor((t0 + x / W * span) * pk.rate);
    const v = i >= 0 && i < pk.data.length ? pk.data[i] : 0;
    const h = v * H * 0.9; c.fillRect(x, (H - h) / 2, 2, h);
  }
  const g = d.track.grid;
  if (g) {
    const bl = beatLen(g); let n = Math.ceil((t0 - g.firstDownbeat) / bl);
    for (let t = g.firstDownbeat + n * bl; t < t0 + span; t += bl, n++) {
      const x = (t - t0) / span * W, beatInBar = ((n % 4) + 4) % 4, bar = Math.floor(n / 4) + 1;
      const phrase = beatInBar === 0 && (bar - 1) % phraseBars() === 0;
      c.fillStyle = phrase ? COLORS.phrase : beatInBar === 0 ? 'rgba(255,255,255,.85)' : 'rgba(255,255,255,.25)';
      c.fillRect(x - (phrase ? 1.5 : 0.5), 0, phrase ? 3 : beatInBar === 0 ? 2 : 1, beatInBar === 0 ? H : H * 0.18);
      if (beatInBar === 0) { c.fillStyle = 'rgba(255,255,255,.6)'; c.font = '20px system-ui'; c.fillText(String(bar), x + 4, 20); }
    }
  }
  c.fillStyle = '#fff'; c.fillRect(W / 2 - 1, 0, 3, H);
}

function drawOverview(id) {
  const d = decks[id], cv = $(`#deck${id} canvas.overview`), c = cv.getContext('2d');
  const W = cv.width, H = cv.height; c.clearRect(0, 0, W, H);
  if (!d.peaks) return;
  const dur = d.buffer.duration, pk = d.peaks;
  if (!drawOverview.cache) drawOverview.cache = {};
  const key = `${id}:${d.track.id}`;
  if (drawOverview.cache[id]?.key !== key) {
    const off = document.createElement('canvas'); off.width = W; off.height = H; const o = off.getContext('2d');
    const per = pk.data.length / W;
    o.fillStyle = COLORS[id]; o.globalAlpha = 0.75;
    for (let x = 0; x < W; x++) { let m = 0; for (let i = Math.floor(x * per); i < (x + 1) * per; i++) m = Math.max(m, pk.data[i] || 0); o.fillRect(x, H - m * H * 0.9, 1, m * H * 0.9); }
    const g = d.track.grid;
    if (g) { o.globalAlpha = 1; o.fillStyle = COLORS.phrase; const pl = barLen(g) * phraseBars(); for (let t = g.firstDownbeat; t < dur; t += pl) o.fillRect(t / dur * W, 0, 1, H * 0.3); }
    drawOverview.cache[id] = { key, off };
  }
  c.drawImage(drawOverview.cache[id].off, 0, 0);
  // markers: chosen start (other deck) / mix-out (master)
  const m = masterId(), box = $('#plan');
  c.fillStyle = COLORS.warn;
  if (id === m && box.dataset.outTime && box.dataset.m === id) { const x = +box.dataset.outTime / dur * W; c.fillRect(x - 1, 0, 3, H); }
  if (id !== m && state.chosenIn[id]) { const x = state.chosenIn[id].time / dur * W; c.fillRect(x - 1, 0, 3, H); }
  c.fillStyle = '#fff'; c.fillRect(d.position() / dur * W - 1, 0, 2, H);
}

function drawMeter(bm) {
  const cv = $('#meter'), c = cv.getContext('2d'), W = cv.width, H = cv.height;
  c.clearRect(0, 0, W, H);
  c.fillStyle = '#0a0c10'; c.fillRect(0, 0, W, H);
  c.fillStyle = 'rgba(61,220,132,.18)'; c.fillRect(W / 2 - W * 0.04, 0, W * 0.08, H);
  c.fillStyle = 'rgba(255,255,255,.3)'; c.fillRect(W / 2, 0, 1, H);
  c.font = '18px system-ui'; c.fillStyle = 'rgba(255,255,255,.45)';
  c.fillText('behind', 8, H - 10); c.fillText('ahead', W - 58, H - 10);
  if (!bm || !bm.both) return;
  const x = W / 2 + bm.phase * W;
  c.fillStyle = Math.abs(bm.phase) < 0.04 ? COLORS.ok : COLORS.warn;
  c.fillRect(x - 5, 8, 10, H - 16);
}

let lastText = 0;
function frame(now) {
  for (const id of ['A', 'B']) {
    drawWave(id); drawOverview(id);
    const d = decks[id], el = $(`#deck${id}`), g = d.track?.grid;
    const ph = d.barPhase(), beat = ph == null ? -1 : Math.floor(ph * 4);
    el.querySelectorAll('.beats i').forEach((b, i) => b.classList.toggle('lit', d.playing && i === beat));
    if (now - lastText > 100) {
      $('[data-f="bpm"]', el).textContent = d.bpm ? d.bpm.toFixed(2) : '–';
      $('[data-f="pitch"]', el).textContent = `${d.tempoPct >= 0 ? '+' : ''}${d.tempoPct.toFixed(2)}%`;
      $('[data-f="tempoVal"]', el).textContent = `${d.tempoPct >= 0 ? '+' : ''}${d.tempoPct.toFixed(2)}%`;
      $('[data-f="bar"]', el).textContent = g ? Math.max(1, barAt(g, d.position())) : '–';
      $('[data-f="time"]', el).textContent = d.track ? `${fmtTime(d.position())} / ${fmtTime(d.buffer?.duration || d.track.duration)}` : '–';
      $('[data-a="play"]', el).textContent = d.playing ? '⏸ Pause' : '▶ Play';
    }
  }
  const m = masterId();
  const bm = m ? beatmatch(decks[m], decks[otherId(m)]) : null;
  drawMeter(bm);
  if (now - lastText > 100) {
    lastText = now;
    updateMaster(); tickPlan();
    $('#advice').innerHTML = bm ? [
      `<div class="${Math.abs(bm.bpmDiff) <= 0.05 ? 'good' : 'warn'}">${esc(bm.tempoAdvice)}</div>`,
      `<div class="${bm.phaseAdvice.includes('✓') ? 'good' : bm.both ? 'warn' : 'muted'}">${bm.both ? esc(bm.phaseAdvice) : 'Play both decks to check the beats'}</div>`,
      bm.barAdvice ? `<div class="${bm.barAdvice.includes('✓') ? 'good' : 'warn'}">${esc(bm.barAdvice)}</div>` : '',
    ].join('') : '<div class="muted">Load a track on both decks and press play.</div>';
  }
  requestAnimationFrame(frame);
}

// ---------- Wiring ----------
function setLibrary(tracks, label) {
  state.library = tracks; state.played.clear(); state.history = [];
  state.manualNow = null; state.nextId = null; state.panelIn = null; $('#menu').open = false;
  toast(`${label}: ${tracks.length} tracks`); refreshAll();
}

document.addEventListener('click', (e) => {
  const nb = e.target.closest('[data-next]');
  if (nb) { state.nextId = nb.dataset.next; state.panelIn = null; renderSuggestions(); renderPanel(); $('#panelView').scrollIntoView({ behavior: 'smooth' }); return; }
  const nw = e.target.closest('[data-now]');
  if (nw) {
    const t = state.library.find((x) => x.id === nw.dataset.now);
    if (state.manualNow && state.manualNow.id !== t.id) { state.played.add(state.manualNow.id); state.history.push(state.manualNow); }
    state.manualNow = t; if (state.nextId === t.id) state.nextId = null; state.panelIn = null;
    refreshAll(); $('#panelView').scrollIntoView({ behavior: 'smooth' }); return;
  }
  const pb = e.target.closest('[data-pin]');
  if (pb) { state.panelIn = +pb.dataset.pin; renderPanel(); return; }
  const lb = e.target.closest('[data-load]');
  if (lb) { const t = state.library.find((x) => x.id === lb.dataset.load); if (t) loadTrack(lb.dataset.deck, t); return; }
  const ib = e.target.closest('[data-in]');
  if (ib) {
    const o = otherId($('#plan').dataset.m || masterId());
    const pts = mixInPoints(decks[o].track, decks[o].analysis, phraseBars());
    state.chosenIn[o] = pts.find((p) => Math.abs(p.time - +ib.dataset.in) < 0.01);
    if (!decks[o].playing) decks[o].seek(+ib.dataset.in);
    renderPlan();
  }
});
$('#importBtn').addEventListener('click', () => $('#xmlFile').click());
$('#xmlFile').addEventListener('change', async (e) => {
  const f = e.target.files[0]; if (!f) return;
  try { setLibrary(parseRekordboxXML(await f.text()), 'rekordbox'); } catch (err) { toast(err.message); }
});
$('#demoBtn').addEventListener('click', () => { disconnectHelper(); setLibrary(demoLibrary(40), 'Demo library'); });

// ---------- rekordbox helper ----------
let pollTimer = null;
function setConn() { const c = $('#conn'); c.textContent = state.helper ? '● rekordbox' : ''; c.classList.toggle('on', !!state.helper); }
function disconnectHelper() { clearInterval(pollTimer); state.helper = null; state.rbNow = null; state.rbHistory = []; $('#rbBtn').textContent = 'Connect rekordbox'; setConn(); }
async function connectHelper() {
  if (state.helper) { disconnectHelper(); return refreshAll(); }
  try {
    const st = await (await fetch(`${HELPER}/status`)).json();
    const tracks = await (await fetch(`${HELPER}/library`)).json();
    for (const t of tracks) t.camelot = toCamelot(t.key);
    state.helper = HELPER; $('#rbBtn').textContent = 'Disconnect'; setConn();
    setLibrary(tracks, `rekordbox (${st.tracks} tracks)`);
    await pollNowPlaying(); pollTimer = setInterval(pollNowPlaying, 3000);
  } catch (err) {
    console.error(err);
    toast('Could not reach the helper. Start it with: python3 helper/rekordbox_helper.py');
  }
}
async function pollNowPlaying() {
  if (!state.helper) return;
  try {
    const np = await (await fetch(`${HELPER}/now-playing`)).json();
    const id = np.track?.id;
    const changed = id !== state.rbNow?.id || np.history.length !== state.rbHistory.length;
    state.rbHistory = np.history;
    state.rbNow = id ? state.library.find((t) => t.id === id) || { ...np.track, camelot: toCamelot(np.track.key) } : null;
    if (changed && state.rbNow && state.nextId === state.rbNow.id) { state.nextId = null; state.panelIn = null; } // you mixed it in
    if (changed) { if (state.rbNow) toast(`rekordbox: now playing ${state.rbNow.title}`); refreshAll(); }
  } catch { toast('Lost the rekordbox helper — is it still running?'); disconnectHelper(); refreshAll(); }
}
$('#rbBtn').addEventListener('click', connectHelper);
$('#folderBtn').addEventListener('click', async () => {
  if (!window.showDirectoryPicker) return toast('Folder linking needs Chrome or Edge. You can still drop files on a deck.');
  try {
    const dir = await window.showDirectoryPicker({ mode: 'read' });
    let n = 0;
    const walk = async (d, depth) => {
      for await (const [name, h] of d.entries()) {
        if (h.kind === 'file' && /\.(mp3|m4a|aac|wav|aiff?|flac|ogg)$/i.test(name)) { state.files.set(name.toLowerCase(), h); n++; }
        else if (h.kind === 'directory' && depth < 6) await walk(h, depth + 1);
      }
    };
    await walk(dir, 0); toast(`Found ${n} audio files`);
  } catch (err) { if (err.name !== 'AbortError') toast(err.message); }
});
$('#search').addEventListener('input', renderLibrary);
$('#direction').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  state.direction = b.dataset.v;
  for (const x of $('#direction').children) x.classList.toggle('sel', x === b);
  renderSuggestions();
});
$('#xfader').addEventListener('input', (e) => { state.xf = +e.target.value; setCrossfader(decks.A, decks.B, state.xf); });
$('#phrase').addEventListener('change', () => { for (const id of ['A', 'B']) { const d = decks[id]; if (d.analysis) d.analysis.structure = structureFromEnergy(d.analysis.barEnergy, phraseBars()); } drawOverview.cache = {}; refreshAll(); });

// Settings & AI
state.apiKey = store.get('cuecoach.apikey', '');
$('#apiKey').value = state.apiKey; $('#rememberKey').checked = !!state.apiKey;
$('#level').value = store.get('cuecoach.level', 'beginner');
$('#settingsBtn').addEventListener('click', () => $('#settings').showModal());
$('#settingsClose').addEventListener('click', () => {
  state.apiKey = $('#apiKey').value.trim();
  if ($('#rememberKey').checked && state.apiKey) store.set('cuecoach.apikey', state.apiKey); else store.del('cuecoach.apikey');
  store.set('cuecoach.level', $('#level').value);
  $('#settings').close();
});
$('#aiBtn').addEventListener('click', async () => {
  const m = masterId() || 'A', cur = currentTrack()?.track, out = $('#aiOut');
  if (!cur || !lastSugg.length) return toast('Play a track first so the coach knows where you are.');
  if (!state.apiKey) { $('#settings').showModal(); return toast('Add your Anthropic API key first.'); }
  out.hidden = false; out.innerHTML = '<span class="muted">Asking the coach…</span>'; $('#aiBtn').disabled = true;
  try {
    const { askCoach } = await import('./ai.js');
    const r = await askCoach({ apiKey: state.apiKey, current: cur, history: state.helper ? state.rbHistory.map((id) => state.library.find((t) => t.id === id)).filter(Boolean) : state.history, candidates: lastSugg, direction: state.direction, level: $('#level').value });
    out.innerHTML = `<div class="muted">${esc(r.set_note)}</div>` + r.picks.map((p, i) => `
      <div class="pick"><b>${i + 1}. ${esc(p.cand.track.title)}</b> <span class="muted">— ${esc(p.cand.track.artist)}</span>
      <button class="practice-only" data-load="${esc(p.id)}" data-deck="${otherId(m)}" style="float:right">Load ${otherId(m)}</button>
      <button class="panel-only" data-next="${esc(p.id)}" style="float:right">Set next</button>
      <div style="margin-top:4px">${esc(p.why)}</div><div class="muted" style="margin-top:4px">🎛 ${esc(p.transition_tip)}</div></div>`).join('');
  } catch (err) { console.error(err); out.innerHTML = `<span style="color:var(--bad)">AI coach error: ${esc(err.message)}</span>`; }
  finally { $('#aiBtn').disabled = false; }
});

// MIDI
function renderMidiRows() {
  $('#midiRows').innerHTML = midi.ACTIONS.map(([a, label]) => `<div class="midirow"><span>${label} <span class="muted">${midi.binding(a) || ''}</span></span>
    <button data-learn="${a}">Learn</button><button data-clear="${a}">Clear</button></div>`).join('');
}
$('#midiBtn').addEventListener('click', async () => {
  $('#midi').showModal(); renderMidiRows();
  try {
    const names = await midi.initMIDI(onMidi, (msg) => { $('#midiLog').textContent = msg; });
    $('#midiDevices').textContent = names.length ? `Connected: ${names.join(', ')}` : 'No MIDI devices found — plug in your controller.';
  } catch (err) { $('#midiDevices').textContent = err.message; }
});
$('#midiRows').addEventListener('click', async (e) => {
  const l = e.target.closest('[data-learn]'), c = e.target.closest('[data-clear]');
  if (l) { l.textContent = 'Move it…'; await midi.learn(l.dataset.learn); renderMidiRows(); }
  if (c) { midi.clearBinding(c.dataset.clear); renderMidiRows(); }
});
$('#midiClose').addEventListener('click', () => $('#midi').close());
function onMidi(action, v) {
  const [id, ctl] = action.split('.');
  if (action === 'xfader') { $('#xfader').value = v.value; state.xf = v.value; setCrossfader(decks.A, decks.B, v.value); return; }
  const d = decks[id], el = $(`#deck${id}`);
  if (ctl === 'play' && v.pressed) d.toggle();
  if (ctl === 'tempo') { const pct = (v.value * 2 - 1) * 8; $('[data-a="tempo"]', el).value = pct; d.setTempo(pct); }
  if (ctl === 'jog') { d.setBend(Math.max(-0.08, Math.min(0.08, v.rel * 0.01))); clearTimeout(d.jogT); d.jogT = setTimeout(() => d.setBend(0), 80); }
  if (ctl === 'low') { const db = -30 + v.value * 36; $('[data-a="low"]', el).value = db; d.setLowEQ(db); }
  if (ctl === 'vol') { $('[data-a="vol"]', el).value = v.value; d.setVolume(v.value); }
}

// Boot
COLORS.A = cssVar('--a'); COLORS.B = cssVar('--b'); COLORS.phrase = cssVar('--phrase'); COLORS.ok = cssVar('--ok'); COLORS.warn = cssVar('--warn');
buildDeckUI('A'); buildDeckUI('B'); setCrossfader(decks.A, decks.B, 0.5);
refreshAll(); requestAnimationFrame(frame);
// Mode: ?mode=panel|practice, else last used, else side panel when the window is narrow.
const urlMode = new URLSearchParams(location.search).get('mode');
setMode(urlMode === 'panel' || urlMode === 'practice' ? urlMode : store.get('cuecoach.mode', innerWidth < 760 ? 'panel' : 'practice'), !urlMode);
$('#modeBtn').addEventListener('click', () => setMode(state.mode === 'panel' ? 'practice' : 'panel'));
$('#popBtn').addEventListener('click', () => {
  const w = 420, h = screen.availHeight;
  const win = window.open(`${location.pathname}?mode=panel`, 'cuecoach-panel', `popup,width=${w},height=${h},left=${screen.availWidth - w},top=0`);
  if (!win) toast('Your browser blocked the pop-up window — allow pop-ups for this page.');
  $('#menu').open = false;
});
state.modeReady = true;

// ---------- Desktop app (Electron) ----------
async function initDesktop() {
  document.body.classList.add('desktop');
  const pin = $('#pinBtn');
  const keys = desktop.platform === 'darwin' ? '⇧⌘T' : 'Ctrl+Shift+T';
  const showPin = (on) => { pin.classList.toggle('on', on); pin.title = on ? `On top of rekordbox — click to release (${keys})` : `Keep on top of rekordbox (${keys})`; };
  showPin(await desktop.getPinned());
  desktop.onPinned(showPin);
  pin.addEventListener('click', async () => showPin(await desktop.setPinned(!pin.classList.contains('on'))));
  desktop.onSetMode((m) => setMode(m));
  // The desktop app starts the rekordbox helper itself; connect as soon as it's up.
  $('#conn').textContent = 'starting rekordbox…';
  for (let i = 0; i < 40; i++) {
    const st = await desktop.helperStatus();
    if (st.state === 'running') { if (!state.helper) await connectHelper(); return; }
    if (st.state === 'unavailable') { $('#conn').textContent = ''; $('#rbBtn').hidden = true; toast(st.message); return; }
    if (st.state === 'failed' || st.state === 'stopped') {
      $('#conn').textContent = 'rekordbox not connected'; $('#conn').title = st.message;
      toast(`rekordbox helper: ${st.message || 'stopped'}`);
      return;
    }
    await new Promise((r) => setTimeout(r, 750));
  }
  $('#conn').textContent = '';
}
if (desktop) initDesktop();
window.cueCoach = { state, decks }; // handy for debugging in the console
