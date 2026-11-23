// Cue Coach Studio: make dance tracks from loops, laid out so they're easy to DJ with.
// The pure model is studiomodel.js, the sound is studioaudio.js / studiosynth.js, storage is studiostore.js.
import * as S from './studiomodel.js';
import { StudioEngine, usedLanes } from './studioaudio.js';
import * as store from './studiostore.js';
import { icon } from './icons.js';
import { shared, onShared, send } from './libsync.js';
import { aiStatus, aiSetKey, composeTrackAI } from './coachai.js';

const desktop = window.cueDesktop || null;
const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const LANE_VAR = (l) => `var(--l-${l})`;
const HEAD_W = 150;

const engine = new StudioEngine();
let p = null;                 // the open track
let samples = {};             // id → sample
let sel = null;               // { sectionId, lane }
let zoom = shared.get('studio.zoom', 7); // pixels per bar
let undo = [], redo = [];

// ---------- small things ----------
let toastT;
function toast(msg, ms = 3200) {
  const el = $('#toast'); el.textContent = msg; el.classList.remove('gone');
  clearTimeout(toastT); toastT = setTimeout(() => el.classList.add('gone'), ms);
}
function applyTheme() {
  document.documentElement.dataset.theme = shared.get('theme', 'auto');
  const cs = getComputedStyle(document.documentElement);
  desktop?.setChrome?.({ bg: cs.getPropertyValue('--card').trim(), fg: cs.getPropertyValue('--ink').trim() });
}
const openLink = (url) => window.open(url, '_blank', 'noopener');

let saveT;
function changed({ grid = true, keepRedo = false } = {}) {
  p.updated = Date.now();
  clearTimeout(saveT); saveT = setTimeout(() => store.saveProject(p).catch((e) => toast(`Couldn't save: ${e.message}`)), 350);
  if (!keepRedo) redo = [];
  if (grid) renderGrid();
  renderChecks();
  renderCell();
  if (engine.playing) engine.loadSamples(p, samples).catch(() => {}); // loops follow tempo and key changes
}
/** Call before a change, so it can be undone. */
function snapshot() {
  undo.push(JSON.stringify(p));
  if (undo.length > 60) undo.shift();
}
function undoRedo(back) {
  const from = back ? undo : redo, to = back ? redo : undo;
  if (!from.length) return;
  to.push(JSON.stringify(p));
  const id = p.id;
  p = JSON.parse(from.pop());
  if (p.id !== id) return;
  if (engine.playing) engine.p = p;
  for (const r of Object.keys(p.patterns)) engine.edited(`p:${r}`);
  fillHeader(); changed({ keepRedo: true });
}

// ---------- header ----------
function fillSelect(el, items, value) {
  el.innerHTML = items.map(([v, t]) => `<option value="${esc(v)}">${esc(t)}</option>`).join('');
  el.value = value;
}
function fillHeader() {
  $('#title').value = p.title;
  fillSelect($('#style'), Object.entries(S.STYLES).map(([k, v]) => [k, v.name]), p.style);
  $('#bpm').value = p.bpm;
  fillSelect($('#key'), S.KEYS.map((k) => [k, k.endsWith('m') ? `${k.slice(0, -1)} minor` : `${k} major`]), p.key);
  const pid = S.PROGRESSIONS.find((x) => x.prog.join() === p.prog.join())?.id;
  fillSelect($('#prog'), [...S.PROGRESSIONS.map((x) => [x.id, x.name]), ...(pid ? [] : [['custom', `Custom (${p.prog.join('-')})`]])], pid || 'custom');
  $('#pumpBtn').setAttribute('aria-pressed', String(!!p.pump));
}
function wireHeader() {
  $('#title').addEventListener('change', (e) => { snapshot(); p.title = e.target.value.trim() || 'Untitled'; changed({ grid: false }); });
  $('#style').addEventListener('change', (e) => {
    snapshot(); p.style = e.target.value;
    if (confirm(`Change the tempo to ${S.STYLES[p.style].bpm} BPM, usual for ${S.STYLES[p.style].name}?`)) { p.bpm = S.STYLES[p.style].bpm; $('#bpm').value = p.bpm; }
    changed();
  });
  $('#bpm').addEventListener('change', (e) => { snapshot(); p.bpm = S.clampBpm(e.target.value); e.target.value = p.bpm; changed(); });
  $('#key').addEventListener('change', (e) => { snapshot(); p.key = e.target.value; changed({ grid: false }); });
  $('#prog').addEventListener('change', (e) => { const x = S.PROGRESSIONS.find((q) => q.id === e.target.value); if (!x) return; snapshot(); p.prog = [...x.prog]; changed({ grid: false }); });
  $('#pumpBtn').addEventListener('click', () => { snapshot(); p.pump = !p.pump; fillHeader(); changed({ grid: false }); });
  $('#playBtn').addEventListener('click', () => togglePlay());
  $('#loopBtn').innerHTML = icon('refresh', 16);
  $('#loopBtn').addEventListener('click', () => { const on = $('#loopBtn').getAttribute('aria-pressed') !== 'true'; $('#loopBtn').setAttribute('aria-pressed', String(on)); setLoop(); });
  $('#projBtn').innerHTML = `${icon('folder', 15)} Tracks`;
  $('#exportBtn').innerHTML = `${icon('download', 15)} Export`;
  menu('#projBtn', '#projMenu', (b) => projectAction(b.dataset.p));
  menu('#exportBtn', '#exportMenu', (b) => exportAction(b.dataset.x));
  $('#toLibrary small').textContent = desktop?.library ? 'Ready to mix: exact beat grid and phrases, no analysis needed' : 'Saves the WAV: put it in your music folder (My library is in the desktop app)';
}
function menu(btnSel, menuSel, onPick) {
  const b = $(btnSel), m = $(menuSel);
  b.addEventListener('click', (e) => { e.stopPropagation(); const open = m.classList.contains('hidden'); $$('.menu').forEach((x) => x.classList.add('hidden')); m.classList.toggle('hidden', !open); });
  m.addEventListener('click', (e) => { const it = e.target.closest('button'); if (!it) return; m.classList.add('hidden'); onPick(it); });
}
document.addEventListener('click', () => $$('.menu').forEach((x) => x.classList.add('hidden')));

// ---------- transport ----------
function playIcon() { $('#playBtn').innerHTML = icon(engine.playing ? 'pause' : 'play', 18); $('#playBtn').setAttribute('aria-label', engine.playing ? 'Stop' : 'Play'); }
async function togglePlay(fromBar = null) {
  engine.stopPreview();
  if (engine.playing && fromBar == null) { engine.stop(); playIcon(); return; }
  await engine.loadSamples(p, samples);
  setLoop();
  const start = fromBar ?? (sel ? S.sectionStart(p, sel.sectionId) : 0);
  engine.play(p, samples, Math.max(0, start));
  playIcon();
}
engine.onEnd = () => playIcon();
function setLoop() {
  const on = $('#loopBtn').getAttribute('aria-pressed') === 'true';
  const id = sel?.sectionId || (engine.playing ? S.slotAt(p, Math.floor(engine.position() || 0))?.section.id : p.sections[0].id);
  const s = p.sections.find((x) => x.id === id);
  engine.loop = on && s ? [S.sectionStart(p, id), S.sectionStart(p, id) + s.bars] : null;
}
function frame() {
  const pos = engine.position();
  const bar = pos ?? (sel ? S.sectionStart(p, sel.sectionId) : 0);
  const slot = S.slotAt(p, Math.floor(bar));
  $('#clock').textContent = `${S.fmtTime(bar * S.barSeconds(p.bpm))} · bar ${Math.floor(bar) + 1}${slot ? ` · ${S.SECTION_KINDS[slot.section.kind].name}` : ''}`;
  const ph = $('#playhead');
  if (ph) {
    ph.classList.toggle('hidden', pos == null);
    if (pos != null && slot) {
      const head = $(`.sec-head[data-id="${slot.section.id}"]`);
      if (head) ph.style.left = `${head.offsetLeft + head.offsetWidth * ((pos - slot.start) / slot.section.bars)}px`;
    }
  }
  $('#meterBar').style.width = `${Math.min(100, engine.playing ? engine.level() * 100 : 0)}%`;
  $$('.steps button.now').forEach((b) => b.classList.remove('now'));
  if (pos != null && sel && slot?.section.id === sel.sectionId) {
    const step = Math.floor((pos - slot.start) * 16);
    $$(`.steps button[data-step]`).forEach((b) => { const bars = Number(b.dataset.bars) || 1; if (Number(b.dataset.step) === step % (bars * 16)) b.classList.add('now'); });
  }
  requestAnimationFrame(frame);
}

// ---------- the sound browser ----------
function soundRow(ref, name, lane, sub = '') {
  return `<div class="sound" draggable="true" data-ref="${esc(ref)}" style="--lc:${LANE_VAR(lane)}"><span class="swatch" style="background:${LANE_VAR(lane)}"></span>
    <span class="nm">${esc(name)}${sub ? `<small>${esc(sub)}</small>` : ''}</span>
    <button class="icon-btn" data-preview title="Listen">${icon('play', 14)}</button></div>`;
}
function renderBuiltins() {
  const by = {};
  for (const [id, b] of Object.entries(S.BUILTINS)) (by[b.lane] ||= []).push(soundRow(`b:${id}`, b.name, b.lane, b.bars > 1 ? `${b.bars} bars` : ''));
  const own = Object.entries(p.patterns).map(([id, x]) => soundRow(`p:${id}`, x.name, x.lane || x.type, 'Made for this track'));
  $('#pane-built').innerHTML = (own.length ? `<div class="group"><h4>This track</h4>${own.join('')}</div>` : '')
    + S.LANES.filter((l) => by[l.id]).map((l) => `<div class="group"><h4>${l.name}</h4>${by[l.id].join('')}</div>`).join('')
    + '<div class="note">No vocals built in: grab free ones from the Freesound tab, or drop your own in My samples.</div>';
}
function sampleSub(s) {
  return [s.mode === 'loop' ? `${s.bars}-bar loop · ${s.bpm} BPM` : 'one-shot', s.key, s.source === 'freesound' ? `by ${s.author} (CC0)` : ''].filter(Boolean).join(' · ');
}
function renderMine() {
  const list = Object.values(samples).sort((a, b) => (b.added || 0) - (a.added || 0));
  $('#mineList').innerHTML = list.length ? S.LANES.map((l) => {
    const xs = list.filter((s) => s.lane === l.id);
    return xs.length ? `<div class="group"><h4>${l.name}</h4>${xs.map((s) => soundRow(`s:${s.id}`, s.name, s.lane, sampleSub(s))).join('')}</div>` : '';
  }).join('') : '';
}
function wireBrowser() {
  $$('.tabs button').forEach((b) => b.addEventListener('click', () => {
    $$('.tabs button').forEach((x) => x.setAttribute('aria-selected', String(x === b)));
    for (const t of ['built', 'mine', 'fs']) $(`#pane-${t}`).classList.toggle('hidden', b.dataset.tab !== t);
    if (b.dataset.tab === 'fs') fsShow();
  }));
  for (const pane of ['#pane-built', '#mineList', '#fsResults']) {
    const el = $(pane);
    el.addEventListener('dragstart', (e) => { const r = e.target.closest('.sound[data-ref]'); if (!r) return; e.dataTransfer.setData('text/x-studio-ref', r.dataset.ref); e.dataTransfer.effectAllowed = 'copy'; });
    el.addEventListener('click', (e) => {
      const row = e.target.closest('.sound'); if (!row) return;
      if (e.target.closest('[data-preview]')) { if (row.dataset.ref) engine.preview(p, row.dataset.ref, samples); else fsPreview(row.dataset.fs); return; }
      if (e.target.closest('[data-fsadd]')) return fsAdd(row.dataset.fs, e.target.closest('[data-fsadd]'));
      if (row.dataset.ref && sel) placeInSel(row.dataset.ref);
    });
  }
  // dropping files
  const dz = $('#dropZone');
  const pane = $('#pane-mine');
  pane.addEventListener('dragover', (e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); dz.classList.add('over'); } });
  pane.addEventListener('dragleave', (e) => { if (!pane.contains(e.relatedTarget)) dz.classList.remove('over'); });
  pane.addEventListener('drop', (e) => { if (!e.dataTransfer.files.length) return; e.preventDefault(); dz.classList.remove('over'); addFiles([...e.dataTransfer.files]); });
  $('#addFilesBtn').addEventListener('click', () => $('#fileInput').click());
  $('#fileInput').addEventListener('change', (e) => { addFiles([...e.target.files]); e.target.value = ''; });
}
function placeInSel(ref) {
  const r = S.resolve(p, ref, samples);
  if (!r) return;
  snapshot(); S.setCell(p, sel.sectionId, sel.lane, ref); changed();
}

// ---------- samples ----------
const cleanName = (n) => n.replace(/\.[a-z0-9]+$/i, '').replace(/[_]+/g, ' ').trim().slice(0, 60);
async function sampleFrom(blob, name, extra = {}) {
  let buf;
  try { buf = await engine.ctx.decodeAudioData(await blob.arrayBuffer()); } catch { throw new Error(`"${name}" isn't an audio file this app can read.`); }
  const words = `${name.replace(/\.[a-z0-9]{2,5}$/i, '')} ${(extra.tags || []).join(' ')}`.trim();
  const info = S.loopInfo({ name: words, duration: buf.duration }, p.bpm);
  const lane = extra.lane || S.guessLane(words);
  const s = {
    id: S.newId('smp'), name: cleanName(name), lane, ...info, repeat: lane !== 'fx', key: S.keyFromName(words) || '',
    duration: Math.round(buf.duration * 1000) / 1000, source: extra.source || 'file', author: extra.author || '', license: extra.license || '', url: extra.url || '',
    added: Date.now(), blob,
  };
  delete s.tags;
  await store.saveSample(s);
  engine.decoded.set(s.id, buf);
  samples[s.id] = s;
  return s;
}
async function addFiles(files) {
  const audio = files.filter((f) => /\.(wav|aif|aiff|flac|mp3|m4a|ogg|oga|opus)$/i.test(f.name) || f.type.startsWith('audio/'));
  if (!audio.length) return toast('Those aren\'t audio files.');
  let ok = 0;
  for (const f of audio) { try { await sampleFrom(f, f.name); ok++; } catch (e) { toast(e.message); } }
  renderMine(); renderChecks();
  if (ok) toast(`Added ${ok} sample${ok > 1 ? 's' : ''}. Drag ${ok > 1 ? 'them' : 'it'} onto the grid.`);
}

// ---------- Freesound ----------
let fsHits = [], fsPage = 1, fsQ = '', fsAudio = null;
function fsShow() {
  const has = !!store.freesoundKey();
  $('#fsKeyBox').classList.toggle('hidden', has);
  $('#fsSearchBox').classList.toggle('hidden', !has);
}
function wireFreesound() {
  $('#fsGo').innerHTML = icon('search', 15);
  $('#fsApply').addEventListener('click', (e) => { e.preventDefault(); openLink(store.FREESOUND_APPLY); });
  $('#fsKeySave').addEventListener('click', () => { if (store.setFreesoundKey($('#fsKey').value)) { $('#fsKey').value = ''; fsShow(); toast('Freesound key saved.'); } });
  $('#fsForget').addEventListener('click', (e) => { e.preventDefault(); store.setFreesoundKey(''); fsShow(); });
  const chips = ['vocal', 'vocal chop', 'acapella', 'drum loop', 'bass loop', 'chord stab', 'riser', 'impact', 'percussion loop', 'synth loop'];
  $('#fsSearchBox .chips').innerHTML = chips.map((c) => `<button class="chip">${c}</button>`).join('');
  $('#fsSearchBox .chips').addEventListener('click', (e) => { const c = e.target.closest('.chip'); if (c) { $('#fsQuery').value = c.textContent; fsSearch(); } });
  $('#fsGo').addEventListener('click', () => fsSearch());
  $('#fsQuery').addEventListener('keydown', (e) => { if (e.key === 'Enter') fsSearch(); });
  $('#fsMore').addEventListener('click', () => fsSearch(fsPage + 1));
}
async function fsSearch(page = 1) {
  const q = $('#fsQuery').value.trim();
  if (!q) return;
  fsQ = q; fsPage = page;
  if (page === 1) { fsHits = []; $('#fsResults').innerHTML = '<p class="muted"><span class="spin"></span> Searching…</p>'; }
  try {
    const r = await store.freesoundSearch(q, { page });
    fsHits.push(...r.results);
    $('#fsMore').classList.toggle('hidden', !r.next);
    renderFs(r.count);
  } catch (e) {
    $('#fsResults').innerHTML = `<p class="muted">${esc(e.message)}</p>`;
    if (e.noKey) { store.setFreesoundKey(''); fsShow(); }
  }
}
function renderFs(count) {
  $('#fsResults').innerHTML = fsHits.length ? `<p class="muted" style="margin:0 0 4px">${count.toLocaleString()} public-domain sounds for "${esc(fsQ)}"</p>` + fsHits.map((h, i) => {
    const lane = S.guessLane(`${h.name} ${h.tags.join(' ')}`);
    return `<div class="sound" data-fs="${i}" draggable="false"><span class="swatch" style="background:${LANE_VAR(lane)}"></span>
      <span class="nm">${esc(h.name)}<small>${h.duration.toFixed(1)} s · by ${esc(h.author)}</small></span>
      <button class="icon-btn" data-preview title="Listen">${icon('play', 14)}</button>
      <button class="icon-btn" data-fsadd title="Add to My samples">${icon('plus', 14)}</button></div>`;
  }).join('') : '<p class="muted">Nothing found. Try fewer words.</p>';
}
function fsPreview(i) {
  const h = fsHits[i]; if (!h) return;
  fsAudio?.pause();
  fsAudio = new Audio(h.preview); fsAudio.volume = 0.8; fsAudio.play().catch(() => toast('Couldn\'t play that preview.'));
}
async function fsAdd(i, btn) {
  const h = fsHits[i]; if (!h) return;
  btn.innerHTML = '<span class="spin"></span>';
  try {
    const blob = await store.freesoundDownload(h);
    const s = await sampleFrom(blob, h.name, { source: 'freesound', author: h.author, license: h.license, url: h.url, tags: h.tags });
    btn.innerHTML = icon('check', 14);
    renderMine();
    toast(`"${s.name}" is in My samples (${S.LANES.find((l) => l.id === s.lane).name}).`);
  } catch (e) { btn.innerHTML = icon('plus', 14); toast(e.message); }
}

// ---------- the arranger grid ----------
function secWidth(s) { return Math.max(96, s.bars * zoom); }
function renderGrid() {
  const g = $('#grid');
  g.style.gridTemplateColumns = `${HEAD_W}px ${p.sections.map((s) => `${secWidth(s)}px`).join(' ')}`;
  const first = p.sections[0]?.id, last = p.sections.at(-1)?.id;
  let h = '<div class="sec-head corner"><small>Lanes / parts</small></div>';
  for (const s of p.sections) {
    h += `<div class="sec-head" data-id="${s.id}" data-kind="${s.kind}">
      <div class="top"><select data-kind aria-label="Part type">${Object.entries(S.SECTION_KINDS).map(([k, v]) => `<option value="${k}"${k === s.kind ? ' selected' : ''}>${v.name}</option>`).join('')}</select>
        <button data-act="play" title="Play from here">${icon('play', 12)}</button>
        <button data-act="menu" title="More">⋯</button></div>
      <div class="bars"><button data-act="less" title="8 bars shorter">−</button>${s.bars} bars<button data-act="more" title="8 bars longer">+</button></div></div>`;
  }
  for (const lane of S.LANES) {
    const st = p.lanes[lane.id];
    h += `<div class="lane-head" style="--lc:${LANE_VAR(lane.id)}" data-lane="${lane.id}"><div class="row"><b>${lane.name}</b>
      <button class="ms m" data-ms="mute" aria-pressed="${!!st.mute}" title="Mute">M</button><button class="ms s" data-ms="solo" aria-pressed="${!!st.solo}" title="Solo">S</button></div>
      <input type="range" min="0" max="1.2" step="0.01" value="${st.gain}" aria-label="${lane.name} volume"></div>`;
    for (const s of p.sections) {
      const ref = p.cells[s.id]?.[lane.id], r = S.resolve(p, ref, samples);
      const zone = (s.id === first && s.kind === 'intro') || (s.id === last && s.kind === 'outro');
      const isSel = sel?.sectionId === s.id && sel?.lane === lane.id;
      const loopBars = r ? (r.kind === 'sample' ? (r.mode === 'loop' ? r.bars : 0) : (r.type === 'fx' ? 0 : r.bars || 1)) : 0;
      const bw = loopBars ? `${(secWidth(s) - 8) * loopBars / s.bars}px` : '9999px';
      h += `<div class="cell${zone ? ' mix-zone' : ''}${isSel ? ' sel' : ''}" data-sec="${s.id}" data-lane="${lane.id}" style="--lc:${LANE_VAR(lane.id)}">${r
        ? `<div class="clip${zone && !lane.mixSafe ? ' warn' : ''}" draggable="true" style="--bw:${bw}" title="${esc(r.name)}${zone && !lane.mixSafe ? ' — keep intros and outros to drums and FX' : ''}"><span>${esc(r.name)}</span></div>`
        : '<div class="empty">+</div>'}</div>`;
    }
  }
  h += '<div class="playhead hidden" id="playhead"></div>';
  g.innerHTML = h;
  renderBuiltins();
}
function wireGrid() {
  const g = $('#grid');
  g.addEventListener('click', (e) => {
    const cell = e.target.closest('.cell');
    if (cell) { sel = { sectionId: cell.dataset.sec, lane: cell.dataset.lane }; $$('.cell.sel').forEach((c) => c.classList.remove('sel')); cell.classList.add('sel'); setLoop(); renderCell(); return; }
    const ms = e.target.closest('[data-ms]');
    if (ms) { const l = ms.closest('.lane-head').dataset.lane; p.lanes[l][ms.dataset.ms] = !p.lanes[l][ms.dataset.ms]; ms.setAttribute('aria-pressed', String(p.lanes[l][ms.dataset.ms])); engine.applyLanes(p); changed({ grid: false }); return; }
    const act = e.target.closest('[data-act]'), head = e.target.closest('.sec-head[data-id]');
    if (!act || !head) return;
    const id = head.dataset.id, s = p.sections.find((x) => x.id === id);
    if (act.dataset.act === 'play') return togglePlay(S.sectionStart(p, id));
    if (act.dataset.act === 'less' || act.dataset.act === 'more') { snapshot(); S.resizeSection(p, id, s.bars + (act.dataset.act === 'more' ? 8 : -8)); return changed(); }
    if (act.dataset.act === 'menu') sectionMenu(act, s);
  });
  g.addEventListener('dblclick', (e) => { if (e.target.closest('.clip')) editSelected(); });
  g.addEventListener('change', (e) => {
    if (e.target.matches('select[data-kind]')) { snapshot(); p.sections.find((x) => x.id === e.target.closest('.sec-head').dataset.id).kind = e.target.value; changed(); }
  });
  g.addEventListener('input', (e) => {
    if (e.target.type !== 'range') return;
    const l = e.target.closest('.lane-head').dataset.lane; p.lanes[l].gain = Number(e.target.value); engine.applyLanes(p); changed({ grid: false });
  });
  // drag and drop: loops from the browser, or clips between cells (hold Alt/Option to copy)
  let dragFrom = null;
  g.addEventListener('dragstart', (e) => {
    const cell = e.target.closest('.cell'); if (!cell || !e.target.closest('.clip')) return;
    dragFrom = { sec: cell.dataset.sec, lane: cell.dataset.lane };
    e.dataTransfer.setData('text/x-studio-ref', p.cells[dragFrom.sec][dragFrom.lane]);
    e.dataTransfer.effectAllowed = 'copyMove';
  });
  g.addEventListener('dragend', () => { dragFrom = null; });
  g.addEventListener('dragover', (e) => { const c = e.target.closest('.cell'); if (c && e.dataTransfer.types.includes('text/x-studio-ref')) { e.preventDefault(); $$('.cell.over').forEach((x) => x !== c && x.classList.remove('over')); c.classList.add('over'); } });
  g.addEventListener('dragleave', (e) => { e.target.closest?.('.cell')?.classList.remove('over'); });
  g.addEventListener('drop', (e) => {
    const c = e.target.closest('.cell'); if (!c) return;
    e.preventDefault(); c.classList.remove('over');
    const ref = e.dataTransfer.getData('text/x-studio-ref'); if (!ref) return;
    const r = S.resolve(p, ref, samples);
    snapshot();
    if (r?.lane && r.lane !== c.dataset.lane && !ref.startsWith('s:')) toast(`${r.name} is made for ${S.LANES.find((l) => l.id === r.lane)?.name}: put it there for the best mix.`);
    if (dragFrom && !e.altKey && !(dragFrom.sec === c.dataset.sec && dragFrom.lane === c.dataset.lane)) S.setCell(p, dragFrom.sec, dragFrom.lane, null);
    S.setCell(p, c.dataset.sec, c.dataset.lane, ref);
    sel = { sectionId: c.dataset.sec, lane: c.dataset.lane };
    changed();
  });
  $('#addSecBtn').innerHTML = `${icon('plus', 14)} Add part`;
  $('#addSecBtn').addEventListener('click', () => { snapshot(); const at = p.sections.at(-1)?.kind === 'outro' ? p.sections.at(-2)?.id : null; S.addSection(p, 'drop', at, null); changed(); });
  $('#zoomIn').innerHTML = icon('zoomin', 16); $('#zoomOut').innerHTML = icon('zoomout', 16);
  $('#zoomIn').addEventListener('click', () => { zoom = Math.min(24, zoom + 2); shared.set('studio.zoom', zoom); renderGrid(); });
  $('#zoomOut').addEventListener('click', () => { zoom = Math.max(3, zoom - 2); shared.set('studio.zoom', zoom); renderGrid(); });
}
function sectionMenu(anchor, s) {
  $('#secMenu')?.remove();
  const m = document.createElement('div');
  m.className = 'menu'; m.id = 'secMenu';
  m.innerHTML = `<button data-m="split"${s.bars < 16 ? ' disabled' : ''}>Split in two</button><button data-m="dup">Duplicate</button>
    <button data-m="left">Move left</button><button data-m="right">Move right</button><hr><button data-m="clear">Empty this part</button><button data-m="del">Delete part</button>`;
  document.body.appendChild(m);
  const r = anchor.getBoundingClientRect();
  Object.assign(m.style, { position: 'fixed', left: `${Math.min(innerWidth - 250, r.left)}px`, top: `${r.bottom + 4}px`, right: 'auto' });
  m.addEventListener('click', (e) => {
    e.stopPropagation();
    const b = e.target.closest('button'); if (!b) return;
    m.remove(); snapshot();
    if (b.dataset.m === 'split') S.splitSection(p, s.id);
    if (b.dataset.m === 'dup') { const n = S.addSection(p, s.kind, s.id, s.id); n.bars = s.bars; }
    if (b.dataset.m === 'left') S.moveSection(p, s.id, -1);
    if (b.dataset.m === 'right') S.moveSection(p, s.id, 1);
    if (b.dataset.m === 'clear') p.cells[s.id] = {};
    if (b.dataset.m === 'del') { S.removeSection(p, s.id); if (sel?.sectionId === s.id) sel = null; }
    changed();
  });
  setTimeout(() => document.addEventListener('click', () => m.remove(), { once: true }));
}

// ---------- the selected block ----------
function optionsFor(lane, current) {
  const opt = (v, t) => `<option value="${esc(v)}"${v === current ? ' selected' : ''}>${esc(t)}</option>`;
  const built = Object.entries(S.BUILTINS).filter(([, b]) => b.lane === lane).map(([id, b]) => opt(`b:${id}`, b.name));
  const own = Object.entries(p.patterns).filter(([, x]) => (x.lane || x.type) === lane).map(([id, x]) => opt(`p:${id}`, x.name));
  const mine = Object.values(samples).filter((s) => s.lane === lane).map((s) => opt(`s:${s.id}`, s.name));
  const other = Object.values(samples).filter((s) => s.lane !== lane).map((s) => opt(`s:${s.id}`, s.name));
  return `${opt('', '— Silence —')}${own.length ? `<optgroup label="This track">${own.join('')}</optgroup>` : ''}${built.length ? `<optgroup label="Built-in">${built.join('')}</optgroup>` : ''}`
    + `${mine.length ? `<optgroup label="My samples">${mine.join('')}</optgroup>` : ''}${other.length ? `<optgroup label="Other samples">${other.join('')}</optgroup>` : ''}`;
}
function renderCell() {
  const card = $('#cellCard');
  const s = sel && p.sections.find((x) => x.id === sel.sectionId);
  if (!s) { sel = null; card.innerHTML = '<h3>Nothing selected</h3><small>Click a block on the grid to choose its loop or edit it. Space plays, ⌫ empties a block, ⌘Z undoes.</small>'; return; }
  const lane = S.LANES.find((l) => l.id === sel.lane), ref = p.cells[s.id]?.[lane.id] || '', r = S.resolve(p, ref, samples);
  let h = `<h3 style="--lc:${LANE_VAR(lane.id)}"><span class="swatch" style="width:10px;height:10px;border-radius:50%;background:${LANE_VAR(lane.id)}"></span>${lane.name} · ${S.SECTION_KINDS[s.kind].name}</h3>
    <div class="cell-info"><select id="cellPick" aria-label="Loop">${optionsFor(lane.id, ref)}</select></div>
    <div class="row"><button class="btn small" id="cellHear"${r ? '' : ' disabled'}>${icon('play', 13)} Listen</button>
      <button class="btn small" id="cellAll"${r ? '' : ' disabled'} title="Put this loop in the same lane of every ${S.SECTION_KINDS[s.kind].name.toLowerCase()}">Use in every ${S.SECTION_KINDS[s.kind].name.toLowerCase()}</button>
      <button class="btn small" id="cellClear"${r ? '' : ' disabled'}>${icon('trash', 13)}</button></div>`;
  if (r?.kind === 'pattern' && r.type === 'drums') h += drumEditor(r);
  else if (r?.kind === 'pattern' && (r.type === 'bass' || r.type === 'lead' || r.type === 'chords')) h += synthEditor(r);
  else if (r?.kind === 'sample') h += sampleEditor(r);
  if (r?.kind === 'pattern' && r.type !== 'fx') h += textEditor(r);
  card.innerHTML = h;
  $('#cellPick').addEventListener('change', (e) => { snapshot(); S.setCell(p, s.id, lane.id, e.target.value || null); changed(); });
  $('#cellHear').addEventListener('click', () => engine.preview(p, ref, samples));
  $('#cellAll').addEventListener('click', () => { snapshot(); for (const x of p.sections) if (x.kind === s.kind) S.setCell(p, x.id, lane.id, ref); changed(); });
  $('#cellClear').addEventListener('click', () => { snapshot(); S.setCell(p, s.id, lane.id, null); changed(); });
  wireEditors(s, lane, ref, r);
}
function drumEditor(r) {
  const len = (r.bars || 1) * 16, voices = S.DRUM_VOICES.filter((v) => r.steps[v] || ['kick', 'clap', 'hat'].includes(v));
  const label = { kick: 'Kick', clap: 'Clap', hat: 'Hat', open: 'Open', perc: 'Perc' };
  let h = '<small>Click steps: on, soft, off. Edits make your own copy of the loop.</small><div class="steps" style="grid-template-columns:40px repeat(16,1fr)">';
  for (let bar = 0; bar < (r.bars || 1); bar++) {
    if (r.bars > 1) h += `<span style="grid-column:1/-1;font-size:10px;color:var(--ink-3)">Bar ${bar + 1}</span>`;
    for (const v of voices) {
      h += `<span>${label[v]}</span>`;
      const str = (r.steps[v] || '').padEnd(len, '-');
      for (let i = 0; i < 16; i++) { const k = bar * 16 + i, c = str[k]; h += `<button data-voice="${v}" data-step="${k}" data-bars="${r.bars || 1}" class="${c === 'x' ? 'x' : c === 'o' ? 'o' : ''}${i % 4 === 0 ? ' beat' : ''}" aria-label="${label[v]} step ${k + 1}"></button>`; }
    }
  }
  return `${h}</div><div class="row"><button class="btn small" data-bars-set="1">1 bar</button><button class="btn small" data-bars-set="2">2 bars</button><button class="btn small" data-bars-set="4">4 bars</button></div>`;
}
function synthEditor(r) {
  const tones = S.TONES[r.type === 'chords' ? 'chords' : r.type] || [];
  let h = `<div class="kv"><span>Sound</span><select id="toneSel">${tones.map((t) => `<option${t === r.tone ? ' selected' : ''}>${t}</option>`).join('')}</select>`;
  if (r.type !== 'chords') h += `<span>Chords</span><label><input type="checkbox" id="followChk"${r.follow ? ' checked' : ''}> follow the chord changes</label>`;
  h += '</div>';
  if (r.type === 'chords' && r.tone !== 'pad') {
    const hits = (r.hits || '').padEnd(16, '-');
    h += `<small>When the chord plays (one bar)</small><div class="steps">${'<span>Hits</span>'}${[...hits.slice(0, 16)].map((c, i) => `<button data-hit="${i}" class="${c === 'x' ? 'x' : ''}${i % 4 === 0 ? ' beat' : ''}" aria-label="Chord hit ${i + 1}"></button>`).join('')}</div>`;
  }
  if (r.type !== 'chords') h += '<div class="row"><button class="btn small" id="octDown">Octave down</button><button class="btn small" id="octUp">Octave up</button></div>';
  return h;
}
/** The loop as pattern text: write or paste a pattern, or read what the AI wrote. */
function textEditor(r) {
  return `<details class="ptext"${shared.get('studio.textOpen', false) ? ' open' : ''}><summary>Pattern text</summary>
    <textarea id="patText" spellcheck="false" rows="${Math.min(8, S.patternToText(r).split('\n').length + 1)}">${esc(S.patternToText(r))}</textarea>
    <div class="row"><button class="btn small" id="patApply">Apply</button><small id="patErr" class="muted">x hit, o soft, . rest · notes: 0 = root, 7 = octave up, _ hold</small></div></details>`;
}
function sampleEditor(r) {
  const plan = S.stretchPlan(r, p.bpm, p.key), tape = S.rateSemitones(plan.rate);
  const keyOpts = ['', ...S.KEYS].map((k) => `<option value="${k}"${k === (r.key || '') ? ' selected' : ''}>${k ? (k.endsWith('m') ? `${k.slice(0, -1)} minor` : `${k} major`) : 'Unknown'}</option>`).join('');
  const fitNote = [];
  if (r.mode === 'loop' && Math.abs(plan.rate - 1) > 0.002) fitNote.push(r.keepPitch !== false ? `Stretched from ${r.bpm} to ${p.bpm} BPM, pitch kept.` : `Played ${plan.rate > 1 ? 'faster' : 'slower'}, which also moves its pitch ${Math.abs(tape).toFixed(1)} semitones.`);
  if (plan.shift) fitNote.push(`Moved ${plan.shift > 0 ? 'up' : 'down'} ${Math.abs(plan.shift)} semitone${Math.abs(plan.shift) > 1 ? 's' : ''} from ${r.key} into ${p.key}.`);
  return `<div class="kv"><span>Its key</span><select id="smpKey">${keyOpts}</select>
    <span>Fit</span><span><label><input type="checkbox" id="smpKeep"${r.keepPitch !== false ? ' checked' : ''}> keep its pitch at any tempo</label><br>
      <label title="${r.key ? '' : 'Set its key first'}"><input type="checkbox" id="smpMatch"${r.matchKey !== false && r.key ? ' checked' : ''}${r.key ? '' : ' disabled'}> move it into the track's key</label></span></div>
    ${fitNote.length ? `<small>${esc(fitNote.join(' '))}</small>` : ''}
    <div class="kv"><span>Plays as</span><select id="smpMode"><option value="loop"${r.mode === 'loop' ? ' selected' : ''}>Loop (fits the tempo)</option><option value="once"${r.mode !== 'loop' ? ' selected' : ''}>One-shot (as recorded)</option></select>
    <span>Its tempo</span><input id="smpBpm" type="number" min="60" max="200" step="0.01" value="${r.bpm || ''}" placeholder="BPM">
    <span>Length</span><select id="smpBars">${[1, 2, 4, 8, 16, 32].map((b) => `<option value="${b}"${b === r.bars ? ' selected' : ''}>${b} bar${b > 1 ? 's' : ''}</option>`).join('')}</select>
    <span>Lane</span><select id="smpLane">${S.LANES.map((l) => `<option value="${l.id}"${l.id === r.lane ? ' selected' : ''}>${l.name}</option>`).join('')}</select>
    ${r.mode !== 'loop' ? `<span>Repeat</span><label><input type="checkbox" id="smpRepeat"${r.repeat !== false ? ' checked' : ''}> every ${r.bars} bar${r.bars > 1 ? 's' : ''}</label>` : ''}</div>
    ${r.source === 'freesound' ? `<small>From Freesound by ${esc(r.author)}, public domain (CC0). <a href="#" id="smpLink">Open its page</a></small>` : ''}
    <div class="row"><button class="btn small" id="smpDelete">${icon('trash', 13)} Remove from My samples</button></div>`;
}
function wireEditors(s, lane, ref, r) {
  const card = $('#cellCard');
  const own = () => { const mine = S.ownPattern(p, ref); engine.edited(mine); return p.patterns[mine.slice(2)]; };
  card.querySelectorAll('[data-voice]').forEach((b) => b.addEventListener('click', () => {
    snapshot(); const pat = own(); S.toggleStep(pat, b.dataset.voice, Number(b.dataset.step)); changed();
    engine.preview(p, p.cells[s.id][lane.id], samples, { bars: 1 });
  }));
  card.querySelectorAll('[data-bars-set]').forEach((b) => b.addEventListener('click', () => {
    snapshot(); const pat = own(), n = Number(b.dataset.barsSet), len = n * 16;
    for (const v of Object.keys(pat.steps)) { const x = pat.steps[v] || ''; pat.steps[v] = x.length >= len ? x.slice(0, len) : x.padEnd(len, '-').split('').map((c, i) => (i < x.length ? c : x[i % Math.max(1, x.length)] || '-')).join(''); }
    pat.bars = n; changed();
  }));
  card.querySelectorAll('[data-hit]').forEach((b) => b.addEventListener('click', () => {
    snapshot(); const pat = own(); const h = (pat.hits || '').padEnd(16, '-').split(''); const i = Number(b.dataset.hit); h[i] = h[i] === 'x' ? '-' : 'x'; pat.hits = h.join(''); changed();
  }));
  $('#toneSel', card)?.addEventListener('change', (e) => { snapshot(); const pat = own(); pat.tone = e.target.value; if (pat.type === 'chords' && pat.tone !== 'pad' && pat.hits === 'x') pat.hits = '--x-----x-----x-'; changed(); });
  $('#followChk', card)?.addEventListener('change', (e) => { snapshot(); own().follow = e.target.checked; changed(); });
  for (const [id, d] of [['#octDown', -7], ['#octUp', 7]]) $(id, card)?.addEventListener('click', () => { snapshot(); const pat = own(); pat.notes = pat.notes.map(([st, deg, l]) => [st, Math.max(-14, Math.min(21, deg + d)), l]); changed(); engine.preview(p, p.cells[s.id][lane.id], samples); });
  const det = $('.ptext', card);
  det?.addEventListener('toggle', () => shared.set('studio.textOpen', det.open));
  const applyText = () => {
    const res = S.parsePatternText($('#patText', card).value, { lane: lane.id, name: r.name });
    if (res.error) { $('#patErr', card).textContent = res.error; $('#patErr', card).style.color = 'var(--warn)'; return; }
    snapshot();
    const mine = S.ownPattern(p, ref), id = mine.slice(2);
    p.patterns[id] = { ...res.pattern, name: p.patterns[id].name };
    engine.edited(mine); changed();
    engine.preview(p, mine, samples);
  };
  $('#patApply', card)?.addEventListener('click', applyText);
  $('#patText', card)?.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); applyText(); } });
  if (r?.kind === 'sample') {
    const smp = samples[r.id];
    const upd = (f) => { f(smp); store.saveSample(smp); renderMine(); changed(); };
    $('#smpMode', card).addEventListener('change', (e) => upd((x) => { x.mode = e.target.value; if (x.mode === 'loop' && !x.bpm) x.bpm = p.bpm; }));
    $('#smpBpm', card).addEventListener('change', (e) => upd((x) => { x.bpm = Number(e.target.value) || null; }));
    $('#smpBars', card).addEventListener('change', (e) => upd((x) => { x.bars = Number(e.target.value); }));
    $('#smpLane', card).addEventListener('change', (e) => upd((x) => { x.lane = e.target.value; }));
    $('#smpRepeat', card)?.addEventListener('change', (e) => upd((x) => { x.repeat = e.target.checked; }));
    $('#smpKey', card).addEventListener('change', (e) => upd((x) => { x.key = e.target.value; }));
    $('#smpKeep', card).addEventListener('change', (e) => upd((x) => { x.keepPitch = e.target.checked; }));
    $('#smpMatch', card).addEventListener('change', (e) => upd((x) => { x.matchKey = e.target.checked; }));
    $('#smpLink', card)?.addEventListener('click', (e) => { e.preventDefault(); openLink(smp.url); });
    $('#smpDelete', card).addEventListener('click', async () => {
      const uses = (await store.listProjects()).filter((q) => Object.values(q.cells).some((c) => Object.values(c).includes(`s:${smp.id}`))).length;
      if (!confirm(`Remove "${smp.name}" from My samples?${uses ? ` It's used in ${uses} track${uses > 1 ? 's' : ''}, which will go quiet there.` : ''}`)) return;
      await store.deleteSample(smp.id); delete samples[smp.id]; engine.decoded.delete(smp.id); renderMine(); changed();
    });
  }
}
function editSelected() { $('#cellCard [data-voice], #cellCard #toneSel, #cellCard #smpMode')?.focus(); }

// ---------- mix check ----------
function renderChecks() {
  const cs = S.mixCheck(p, samples), score = S.mixScore(cs);
  $('#checks').innerHTML = cs.map((c) => `<li class="${c.ok === true ? 'ok' : c.ok === 'warn' ? 'warn' : 'bad'}"><i>${c.ok === true ? '✓' : '!'}</i><span>${esc(c.text)}${c.ok === true ? '' : `<small>${esc(c.tip)}</small>`}</span></li>`).join('');
  const el = $('#score');
  el.textContent = score === 1 ? 'Mixable' : `${cs.filter((c) => c.ok === true).length}/${cs.length}`;
  el.className = `score ${score === 1 ? 'good' : 'meh'}`;
}

// ---------- AI and surprise ----------
async function refreshAI() {
  const st = await aiStatus().catch(() => ({ hasKey: false }));
  $('#aiKeyBox').classList.toggle('hidden', !!st.hasKey);
  $('#aiWhere').textContent = st.where === 'desktop' ? 'encrypted on this computer' : 'in this browser';
  return st;
}
function wireAI() {
  $('#aiTitle').innerHTML = `${icon('sparkle', 16)} Start a track`;
  $('#aiBtn').innerHTML = `${icon('wand', 15)} Write it with AI`;
  $('#surpriseBtn').innerHTML = `${icon('sparkle', 15)} Surprise me`;
  $('#aiKeySave').addEventListener('click', async () => {
    const r = await aiSetKey($('#aiKey').value);
    if (r?.error) return toast(r.error);
    $('#aiKey').value = ''; refreshAI(); toast('API key saved.');
  });
  $('#surpriseBtn').addEventListener('click', async () => {
    const q = S.surpriseProject(Date.now(), { style: p.style, samples: Object.values(samples) });
    await openNew(q, `"${q.title}": a fresh ${S.STYLES[q.style].name.toLowerCase()} track. Press play, then make it yours.`);
  });
  $('#aiBtn').addEventListener('click', async () => {
    const st = await refreshAI();
    if (!st.hasKey) { $('#aiKey').focus(); return toast('Add your Anthropic API key first, or try Surprise me (no key needed).'); }
    const btn = $('#aiBtn'), was = btn.innerHTML;
    btn.disabled = true; btn.innerHTML = '<span class="spin"></span> Writing…';
    $('#aiStatus').textContent = 'The AI is writing drums, bass, chords and the arrangement. This takes about a minute.';
    try {
      const list = Object.values(samples);
      const data = await composeTrackAI({ brief: $('#brief').value.trim(), style: S.STYLES[p.style].name, bpm: p.bpm, key: p.key, catalog: S.aiCatalog(list), schema: S.aiSchema() });
      const q = S.projectFromAI(data, { style: p.style, samples });
      await openNew(q, `"${q.title}" is ready. Press play.`);
      $('#aiStatus').textContent = q.about || '';
    } catch (e) {
      $('#aiStatus').textContent = e.message;
      if (e.noKey) refreshAI();
    } finally { btn.disabled = false; btn.innerHTML = was; }
  });
}

// ---------- tracks ----------
async function openNew(q, msg) {
  engine.stop(); playIcon();
  if (p) await store.saveProject(p);
  p = q; sel = null; undo = []; redo = [];
  await store.saveProject(p);
  shared.set('studio.last', p.id);
  fillHeader(); changed();
  if (msg) toast(msg, 4500);
}
async function projectAction(a) {
  if (a === 'new') return openNew(S.newProject({ style: p.style, key: p.key, bpm: p.bpm }), 'New track. The loops are a starting point: swap them for your own.');
  if (a === 'dup') { const q = JSON.parse(JSON.stringify(p)); q.id = S.newId('t'); q.title = `${p.title} (copy)`; q.created = Date.now(); return openNew(q, 'Saved a copy. You\'re working on the copy now.'); }
  if (a === 'delete') {
    if (!confirm(`Delete "${p.title}"? This can't be undone.`)) return;
    await store.deleteProject(p.id);
    const rest = await store.listProjects();
    p = null;
    return openNew(rest[0] || S.newProject(), 'Track deleted.');
  }
  if (a === 'open') {
    await store.saveProject(p);
    const list = await store.listProjects();
    $('#plist').innerHTML = list.map((q) => `<div class="item"><b>${esc(q.title)}</b><small>${esc(S.STYLES[q.style]?.name || '')} · ${q.bpm} BPM · ${q.key} · ${S.fmtTime(S.trackSeconds(q))}</small><button class="btn small" data-open="${q.id}">Open</button></div>`).join('') || '<p class="muted">No tracks yet.</p>';
    $('#openDlg').showModal();
  }
}
function wireProjects() {
  $('#plist').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-open]'); if (!b) return;
    const q = (await store.listProjects()).find((x) => x.id === b.dataset.open);
    $('#openDlg').close();
    if (q && q.id !== p.id) openNew(q);
  });
  $('#openClose').addEventListener('click', () => $('#openDlg').close());
}

// ---------- export ----------
const fileSafe = (s) => String(s || 'Untitled').replace(/[\\/:*?"<>|]+/g, '').trim() || 'Untitled';
const wavOf = (buf) => S.encodeWav([buf.getChannelData(0), buf.getChannelData(1)], buf.sampleRate);
function download(bytes, name) {
  const url = URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
async function exportAction(x) {
  const checks = S.mixCheck(p, samples);
  if (x !== 'stems' && checks.some((c) => c.ok === false) && !confirm('This track isn\'t fully ready to mix yet (see "Ready to mix?"). Export it anyway?')) return;
  const btn = $('#exportBtn'), was = btn.innerHTML;
  btn.disabled = true; btn.innerHTML = '<span class="spin"></span> Rendering…';
  const name = `${fileSafe(p.artist || 'Me')} - ${fileSafe(p.title)} (${p.bpm} ${p.key})`;
  try {
    if (x === 'stems') {
      const lanes = usedLanes(p);
      let dir = null;
      if ('showDirectoryPicker' in window) { try { dir = await window.showDirectoryPicker({ id: 'stems', mode: 'readwrite' }); } catch { return; } }
      for (const l of lanes) {
        btn.innerHTML = `<span class="spin"></span> ${S.LANES.find((q) => q.id === l).name}…`;
        const wav = wavOf(await engine.render(p, samples, { only: l }));
        const file = `${name} - ${S.LANES.find((q) => q.id === l).name}.wav`;
        if (dir) { const w = await (await dir.getFileHandle(file, { create: true })).createWritable(); await w.write(wav); await w.close(); } else download(wav, file);
      }
      return toast(`Saved ${lanes.length} stems. They all start at bar 1, so they line up in any music software.`, 5000);
    }
    const wav = wavOf(await engine.render(p, samples));
    if (x === 'wav' || !desktop?.library) {
      download(wav, `${name}.wav`);
      return toast(x === 'wav' ? 'Saved the WAV.' : 'Saved the WAV. Put it in your music folder to play it on the decks.', 5000);
    }
    const info = S.libraryInfo(p);
    const r = await desktop.library.importItems([{ bytes: new Uint8Array(wav), name: `${name}.wav`, meta: info }]);
    if (r?.added) { send({ type: 'library' }); toast(`"${p.title}" is in My library, with its beat grid and phrases ready for the decks.`, 5000); }
    else if (r?.skipped) toast('That exact track is already in My library.');
    else toast(r?.errors?.[0] || 'Couldn\'t add it to My library.');
  } catch (e) { toast(`Export failed: ${e.message}`); } finally { btn.disabled = false; btn.innerHTML = was; }
}

// ---------- keys ----------
document.addEventListener('keydown', (e) => {
  if (e.target.closest('input, textarea, select, [contenteditable]')) return;
  const mod = e.metaKey || e.ctrlKey;
  if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
  else if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); undoRedo(!e.shiftKey); }
  else if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); undoRedo(false); }
  else if ((e.key === 'Backspace' || e.key === 'Delete') && sel && p.cells[sel.sectionId]?.[sel.lane]) { e.preventDefault(); snapshot(); S.setCell(p, sel.sectionId, sel.lane, null); changed(); }
  else if (e.key === 'Escape') { sel = null; renderGrid(); renderCell(); }
});

// ---------- start ----------
async function start() {
  if (desktop?.platform === 'darwin') document.documentElement.classList.add('is-mac');
  applyTheme();
  onShared(['theme'], applyTheme);
  for (const s of await store.listSamples().catch(() => [])) samples[s.id] = s;
  const list = await store.listProjects().catch(() => []);
  p = list.find((q) => q.id === shared.get('studio.last')) || list[0] || null;
  if (!p) { p = S.newProject(); await store.saveProject(p).catch(() => {}); }
  shared.set('studio.last', p.id);
  wireHeader(); wireBrowser(); wireFreesound(); wireGrid(); wireAI(); wireProjects();
  fillHeader(); renderGrid(); renderMine(); renderChecks(); renderCell(); playIcon(); refreshAI(); fsShow();
  requestAnimationFrame(frame);
  window.addEventListener('beforeunload', () => { if (p) store.saveProject(p); });
}
start();
