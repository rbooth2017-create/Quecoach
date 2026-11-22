// Cue Coach Library: the library manager window. Browse every track, organise crates and set lists,
// fix beat grids and set hot cues and memory cues, like the "prepare" side of pro DJ software.
// It shares storage with the Learn window (see libsync.js), so whatever you change here is on the decks.
import { icon } from './icons.js';
import * as lib from './musiclib.js';
import { ctx, synthDemoTrack, estimateGrid } from './audio.js';
import { bandPeaks, barEnergies, phrasesFromEnergy } from './beatgrid.js';
import { phraseColor } from './songguide.js';
import { energyOf } from './energy.js';
import { setArc, energyChartSVG } from './setchart.js';
import { NEW_SET_TITLE, openSavedSet, saveSetCopy } from './setbuilder.js';
import { toCamelot } from './library.js';
import * as M from './managermodel.js';
import { shared, onShared, send, onMessage } from './libsync.js';

const desktop = window.cueDesktop || null;
const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const DRAG_TYPE = 'application/x-cuecoach-tracks';
const SOURCES = [
  ['managed', 'My library'], ['folder', 'Music folder'], ['rekordbox', 'rekordbox'], ['practice', 'Practice tracks'],
];

// ---------- state ----------
const S = {
  source: null, sourceName: '', tracks: [], crates: [], busy: null, reconnect: null, scan: 0,
  view: shared.get('mgrView', { kind: 'all' }),
  query: '', f: { bpmMin: null, bpmMax: null, matchKey: false, gridTodo: false },
  sort: shared.get('mgrSort', { col: null, dir: 1 }),
  sel: new Set(), anchor: null, focus: null,
  sets: shared.get('savedSets', []), current: shared.get('set', null),
  editName: null, rows: [],
};
/** The track editor: audio, waveform, player. */
const E = { t: null, buffer: null, bands: null, loading: false, err: null, playing: false, offset: 0, anchor: 0, src: null, span: 8, click: false, lastClick: -1, taps: [], tab: 'edit', token: 0, drag: null };

// ---------- shared cue storage (the Learn window reads the same keys) ----------
const getMap = (k) => shared.get(k, {}) || {};
function updateMap(k, id, fn) {
  const m = getMap(k), v = fn(m[id]);
  if (v == null || (Array.isArray(v) && !v.length)) delete m[id]; else m[id] = v;
  shared.set(k, m);
}
const hotOf = (t, maps = null) => M.hotCues(t, (maps?.cues || getMap('cues'))[t.id] || []);
const memOf = (t, maps = null) => M.memoryCues(t, (maps?.mem || getMap('memcues'))[t.id] || []);
const namesOf = (t) => getMap('cuenames')[t.id] || [];
const cuePointOf = (t) => getMap('cuepoints')[t.id] ?? (t.grid?.firstDownbeat || 0);
const cueCount = (t, maps) => hotOf(t, maps).filter((x) => x != null).length + memOf(t, maps).length;

// ---------- toast ----------
let toastT;
function toast(msg) {
  const el = $('#toast'); el.textContent = msg; el.classList.remove('gone');
  clearTimeout(toastT); toastT = setTimeout(() => el.classList.add('gone'), 3200);
}

// ---------- theme ----------
let C = {};
function applyTheme() {
  document.documentElement.dataset.theme = shared.get('theme', 'auto');
  const cs = getComputedStyle(document.documentElement), v = (n) => cs.getPropertyValue(n).trim();
  C = { left: v('--left'), right: v('--right'), ink: v('--ink'), ink2: v('--ink-2'), ink3: v('--ink-3'), line: v('--line'), line2: v('--line-2'), card: v('--card'), card2: v('--card-2'), close: v('--close'), ok: v('--ok') };
  desktop?.setChrome?.({ bg: C.card, fg: C.ink });
  draw();
}

// ---------- music sources ----------
async function useSource(kind, { gesture = false } = {}) {
  const token = ++S.scan;
  pause();
  try {
    if (kind === 'managed') {
      if (!lib.hasManaged()) { toast('My library is in the Cue Coach desktop app.'); return; }
      busy('Opening My library…');
      const { tracks, crates } = await lib.loadManaged();
      if (token !== S.scan) return;
      S.crates = crates; setTracks(tracks, 'My library', kind);
    } else if (kind === 'folder') {
      let handle = null;
      const saved = await lib.savedFolder();
      if (saved?.permission === 'granted') handle = saved.handle;
      else if (saved && gesture) { if ((await saved.handle.requestPermission({ mode: 'read' })) === 'granted') handle = saved.handle; }
      else if (saved) { S.reconnect = saved.handle; S.source = kind; S.tracks = []; renderAll(); return; }
      if (!handle && gesture && lib.canPickFolder()) handle = await lib.pickFolder();
      if (!handle) { S.source = kind; S.tracks = []; renderAll(); return; }
      S.reconnect = null;
      busy(`Reading ${handle.name}…`);
      const tracks = await lib.scanFolder(handle, (n) => token === S.scan && busy(`Reading ${handle.name}: ${n} tracks…`));
      if (token !== S.scan) return;
      S.crates = []; setTracks(tracks, handle.name, kind);
    } else if (kind === 'rekordbox') {
      if (!(await lib.rekordboxAvailable())) { toast('rekordbox isn\'t connected. Open Cue Coach\'s rekordbox helper first.'); S.source = kind; S.tracks = []; renderAll(); return; }
      busy('Reading your rekordbox library…');
      const tracks = await lib.loadRekordbox();
      if (token !== S.scan) return;
      S.crates = []; setTracks(tracks, 'rekordbox', kind);
    } else {
      S.crates = []; setTracks(lib.practiceLibrary(), 'Practice tracks', 'practice');
    }
  } catch (err) {
    if (err.name !== 'AbortError') { console.error(err); toast(`Couldn't open your music: ${err.message}`); }
  } finally { if (token === S.scan) busy(null); }
}
function setTracks(tracks, name, kind) {
  S.tracks = tracks; S.sourceName = name; S.source = kind;
  const ids = new Set(tracks.map((t) => t.id));
  S.sel = new Set([...S.sel].filter((id) => ids.has(id)));
  if (S.view.kind === 'crate' && !S.crates.some((c) => c.id === S.view.id)) setView({ kind: 'all' });
  if (S.focus && !ids.has(S.focus)) S.focus = null;
  if (E.t && !ids.has(E.t.id)) closeEditor();
  else if (E.t) E.t = tracks.find((t) => t.id === E.t.id) || E.t; // keep the edited track's object fresh
  renderAll();
}
function busy(text) { S.busy = text; renderStatus(); }
function renderStatus() {
  $('#status').innerHTML = S.busy ? `<span class="spin"></span>${esc(S.busy)}` : '';
}
const byId = () => new Map(S.tracks.map((t) => [t.id, t]));

// ---------- views ----------
function setView(v) {
  S.view = v; shared.set('mgrView', v); S.sel = new Set(); S.anchor = null; S.editName = null;
  renderAll();
  $('#tableWrap').scrollTop = 0;
}
const isSetView = (v = S.view) => v.kind === 'set' || v.kind === 'current';
function setOf(v = S.view) {
  if (v.kind === 'current') return S.current;
  if (v.kind === 'set') return S.sets.find((x) => x.id === v.id)?.set || null;
  return null;
}
const crateOf = (v = S.view) => (v.kind === 'crate' ? S.crates.find((c) => c.id === v.id) || null : null);
function viewTitle(v = S.view) {
  if (v.kind === 'current') return S.current?.title || NEW_SET_TITLE;
  if (v.kind === 'set') return S.sets.find((x) => x.id === v.id)?.title || 'Set list';
  if (v.kind === 'crate') return crateOf(v)?.name || 'Crate';
  if (v.kind === 'todo') return 'Grids to check';
  return S.source === 'managed' ? 'All tracks' : S.sourceName || 'All tracks';
}

/** The tracks the table shows, in order. Set lists keep their own order unless a column is sorted. */
function viewTracks() {
  const v = S.view;
  let base;
  if (isSetView(v)) {
    const set = setOf(v), m = byId();
    base = (set?.items || []).map((i) => m.get(i.id)).filter(Boolean);
  } else if (v.kind === 'crate') base = lib.tracksInCrate(S.tracks, crateOf(v));
  else base = S.tracks;
  const focus = S.focus && S.tracks.find((t) => t.id === S.focus);
  let rows = M.filterTracks(base, {
    query: S.query, bpmMin: S.f.bpmMin, bpmMax: S.f.bpmMax,
    matchKey: S.f.matchKey && focus?.camelot ? focus.camelot : null,
    gridTodo: S.f.gridTodo || v.kind === 'todo',
  });
  if (S.sort.col && !isSetView(v)) rows = M.sortTracks(rows, S.sort.col, S.sort.dir, { cueCount: (t) => cueCount(t, maps) });
  return rows;
}
let maps = { cues: {}, mem: {} };
const filtering = () => !!(S.query || S.f.bpmMin != null || S.f.bpmMax != null || S.f.matchKey || S.f.gridTodo);

// ---------- set lists ----------
function editItems(v, fn) {
  if (v.kind === 'current') {
    const cur = S.current || { title: NEW_SET_TITLE, story: '', ai: false, items: [], played: [] };
    const items = fn(cur.items);
    S.current = items.length ? { ...cur, items, played: (cur.played || []).filter((id) => items.some((i) => i.id === id)) } : null;
    shared.set('set', S.current);
  } else if (v.kind === 'set') {
    S.sets = M.editSetList(S.sets, v.id, fn);
    shared.set('savedSets', S.sets);
  }
  renderAll();
}
function newSetFrom(ids = [], { rename = true } = {}) {
  const r = M.newSetList(S.sets, NEW_SET_TITLE, ids);
  S.sets = r.list; shared.set('savedSets', S.sets);
  setView({ kind: 'set', id: r.id });
  if (rename) { S.editName = `set:${r.id}`; renderSide(); focusRename(); }
  return r.id;
}
function addToSetList(v, ids) {
  editItems(v, (items) => M.addItems(items, ids));
  const name = v.kind === 'current' ? (S.current?.title || NEW_SET_TITLE) : S.sets.find((x) => x.id === v.id)?.title;
  toast(`Added ${ids.length === 1 ? 'a track' : `${ids.length} tracks`} to ${name}.`);
}
function playSetInLearn(id) {
  const s = openSavedSet(S.sets, id); if (!s) return;
  S.current = s; shared.set('set', s);
  toast(`"${s.title}" is now the set in Cue Coach's Set panel.`);
  renderAll();
}
function saveCurrentAsList() {
  if (!S.current?.items?.length) return;
  const r = saveSetCopy(S.sets, S.current);
  S.sets = r.list; S.current = { ...S.current, savedId: r.id };
  shared.set('savedSets', S.sets); shared.set('set', S.current);
  toast(`Saved "${S.current.title}" in your set lists.`);
  renderAll();
}
function deleteSet(id) {
  const s = S.sets.find((x) => x.id === id); if (!s) return;
  if (!confirm(`Delete the set list "${s.title}"?\n\nThe tracks stay in your library.`)) return;
  S.sets = M.deleteSetList(S.sets, id); shared.set('savedSets', S.sets);
  if (S.view.kind === 'set' && S.view.id === id) setView({ kind: 'all' }); else renderAll();
}

// ---------- crates (My library) ----------
async function crateOp(op, args) {
  try {
    const r = await desktop.library.crate(op, args);
    S.crates = r.crates; send({ type: 'library' });
    return r;
  } catch (err) { toast(`Couldn't change the crate: ${err.message}`); return null; } finally { renderAll(); }
}
const libIds = (ids) => { const m = byId(); return ids.map((id) => m.get(id)?.libId).filter(Boolean); };
async function addToCrate(id, ids) {
  const r = await crateOp('add', { id, trackIds: libIds(ids) });
  if (r) toast(`Added to ${S.crates.find((c) => c.id === id)?.name || 'the crate'}.`);
}
async function newCrateFrom(ids = []) {
  const r = await crateOp('create', { name: 'New crate', trackIds: libIds(ids) });
  if (r?.created) { setView({ kind: 'crate', id: r.created.id }); S.editName = `crate:${r.created.id}`; renderSide(); focusRename(); }
}
async function deleteCrate(id) {
  const c = S.crates.find((x) => x.id === id); if (!c) return;
  if (!confirm(`Delete the crate "${c.name}"?\n\nIts tracks stay in My library.`)) return;
  if (S.view.kind === 'crate' && S.view.id === id) S.view = { kind: 'all' };
  await crateOp('delete', { id });
}

/** Take the selected tracks out of the set list or crate on screen (never out of the library). */
function removeFromView(ids) {
  if (!ids.length) return;
  if (isSetView()) editItems(S.view, (items) => M.removeItems(items, ids));
  else if (S.view.kind === 'crate') crateOp('remove', { id: S.view.id, trackIds: libIds(ids) });
  S.sel = new Set();
}

// ---------- renaming (sidebar and heading) ----------
function focusRename() { const i = $('[data-rename]'); if (i) { i.focus(); i.select(); } }
function commitRename(input, save) {
  const key = input.dataset.rename; if (S.editName !== key) return;
  S.editName = null;
  const name = input.value.trim(), [kind, id] = key.split(/:(.*)/s);
  if (save && name) {
    if (kind === 'set') { S.sets = M.renameSetList(S.sets, id, name); shared.set('savedSets', S.sets); }
    else if (kind === 'current' && S.current) { S.current = { ...S.current, title: name.slice(0, 80) }; shared.set('set', S.current); }
    else if (kind === 'crate') return crateOp('rename', { id, name });
  }
  renderAll();
}

// ---------- rendering: sidebar ----------
function renderSide() {
  const v = S.view, on = (k, id) => (v.kind === k && (id == null || v.id === id) ? 'on' : '');
  const node = (view, ic, name, count, extra = '', cls = '') => `<div class="node ${cls}" role="button" tabindex="0" data-view="${esc(view)}" data-drop="${esc(view)}">${icon(ic, 15)}<span class="name">${esc(name)}</span><span class="count">${count ?? ''}</span>${extra}</div>`;
  const renaming = (key, ic, value) => `<div class="node on">${icon(ic, 15)}<input type="text" data-rename="${esc(key)}" value="${esc(value)}" maxlength="80" aria-label="Name"></div>`;
  const todo = S.tracks.filter((t) => ['unsure', 'none', 'approx'].includes(M.gridStatus(t))).length;
  const srcOpts = SOURCES.filter(([k]) => k !== 'managed' || lib.hasManaged()).map(([k, n]) => `<option value="${k}" ${S.source === k ? 'selected' : ''}>${n}</option>`).join('');
  let h = `<select id="sourceSel" aria-label="Music">${S.source ? '' : '<option value="" selected>Choose music…</option>'}${srcOpts}</select>`;
  if (S.reconnect) h += `<button class="primary reconnect" data-a="reconnect">${icon('folder', 14)} Open ${esc(S.reconnect.name)}</button>`;
  else if (S.source === 'folder' && !S.tracks.length && !S.busy) h += `<button class="primary reconnect" data-a="pick-folder">${icon('folder', 14)} Choose a music folder</button>`;
  h += '<div class="side-title">Collection</div>';
  h += `<div class="node ${on('all')}" role="button" tabindex="0" data-view="all">${icon('library', 15)}<span class="name">${esc(S.source === 'managed' ? 'All tracks' : S.sourceName || 'All tracks')}</span><span class="count">${S.tracks.length || ''}</span></div>`;
  h += `<div class="node ${on('todo')}" role="button" tabindex="0" data-view="todo" title="Tracks whose beat grid Cue Coach isn't sure about, or hasn't worked out yet">${icon('metronome', 15)}<span class="name">Grids to check</span><span class="count">${todo || ''}</span></div>`;
  if (S.source === 'managed') {
    h += `<div class="side-title">Crates<span class="grow"></span><button class="ghost" data-a="new-crate" title="New crate" aria-label="New crate">${icon('plus', 13)}</button></div>`;
    h += S.crates.map((c) => (S.editName === `crate:${c.id}` ? renaming(`crate:${c.id}`, 'crate', c.name)
      : node(`crate:${c.id}`, 'crate', c.name, c.trackIds.length || '', '', on('crate', c.id)))).join('');
    if (!S.crates.length) h += '<div class="side-note">Drop tracks on + to make a crate.</div>';
  }
  h += `<div class="side-title">Set lists<span class="grow"></span><button class="ghost" data-a="new-set" title="New set list" aria-label="New set list">${icon('plus', 13)}</button></div>`;
  if (S.current?.items?.length) {
    h += S.editName === 'current:' ? renaming('current:', 'play', S.current.title)
      : node('current:', 'play', S.current.title || NEW_SET_TITLE, S.current.items.length, '', `now ${on('current')}`);
  }
  h += S.sets.map((x) => (S.editName === `set:${x.id}` ? renaming(`set:${x.id}`, 'list', x.title)
    : node(`set:${x.id}`, 'list', x.title, x.count, '', on('set', x.id)))).join('');
  h += `<div class="node add" role="button" tabindex="0" data-a="new-set" data-drop="new-set">${icon('plus', 15)}<span class="name">New set list</span></div>`;
  $('#side').innerHTML = h;
}

// ---------- rendering: list heading ----------
function renderHead() {
  const v = S.view, rows = S.rows, set = setOf(v), crate = crateOf(v);
  const canRename = isSetView(v) || (v.kind === 'crate' && crate);
  const renameKey = v.kind === 'current' ? 'current:' : `${v.kind}:${v.id}`;
  const title = S.editName === renameKey && canRename
    ? `<input type="text" data-rename="${esc(renameKey)}" value="${esc(viewTitle())}" maxlength="80" aria-label="Name">`
    : `<span ${canRename ? 'data-a="rename-view" title="Double-click to rename"' : ''}>${esc(viewTitle())}</span>`;
  let stats = '', actions = '', chart = '';
  if (isSetView(v)) {
    const m = byId(), tracks = (set?.items || []).map((i) => m.get(i.id)).filter(Boolean), st = M.setStats(tracks);
    const missing = (set?.items.length || 0) - tracks.length;
    stats = `<b>${st.count}</b> tracks · about <b>${st.minutes}</b> min to play${st.bpmMin ? ` · <b>${Math.round(st.bpmMin)}–${Math.round(st.bpmMax)}</b> BPM` : ''}${st.tricky ? ` · <span style="color:var(--warn)">${st.tricky} tricky mix${st.tricky === 1 ? '' : 'es'}</span>` : ''}${missing ? ` · <span class="dim">${missing} not in ${esc(S.sourceName || 'this music')}</span>` : ''}`;
    actions = v.kind === 'set'
      ? `<button class="primary small" data-a="play-set" title="Make this the set in Cue Coach's Set panel">${icon('play', 13)} Use in Cue Coach</button><button class="ghost small" data-a="dup-set">Duplicate</button><button class="ghost small" data-a="m3u">Export M3U</button><button class="ghost small" data-a="del-set" title="Delete this set list">${icon('trash', 13)}</button>`
      : `<button class="small" data-a="save-current" title="Keep a copy in your set lists">Save as set list</button><button class="ghost small" data-a="m3u">Export M3U</button>`;
    if (tracks.length > 1) {
      const pts = setArc(tracks.map((track) => ({ track })), null);
      const arc = pts.filter((p) => p.label).map((p) => p.label);
      chart = `<div class="set-chart">${energyChartSVG(pts, { width: 640, height: 92 })}<div class="set-note">${tracks.length > 2 ? `Shape: ${esc([...new Set(arc)].join(' → ') || 'steady')}. ` : ''}Drag rows to change the order. The chip on each row shows how well the next track follows it.</div></div>`;
    }
  } else if (v.kind === 'crate') {
    stats = `<b>${crate?.trackIds.length || 0}</b> tracks`;
    actions = `<button class="ghost small" data-a="crate-to-set" title="Start a set list with this crate's tracks">Make a set list</button><button class="ghost small" data-a="m3u">Export M3U</button><button class="ghost small" data-a="del-crate">${icon('trash', 13)}</button>`;
  } else {
    stats = `<b>${rows.length}</b>${rows.length !== S.tracks.length ? ` of ${S.tracks.length}` : ''} tracks`;
  }
  const n = S.sel.size;
  const selBar = n ? `<span class="small"><b>${n}</b> selected</span><button class="small" data-a="add-menu">${icon('plus', 12)} Add to…</button>${isSetView(v) || v.kind === 'crate' ? `<button class="ghost small" data-a="remove-sel">Remove</button>` : ''}` : '';
  const numIn = (k, ph) => `<input type="number" data-f="${k}" placeholder="${ph}" min="40" max="250" step="1" value="${S.f[k] ?? ''}">`;
  const focus = S.focus && S.tracks.find((t) => t.id === S.focus);
  $('#listHead').innerHTML = `
    <div class="lh-top"><h1>${title}</h1><span class="lh-stats">${stats}</span><span class="grow"></span>${actions}</div>
    ${chart}
    <div class="lh-filters">BPM ${numIn('bpmMin', 'from')}–${numIn('bpmMax', 'to')}
      <button class="small ${S.f.matchKey ? 'on' : ''}" data-a="f-key" aria-pressed="${S.f.matchKey}" ${focus?.camelot ? '' : 'disabled'} title="Only keys that mix well with the selected track">${icon('key', 12)} Mixes with ${focus?.camelot ? esc(focus.camelot) : 'selected'}</button>
      ${v.kind !== 'todo' ? `<button class="small ${S.f.gridTodo ? 'on' : ''}" data-a="f-grid" aria-pressed="${S.f.gridTodo}">${icon('metronome', 12)} Grids to check</button>` : ''}
      ${filtering() ? '<button class="ghost small" data-a="f-clear">Clear filters</button>' : ''}
      <span class="grow"></span>${selBar}</div>`;
}

// ---------- rendering: table ----------
const keyBadge = (t) => {
  const h = lib.keyHue(t.camelot);
  return h == null ? '<span class="keyb none">–</span>' : `<span class="keyb" style="background:hsl(${h} 58% 46%)">${esc(t.camelot)}</span>`;
};
const energyCell = (t) => {
  const e = energyOf(t);
  return e == null ? '<span class="dim">–</span>' : `<span class="ebar ${t.energy == null ? 'est' : ''}" title="${t.energy == null ? 'Estimated from the audio' : 'From the tags'}"><i style="width:${Math.round(e * 3)}px"></i>${e}</span>`;
};
const gridCell = (t) => { const s = M.gridStatus(t); return `<span class="gdot ${s}" title="${esc(M.GRID_LABEL[s])}"></span>`; };
const cuesCell = (t) => {
  const hot = hotOf(t, maps), mem = memOf(t, maps).length;
  const dots = hot.map((x, i) => (x == null ? '' : `<i style="background:${M.cueColor(i)}"></i>`)).join('');
  return dots || mem ? `<span class="cdots" title="${hot.filter((x) => x != null).length} hot cues, ${mem} memory cues">${dots}${mem ? `<span class="dim small">+${mem}</span>` : ''}</span>` : '<span class="dim">–</span>';
};

function renderTable() {
  maps = { cues: getMap('cues'), mem: getMap('memcues') };
  const v = S.view, rows = (S.rows = viewTracks()), setV = isSetView(v);
  const head = $('#listHead'); if (head) renderHead();
  if (!S.tracks.length) {
    $('#table').innerHTML = S.busy ? '' : `<div class="empty">${icon('music', 34)}<b>No music open</b><span>Choose your music on the left: My library, a music folder, rekordbox or the practice tracks.</span></div>`;
    return;
  }
  if (!rows.length) {
    const msg = setV ? ['This set list is empty', 'Drag tracks from All tracks onto it in the sidebar, or use Add to… on a selection.']
      : v.kind === 'crate' ? ['This crate is empty', 'Drag tracks onto it in the sidebar.']
        : v.kind === 'todo' && !filtering() ? ['Every grid looks good', 'Cue Coach is happy with the beat grid of every track.']
          : ['Nothing matches', 'Try fewer words, or clear the filters.'];
    $('#table').innerHTML = `<div class="empty">${icon(setV ? 'list' : 'search', 30)}<b>${msg[0]}</b><span>${msg[1]}</span></div>`;
    return;
  }
  const cols = setV
    ? [['n', '#'], ['title', 'Title'], ['artist', 'Artist'], ['bpm', 'BPM'], ['key', 'Key'], ['energy', 'Energy'], ['time', 'Time'], ['cues', 'Cues'], ['grid', 'Grid'], ['next', 'Into the next track'], ['act', '']]
    : [['title', 'Title'], ['artist', 'Artist'], ['bpm', 'BPM'], ['key', 'Key'], ['energy', 'Energy'], ['time', 'Time'], ['genre', 'Genre'], ['cues', 'Cues'], ['grid', 'Grid'], ...(S.source === 'managed' ? [['added', 'Added']] : []), ['act', '']];
  const sortable = (c) => !setV && M.COLUMNS.some((x) => x.id === c);
  const th = cols.map(([c, l]) => `<th class="c-${c} ${S.sort.col === c && !setV ? `sorted ${S.sort.dir < 0 ? 'desc' : ''}` : ''}" ${sortable(c) ? `data-sort="${c}"` : ''}>${l}</th>`).join('');
  const body = rows.map((t, i) => {
    const cells = cols.map(([c]) => {
      switch (c) {
        case 'n': return `<td class="c-n num">${i + 1}</td>`;
        case 'title': return `<td class="t-title"><b>${esc(t.title)}</b></td>`;
        case 'artist': return `<td class="dim">${esc(t.artist)}</td>`;
        case 'bpm': return `<td class="num">${t.bpm ? t.bpm.toFixed(1) : '<span class="dim">–</span>'}</td>`;
        case 'key': return `<td>${keyBadge(t)}</td>`;
        case 'energy': return `<td>${energyCell(t)}</td>`;
        case 'time': return `<td class="num dim">${M.fmtDur(t.duration)}</td>`;
        case 'genre': return `<td class="dim">${esc(t.genre)}</td>`;
        case 'cues': return `<td>${cuesCell(t)}</td>`;
        case 'grid': return `<td>${gridCell(t)}</td>`;
        case 'added': return `<td class="dim small">${t.addedAt ? new Date(t.addedAt).toLocaleDateString() : ''}</td>`;
        case 'next': {
          const tr = !filtering() ? M.transition(t, rows[i + 1]) : null;
          return `<td>${tr ? `<span class="chip ${tr.level}" title="${esc(tr.why.join('. '))}"><span class="arrow">${tr.energy > 0 ? '↗' : tr.energy < 0 ? '↘' : '→'}</span>${esc(tr.label)}${tr.bpm ? ` · ${esc(tr.bpm)}` : ''}</span>` : ''}</td>`;
        }
        case 'act': return `<td><span class="row-act"><button data-load="left" title="Load on deck A in Cue Coach">A</button><button data-load="right" title="Load on deck B in Cue Coach">B</button></span></td>`;
        default: return '<td></td>';
      }
    }).join('');
    return `<tr data-id="${esc(t.id)}" draggable="true" class="${S.sel.has(t.id) ? 'sel' : ''} ${S.focus === t.id ? 'focus' : ''}">${cells}</tr>`;
  }).join('');
  $('#table').innerHTML = `<table><colgroup>${cols.map(([c]) => `<col class="c-${c}">`).join('')}</colgroup><thead><tr>${th}</tr></thead><tbody>${body}</tbody></table>`;
}

function renderAll() {
  renderSide(); renderTable(); renderEditor();
  $('#app').classList.toggle('no-editor', !E.t);
  if (S.editName) focusRename();
}

// ---------- selection ----------
function selectRow(id, e = {}) {
  const ids = S.rows.map((t) => t.id);
  if (e.shiftKey && S.anchor && ids.includes(S.anchor)) {
    const a = ids.indexOf(S.anchor), b = ids.indexOf(id);
    S.sel = new Set(ids.slice(Math.min(a, b), Math.max(a, b) + 1));
  } else if (e.metaKey || e.ctrlKey) {
    S.sel.has(id) ? S.sel.delete(id) : S.sel.add(id); S.anchor = id;
  } else { S.sel = new Set([id]); S.anchor = id; }
  focusTrack(id);
}
let openTimer;
function focusTrack(id) {
  S.focus = id;
  renderTable();
  const t = S.tracks.find((x) => x.id === id);
  if (t && E.t?.id !== id) {
    pause(); E.t = t; E.buffer = null; E.bands = null; E.err = null; E.loading = true; E.offset = cuePointOf(t); E.taps = [];
    renderEditor(); $('#app').classList.remove('no-editor');
    clearTimeout(openTimer); openTimer = setTimeout(() => loadAudio(t), 220);
  }
  $(`tr[data-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'nearest' });
}
const selectedIds = () => S.rows.map((t) => t.id).filter((id) => S.sel.has(id));

// ---------- the editor: audio ----------
const out = ctx.createGain(); out.connect(ctx.destination);
const dur = () => E.buffer?.duration || E.t?.duration || 0;
const pos = () => (E.playing ? Math.min(dur(), E.offset + (ctx.currentTime - E.anchor)) : E.offset);
function stopSrc() { const s = E.src; E.src = null; if (s) { try { s.stop(); } catch { /* not started */ } s.disconnect(); } }
function play() {
  if (!E.buffer) return;
  ctx.resume(); stopSrc();
  if (E.offset >= dur() - 0.05) E.offset = 0;
  const s = ctx.createBufferSource(); s.buffer = E.buffer; s.connect(out);
  E.anchor = ctx.currentTime; s.start(0, E.offset); E.src = s; E.playing = true; E.lastClick = E.offset - 0.001;
  s.onended = () => { if (E.src === s) { E.offset = dur(); E.playing = false; E.src = null; renderTransport(); } };
  renderTransport(); loop();
}
function pause() { if (!E.playing) return; E.offset = pos(); E.playing = false; stopSrc(); renderTransport(); draw(); }
const toggle = () => (E.playing ? pause() : play());
function seek(t) {
  const was = E.playing; if (was) { E.playing = false; stopSrc(); }
  E.offset = clamp(t, 0, dur()); if (was) play(); else { renderTransport(); draw(); }
}
function closeEditor() { pause(); E.t = null; E.buffer = null; E.bands = null; E.token++; }

function phrasesFor(buffer, grid) {
  try { return phrasesFromEnergy(barEnergies(buffer.getChannelData(0), buffer.sampleRate, grid), grid); } catch { return []; }
}
async function loadAudio(t) {
  const token = ++E.token;
  try {
    let buffer;
    if (t.source === 'practice') buffer = synthDemoTrack(t);
    else if (t.source === 'rekordbox') buffer = await ctx.decodeAudioData(await lib.rekordboxDetail(t));
    else if (t.file) buffer = await ctx.decodeAudioData(await (await t.file()).arrayBuffer());
    else throw new Error('this track has no audio file');
    if (token !== E.token) return;
    if (!t.grid || t.grid.approx || !t.analysed) {
      const g = estimateGrid(buffer);
      lib.saveAnalysis(t, buffer, g, t.phrases?.length ? null : phrasesFor(buffer, g));
      send({ type: 'analysis', id: t.id, grid: t.grid, bpm: t.bpm, phrases: t.phrases });
    } else if (!t.phrases?.length && t.grid) { t.phrases = phrasesFor(buffer, t.grid); lib.persistAnalysis(t); }
    if (!t.duration) t.duration = buffer.duration;
    E.buffer = buffer;
    E.bands = bandPeaks(buffer.getChannelData(0), buffer.sampleRate, 400);
  } catch (err) {
    if (token === E.token) { console.error(err); E.err = err.message; }
  } finally {
    if (token === E.token) { E.loading = false; renderEditor(); renderTable(); }
  }
}

// ---------- the editor: grid edits ----------
let phraseTimer;
function applyGrid(g, { live = false } = {}) {
  const t = E.t; if (!t || !g) return;
  t.grid = g; t.bpm = g.bpm; t.analysed = true;
  if (live) { draw(); return; }
  lib.persistAnalysis(t);
  send({ type: 'analysis', id: t.id, grid: g, bpm: g.bpm });
  clearTimeout(phraseTimer);
  phraseTimer = setTimeout(() => {
    if (E.t !== t || !E.buffer) return;
    t.phrases = phrasesFor(E.buffer, t.grid); lib.persistAnalysis(t);
    send({ type: 'analysis', id: t.id, grid: t.grid, bpm: t.bpm, phrases: t.phrases });
    draw();
  }, 500);
  renderEditor(); renderTable();
}
function gridAction(a, e = {}) {
  const t = E.t, g = t?.grid; if (!g) return;
  const big = e.shiftKey;
  if (a === 'one') return applyGrid(M.gridSetOne(g, pos()));
  if (a === 'early') return applyGrid(M.gridNudge(g, big ? -0.02 : -0.005));
  if (a === 'late') return applyGrid(M.gridNudge(g, big ? 0.02 : 0.005));
  if (a === 'beat') return applyGrid(M.gridShiftBeat(g));
  if (a === 'bpm-') return applyGrid(M.gridSetBpm(g, g.bpm - (big ? 0.1 : 0.01)));
  if (a === 'bpm+') return applyGrid(M.gridSetBpm(g, g.bpm + (big ? 0.1 : 0.01)));
  if (a === 'half') return applyGrid(M.gridSetBpm(g, g.bpm / 2) || g);
  if (a === 'double') return applyGrid(M.gridSetBpm(g, g.bpm * 2) || g);
  if (a === 'whole') return applyGrid(M.gridSetBpm(g, Math.round(g.bpm)));
  if (a === 'tap') {
    const r = M.tapTempo(E.taps, performance.now()); E.taps = r.taps;
    if (!r.bpm) return toast(`Keep tapping on the beat (${r.more} more)`);
    return applyGrid(M.gridSetBpm(g, r.bpm) || g);
  }
  if (a === 'click') { E.click = !E.click; E.lastClick = pos() - 0.001; return renderEditor(); }
  if (a === 'again') {
    if (!E.buffer) return;
    if (!confirm('Work out the beat grid again from the audio?\n\nYour changes to this grid will be replaced.')) return;
    const fresh = estimateGrid(E.buffer);
    return applyGrid({ ...fresh, adjusted: false });
  }
}

// ---------- the editor: cues ----------
function hotCue(i, { clear = false } = {}) {
  const t = E.t; if (!t) return;
  const cur = hotOf(t)[i];
  if (clear) { if (cur == null) return; updateMap('cues', t.id, (own) => M.clearHotCue(own || [], i)); }
  else if (cur == null) { updateMap('cues', t.id, (own) => M.setHotCue(own || [], i, M.snapTime(t.grid, pos()))); }
  else return seek(cur);
  renderEditor(); renderTable(); draw();
}
function setCuePoint() {
  const t = E.t; if (!t) return;
  updateMap('cuepoints', t.id, () => M.snapTime(t.grid, pos()));
  renderEditor(); draw();
}
function addMemory() {
  const t = E.t; if (!t) return;
  updateMap('memcues', t.id, (list) => M.addMemoryCue(list || [], M.snapTime(t.grid, pos())));
  renderEditor(); renderTable(); draw();
}
function cueRowAction(kind, i, a, value) {
  const t = E.t; if (!t) return;
  if (kind === 'hot') {
    if (a === 'go') return seek(hotOf(t)[i]);
    if (a === 'del') return hotCue(i, { clear: true });
    if (a === 'name') updateMap('cuenames', t.id, (n) => { const x = [...(n || [])]; x[i] = String(value).slice(0, 40); return x.some(Boolean) ? x : null; });
  } else if (kind === 'mem') {
    const c = memOf(t)[i]; if (!c) return;
    if (a === 'go') return seek(c.time);
    if (a === 'del') updateMap('memcues', t.id, (list) => M.removeMemoryCue(list || [], c.time));
    if (a === 'name') updateMap('memcues', t.id, (list) => M.renameMemoryCue(list || [], c.time, value));
  } else if (kind === 'cue' && a === 'go') return seek(cuePointOf(t));
  if (a !== 'name') { renderEditor(); renderTable(); }
  draw();
}

// ---------- the editor: track details ----------
async function saveInfo(form) {
  const t = E.t; if (!t || t.source !== 'managed') return;
  const f = Object.fromEntries(new FormData(form).entries());
  const fields = { title: f.title, artist: f.artist, genre: f.genre, key: f.key, energy: f.energy, comment: f.comment, rating: t.rating || 0 };
  try {
    await desktop.library.updateMeta(t.libId, fields);
    Object.assign(t, { title: fields.title.trim() || t.title, artist: fields.artist.trim(), genre: fields.genre.trim(), key: fields.key.trim(), camelot: toCamelot(fields.key.trim()), energy: fields.energy ? clamp(Math.round(+fields.energy), 1, 10) : null, comment: fields.comment });
    send({ type: 'library' });
    toast('Saved.');
    renderTable(); renderEditorHead();
  } catch (err) { toast(`Couldn't save: ${err.message}`); }
}
async function setRating(n) {
  const t = E.t; if (!t || t.source !== 'managed') return;
  t.rating = t.rating === n ? 0 : n;
  try { await desktop.library.updateMeta(t.libId, { rating: t.rating }); send({ type: 'library' }); } catch (err) { toast(`Couldn't save: ${err.message}`); }
  renderEditor();
}

// ---------- rendering: editor ----------
function renderEditorHead() {
  const t = E.t, el = $('#edHead'); if (!t || !el) return;
  const st = M.gridStatus(t);
  el.innerHTML = `<div class="ed-title"><b>${esc(t.title)}</b><span>${esc(t.artist || 'Unknown artist')}${t.genre ? ` · ${esc(t.genre)}` : ''}</span></div>
    <span class="grow"></span>
    <div class="ed-facts"><span>BPM <b>${t.grid?.bpm ? t.grid.bpm.toFixed(2) : '–'}</b></span><span>Key <b>${esc(t.camelot || '–')}</b></span><span>Length <b>${M.fmtDur(dur())}</b></span><span>Energy <b>${energyOf(t) ?? '–'}</b></span><span><span class="gdot ${st}"></span> ${esc(M.GRID_LABEL[st])}</span></div>
    <div class="tabs" role="tablist"><button data-tab="edit" class="${E.tab === 'edit' ? 'on' : ''}">Grid &amp; cues</button><button data-tab="info" class="${E.tab === 'info' ? 'on' : ''}">Details</button></div>
    <button class="small" data-load="left" title="Load on deck A in Cue Coach">Load A</button><button class="small" data-load="right" title="Load on deck B in Cue Coach">Load B</button>`;
}
function renderEditor() {
  const el = $('#editor'), t = E.t;
  if (!t) { el.innerHTML = ''; return; }
  if (!$('#edHead')) {
    el.innerHTML = `<div class="ed-head" id="edHead"></div>
      <div class="waves" id="waves"><canvas id="overview" aria-label="Whole track: click to jump"></canvas><canvas id="zoom" aria-label="Beat grid: drag to move through the track, Shift-drag to slide the grid"></canvas><div class="wave-msg" id="waveMsg"></div></div>
      <div id="edBody"></div>`;
    bindWaves();
  }
  renderEditorHead();
  $('#waves').classList.toggle('hidden', E.tab !== 'edit');
  $('#waveMsg').textContent = E.loading ? 'Loading the audio…' : E.err ? `Couldn't open this track: ${E.err}` : '';
  $('#edBody').innerHTML = E.tab === 'edit' ? toolsHTML(t) : infoHTML(t);
  draw();
}
function toolsHTML(t) {
  const g = t.grid, hot = hotOf(t), names = namesOf(t), mem = memOf(t), ready = !!E.buffer;
  const dis = ready ? '' : 'disabled';
  const pads = hot.map((x, i) => `<button class="pad ${x != null ? 'set' : ''}" style="--hc:${M.cueColor(i)}" data-hot="${i}" ${dis} title="${x != null ? `Jump to hot cue ${i + 1}${names[i] ? ` (${esc(names[i])})` : ''}. Alt-click to clear.` : `Set hot cue ${i + 1} here (key ${i + 1})`}"><b>${i + 1}</b><small>${x != null ? esc(names[i] || M.fmtCue(x)) : 'Set'}</small>${x != null ? `<span class="x" data-hot-x="${i}" aria-label="Clear hot cue ${i + 1}">×</span>` : ''}</button>`).join('');
  const list = [
    `<div class="cl-row"><span class="sw" style="background:${C.close}">C</span><span class="num">${M.fmtCue(cuePointOf(t))}</span><span class="dim">CUE point (where the track starts on a deck)</span><span class="acts"><button data-cl="cue:0:go">Go</button></span></div>`,
    ...hot.map((x, i) => (x == null ? '' : `<div class="cl-row"><span class="sw" style="background:${M.cueColor(i)}">${i + 1}</span><span class="num">${M.fmtCue(x)}</span><input type="text" data-cl-name="hot:${i}" value="${esc(names[i] || '')}" placeholder="Name this cue" maxlength="40"><span class="acts"><button data-cl="hot:${i}:go">Go</button><button data-cl="hot:${i}:del" aria-label="Delete">×</button></span></div>`)),
    ...mem.map((c, i) => `<div class="cl-row"><span class="sw" style="background:${C.ink3}">M</span><span class="num">${M.fmtCue(c.time)}</span>${c.fixed ? `<span class="dim">${esc(c.name || 'rekordbox memory cue')}</span>` : `<input type="text" data-cl-name="mem:${i}" value="${esc(c.name)}" placeholder="Name this memory cue" maxlength="40">`}<span class="acts"><button data-cl="mem:${i}:go">Go</button>${c.fixed ? '' : `<button data-cl="mem:${i}:del" aria-label="Delete">×</button>`}</span></div>`),
  ].join('');
  const rbNote = t.source === 'rekordbox' ? '<span class="small muted">rekordbox tracks: grid changes last until you quit.</span>' : '';
  return `<div class="ed-tools">
    <div class="group"><h3>Play</h3>
      <div class="row"><button class="play-btn primary" data-ed="play" ${dis} aria-label="${E.playing ? 'Pause' : 'Play'}">${icon(E.playing ? 'pause' : 'play', 16)}</button>
        <button class="cue-btn" data-ed="cue-go" ${dis} title="Back to the CUE point">CUE</button><span class="tc" id="tc">${M.fmtCue(pos())}</span></div>
      <div class="row"><button data-ed="bar-" ${dis} title="Back a bar (Shift ←)">‹ Bar</button><button data-ed="bar+" ${dis} title="Forward a bar (Shift →)">Bar ›</button><span class="lbl">Zoom</span><button data-ed="zoom-" aria-label="Zoom out">−</button><button data-ed="zoom+" aria-label="Zoom in">+</button></div>
      <div class="row"><button data-ed="set-cue" ${dis} title="Make this spot the CUE point (C)">Set CUE here</button></div>
    </div>
    <div class="group"><h3>Beat grid <span class="gs"><span class="gdot ${M.gridStatus(t)}"></span>${esc(M.GRID_LABEL[M.gridStatus(t)])}</span></h3>
      <div class="row"><button class="primary" data-grid="one" ${dis} title="Pause on the first kick of a bar, then press">Set the 1 here</button>
        <span class="lbl">Slide</span><button data-grid="early" ${dis} title="Grid 5 ms earlier ([). Shift: 20 ms">‹</button><button data-grid="late" ${dis} title="Grid 5 ms later (]). Shift: 20 ms">›</button>
        <button data-grid="beat" ${dis} title="The beats line up, but the bar starts on the wrong one">Move the 1 a beat</button></div>
      <div class="row"><span class="lbl" style="margin-left:0">BPM</span><button data-grid="bpm-" ${dis} aria-label="BPM down 0.01 (Shift: 0.1)">−</button><input type="number" id="bpmIn" step="0.01" min="40" max="250" value="${g ? g.bpm.toFixed(2) : ''}" ${dis} aria-label="BPM"><button data-grid="bpm+" ${dis} aria-label="BPM up 0.01 (Shift: 0.1)">+</button>
        <button data-grid="half" ${dis} title="Half">÷2</button><button data-grid="double" ${dis} title="Double">×2</button><button data-grid="whole" ${dis} title="Round to a whole number">Whole</button><button data-grid="tap" ${dis} title="Tap along with the beat (T)">Tap</button></div>
      <div class="row"><button data-grid="click" class="${E.click ? 'on' : ''}" aria-pressed="${E.click}" ${dis}>${icon('metronome', 13)} Click</button><button class="ghost" data-grid="again" ${dis}>Analyse again</button>${rbNote || '<span class="small muted">Shift-drag the waveform to slide the grid.</span>'}</div>
    </div>
    <div class="group"><h3>Cues<span class="grow"></span><button class="ghost small" data-ed="mem" ${dis} title="Add a memory cue here (M)">${icon('plus', 12)} Memory cue</button></h3>
      <div class="pads">${pads}</div>
      <div class="cue-list">${list}</div>
    </div></div>`;
}
function infoHTML(t) {
  const can = t.source === 'managed' && !!desktop?.library?.updateMeta, ro = can ? '' : 'disabled';
  const stars = [1, 2, 3, 4, 5].map((n) => `<button type="button" data-star="${n}" class="${(t.rating || 0) >= n ? 'on' : ''}" ${ro} aria-label="${n} star${n > 1 ? 's' : ''}">★</button>`).join('');
  return `<form class="info" id="infoForm">
    <label class="wide">Title<input type="text" name="title" value="${esc(t.title)}" ${ro}></label>
    <label class="wide">Artist<input type="text" name="artist" value="${esc(t.artist)}" ${ro}></label>
    <label>Genre<input type="text" name="genre" value="${esc(t.genre)}" ${ro}></label>
    <label>Key<input type="text" name="key" value="${esc(t.key || t.camelot || '')}" placeholder="e.g. 8A or Am" ${ro}></label>
    <label>Energy (1–10)<input type="number" name="energy" min="1" max="10" value="${t.energy ?? ''}" placeholder="${t.energyEst ? `about ${t.energyEst}` : ''}" ${ro}></label>
    <label>Rating<span class="stars">${stars}</span></label>
    <label class="full">Comment<input type="text" name="comment" value="${esc(t.comment || '')}" placeholder="Notes for later: where you like to mix in, what it works with…" ${ro}></label>
    <div class="note">${can ? '<button class="primary" type="submit">Save details</button>' : t.source === 'practice' ? 'Practice tracks can\'t be edited.' : 'These details come from the file. Copy the track into My library (in the desktop app) to edit them.'}${t.path ? `<span class="small muted" style="margin-left:10px">${esc(t.path)}</span>` : ''}</div>
  </form>`;
}
function renderTransport() {
  const b = $('[data-ed="play"]'); if (b) { b.innerHTML = icon(E.playing ? 'pause' : 'play', 16); b.setAttribute('aria-label', E.playing ? 'Pause' : 'Play'); }
  const tc = $('#tc'); if (tc) tc.textContent = M.fmtCue(pos());
}

// ---------- waveforms ----------
function fit(cv) {
  const dpr = window.devicePixelRatio || 1, w = Math.round(cv.clientWidth * dpr), h = Math.round(cv.clientHeight * dpr);
  if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
  return { g: cv.getContext('2d'), w, h, dpr };
}
/** Three-band waveform between t0 and t1 across the canvas width. */
function drawBands(g, w, h, t0, t1, top = 0, height = h) {
  const B = E.bands; if (!B) return;
  const mid = top + height / 2, half = height / 2 - 1, per = (t1 - t0) / w;
  const cols = [[B.low, C.left, 1], [B.mid, C.right, 0.85], [B.high, C.ink2, 0.7]];
  for (const [arr, color, k] of cols) {
    g.fillStyle = color; g.globalAlpha = color === C.ink2 ? 0.55 : 0.9;
    for (let x = 0; x < w; x++) {
      const a = Math.floor((t0 + x * per) * B.rate), b = Math.max(a + 1, Math.floor((t0 + (x + 1) * per) * B.rate));
      if (b <= 0 || a >= arr.length) continue;
      let m = 0; for (let i = Math.max(0, a); i < Math.min(arr.length, b); i++) if (arr[i] > m) m = arr[i];
      const y = m * half * k; if (y < 0.5) continue;
      g.fillRect(x, mid - y, 1, y * 2);
    }
  }
  g.globalAlpha = 1;
}
function marker(g, x, h, color, label, dpr, { bottom = false } = {}) {
  g.fillStyle = color; g.fillRect(Math.round(x), 0, Math.max(1, dpr), h);
  if (label != null) {
    const s = 13 * dpr;
    g.beginPath();
    if (bottom) { g.moveTo(x, h - s * 0.7); g.lineTo(x + s * 0.55, h); g.lineTo(x - s * 0.55, h); }
    else { g.rect(x, 0, s, s); }
    g.fill();
    if (label) { g.fillStyle = '#fff'; g.font = `700 ${9 * dpr}px system-ui, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(label, x + s / 2, s / 2 + 0.5); }
  }
}
function draw() {
  const t = E.t, ov = $('#overview'), zm = $('#zoom');
  if (!t || !ov || !zm || E.tab !== 'edit' || ov.clientWidth === 0) return;
  const D = dur() || 1, p = pos(), hot = hotOf(t), mem = memOf(t), cp = cuePointOf(t);
  // overview: the whole track, its parts, cues and where we are
  {
    const { g, w, h, dpr } = fit(ov);
    g.clearRect(0, 0, w, h);
    const strip = 5 * dpr;
    for (const ph of t.phrases || []) { g.fillStyle = phraseColor(ph.label); g.globalAlpha = 0.85; g.fillRect((ph.start / D) * w, h - strip, ((ph.end - ph.start) / D) * w, strip); }
    g.globalAlpha = 1;
    drawBands(g, w, h, 0, D, 0, h - strip);
    const vis = (E.span / D) * w;
    g.fillStyle = C.ink; g.globalAlpha = 0.08; g.fillRect((p / D) * w - vis / 2, 0, vis, h); g.globalAlpha = 1;
    hot.forEach((x, i) => { if (x != null) { g.fillStyle = M.cueColor(i); g.fillRect((x / D) * w - dpr, 0, 2 * dpr, 6 * dpr); } });
    for (const c of mem) { g.fillStyle = C.ink3; g.fillRect((c.time / D) * w - dpr / 2, h - strip - 6 * dpr, dpr * 1.5, 6 * dpr); }
    g.fillStyle = C.close; g.fillRect((cp / D) * w - dpr, 0, 2 * dpr, 4 * dpr);
    g.fillStyle = C.ink; g.fillRect(Math.round((p / D) * w), 0, Math.max(1, dpr * 1.5), h);
  }
  // zoom: beat grid, bar numbers, cues, a fixed playhead in the middle
  {
    const { g, w, h, dpr } = fit(zm);
    g.clearRect(0, 0, w, h);
    const t0 = p - E.span / 2, t1 = p + E.span / 2, X = (tt) => ((tt - t0) / E.span) * w;
    if (t0 < 0) { g.fillStyle = C.line; g.globalAlpha = 0.5; g.fillRect(0, 0, X(0), h); g.globalAlpha = 1; }
    if (t1 > D) { g.fillStyle = C.line; g.globalAlpha = 0.5; g.fillRect(X(D), 0, w - X(D), h); g.globalAlpha = 1; }
    drawBands(g, w, h, t0, t1, 14 * dpr, h - 14 * dpr);
    const beats = M.beatsBetween(t.grid, t0, t1);
    const pxBeat = t.grid ? (60 / t.grid.bpm / E.span) * w : 0;
    g.font = `600 ${10 * dpr}px system-ui, sans-serif`; g.textBaseline = 'top'; g.textAlign = 'left';
    for (const b of beats) {
      const x = Math.round(X(b.time)), one = b.beat === 1, phrase = one && (b.bar - 1) % 16 === 0;
      if (!one && pxBeat < 5 * dpr) continue;
      g.fillStyle = phrase ? C.right : one ? C.ink : C.ink3;
      g.globalAlpha = one ? 0.75 : 0.35;
      g.fillRect(x, one ? 0 : 14 * dpr, one ? Math.max(1, dpr * 1.5) : Math.max(1, dpr), h);
      g.globalAlpha = 1;
      if (one && b.bar >= 1 && (pxBeat * 4 > 26 * dpr || (b.bar - 1) % 4 === 0)) { g.fillStyle = phrase ? C.right : C.ink2; g.fillText(String(b.bar), x + 3 * dpr, 2 * dpr); }
    }
    for (const c of mem) if (c.time >= t0 && c.time <= t1) marker(g, X(c.time), h, C.ink3, '', dpr, { bottom: true });
    if (cp >= t0 && cp <= t1) marker(g, X(cp), h, C.close, 'C', dpr, { bottom: false });
    hot.forEach((x, i) => { if (x != null && x >= t0 && x <= t1) marker(g, X(x), h, M.cueColor(i), String(i + 1), dpr); });
    g.fillStyle = C.ink; g.fillRect(Math.round(w / 2) - dpr, 0, 2 * dpr, h);
  }
  const tc = $('#tc'); if (tc) tc.textContent = M.fmtCue(p);
}
let looping = false;
function loop() {
  if (looping) return; looping = true;
  const step = () => {
    if (!E.playing) { looping = false; draw(); renderTransport(); return; }
    clickAhead(); draw();
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
/** The metronome: a short blip on every beat (higher on the 1), scheduled just ahead. */
function clickAhead() {
  const g = E.t?.grid; if (!E.click || !g) return;
  const now = pos();
  for (const b of M.beatsBetween(g, Math.max(E.lastClick + 0.001, now), now + 0.15)) {
    const when = E.anchor + (b.time - E.offset); if (when < ctx.currentTime) continue;
    const o = ctx.createOscillator(), v = ctx.createGain();
    o.frequency.value = b.beat === 1 ? 1760 : 1175;
    v.gain.setValueAtTime(0.0001, when); v.gain.exponentialRampToValueAtTime(0.5, when + 0.002); v.gain.exponentialRampToValueAtTime(0.0001, when + 0.04);
    o.connect(v); v.connect(out); o.start(when); o.stop(when + 0.05);
    E.lastClick = b.time;
  }
}

function bindWaves() {
  const ov = $('#overview'), zm = $('#zoom');
  const seekOv = (e) => { const r = ov.getBoundingClientRect(); seek(((e.clientX - r.left) / r.width) * dur()); };
  ov.addEventListener('pointerdown', (e) => { if (!E.buffer) return; ov.setPointerCapture(e.pointerId); seekOv(e); ov.onpointermove = seekOv; });
  ov.addEventListener('pointerup', () => { ov.onpointermove = null; });
  zm.addEventListener('pointerdown', (e) => {
    if (!E.buffer) return;
    zm.setPointerCapture(e.pointerId);
    const perPx = E.span / zm.getBoundingClientRect().width;
    if (e.shiftKey && E.t.grid) { // slide the grid with the mouse
      E.drag = { kind: 'grid', x: e.clientX, perPx, g0: E.t.grid }; zm.classList.add('grid-drag');
    } else {
      E.drag = { kind: 'scrub', x: e.clientX, perPx, o0: pos(), was: E.playing }; if (E.playing) pause(); zm.classList.add('dragging');
    }
  });
  zm.addEventListener('pointermove', (e) => {
    const d = E.drag; if (!d) return;
    const dt = (e.clientX - d.x) * d.perPx;
    if (d.kind === 'grid') applyGrid(M.gridNudge(d.g0, dt), { live: true });
    else { E.offset = clamp(d.o0 - dt, 0, dur()); draw(); }
  });
  const end = () => {
    const d = E.drag; if (!d) return; E.drag = null; zm.classList.remove('dragging', 'grid-drag');
    if (d.kind === 'grid') applyGrid(E.t.grid);
    else if (d.was) play();
  };
  zm.addEventListener('pointerup', end); zm.addEventListener('pointercancel', end);
  zm.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) { seek(pos() + e.deltaX * E.span / 1200); return; }
    zoom(e.deltaY > 0 ? 1.15 : 1 / 1.15);
  }, { passive: false });
  new ResizeObserver(() => draw()).observe(zm);
}
function zoom(f) { E.span = clamp(E.span * f, 1.5, 64); draw(); }

// ---------- menus ----------
function closeMenu() { $('.menu')?.remove(); }
function openMenu(x, y, items) {
  closeMenu();
  const m = document.createElement('div'); m.className = 'menu'; m.setAttribute('role', 'menu');
  m.innerHTML = items.map((it) => (it === '-' ? '<hr>' : it.head ? `<div class="mh">${esc(it.head)}</div>` : `<button role="menuitem" data-mi="${items.indexOf(it)}" ${it.disabled ? 'disabled' : ''}>${it.icon ? icon(it.icon, 14) : ''}${esc(it.label)}</button>`)).join('');
  document.body.append(m);
  const r = m.getBoundingClientRect();
  m.style.left = `${Math.min(x, innerWidth - r.width - 8)}px`; m.style.top = `${Math.min(y, innerHeight - r.height - 8)}px`;
  m.addEventListener('click', (e) => { const b = e.target.closest('[data-mi]'); if (!b) return; closeMenu(); items[+b.dataset.mi].run(); });
  m.querySelector('button')?.focus();
}
function addToItems(ids) {
  const items = [{ head: 'Set lists' }];
  if (S.current?.items?.length) items.push({ label: `${S.current.title || NEW_SET_TITLE} (in Cue Coach)`, icon: 'play', run: () => addToSetList({ kind: 'current' }, ids) });
  for (const s of S.sets.slice(0, 15)) if (!(S.view.kind === 'set' && S.view.id === s.id)) items.push({ label: s.title, icon: 'list', run: () => addToSetList({ kind: 'set', id: s.id }, ids) });
  items.push({ label: 'New set list…', icon: 'plus', run: () => newSetFrom(ids) });
  if (S.source === 'managed') {
    items.push('-', { head: 'Crates' });
    for (const c of S.crates.slice(0, 15)) if (!(S.view.kind === 'crate' && S.view.id === c.id)) items.push({ label: c.name, icon: 'crate', run: () => addToCrate(c.id, ids) });
    items.push({ label: 'New crate…', icon: 'plus', run: () => newCrateFrom(ids) });
  }
  return items;
}
function rowMenu(e, id) {
  if (!S.sel.has(id)) selectRow(id);
  const ids = selectedIds().length ? selectedIds() : [id];
  const one = ids.length === 1;
  const items = [
    ...(one ? [{ label: 'Load on deck A', run: () => loadOnDeck(id, 'left') }, { label: 'Load on deck B', run: () => loadOnDeck(id, 'right') }, '-'] : []),
    ...addToItems(ids),
  ];
  if (isSetView() || S.view.kind === 'crate') items.push('-', { label: `Remove from ${viewTitle()}`, icon: 'x', run: () => removeFromView(ids) });
  openMenu(e.clientX, e.clientY, items);
}
function loadOnDeck(id, side) {
  send({ type: 'load', id, side });
  toast(`Sent "${S.tracks.find((t) => t.id === id)?.title || 'the track'}" to deck ${side === 'left' ? 'A' : 'B'} in Cue Coach.`);
}
function exportM3U() {
  const tracks = S.rows.length ? S.rows : [];
  const withPath = tracks.filter((t) => t.path);
  if (!withPath.length) return toast('These tracks have no file paths to export (practice and music-folder tracks don\'t). Use My library or rekordbox.');
  const blob = new Blob([M.toM3U(viewTitle(), tracks)], { type: 'audio/x-mpegurl' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${viewTitle().replace(/[\\/:*?"<>|]/g, '-')}.m3u8`; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  toast(`Exported ${withPath.length} track${withPath.length === 1 ? '' : 's'}${withPath.length < tracks.length ? ` (${tracks.length - withPath.length} without a file left out)` : ''}.`);
}

// ---------- events ----------
function bind() {
  $('#searchIcon').innerHTML = icon('search', 14);
  $('#search').addEventListener('input', (e) => { S.query = e.target.value; renderTable(); });

  // sidebar
  const side = $('#side');
  side.addEventListener('change', (e) => { if (e.target.id === 'sourceSel') { S.view = { kind: 'all' }; shared.set('mgrView', S.view); useSource(e.target.value, { gesture: true }); } });
  side.addEventListener('click', (e) => {
    if (e.target.closest('[data-rename]')) return;
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (a === 'new-set') return newSetFrom([]);
    if (a === 'new-crate') return newCrateFrom([]);
    if (a === 'reconnect' || a === 'pick-folder') return useSource('folder', { gesture: true });
    const n = e.target.closest('[data-view]'); if (!n) return;
    const [kind, id] = n.dataset.view.split(/:(.*)/s);
    setView(kind === 'all' || kind === 'todo' ? { kind } : kind === 'current' ? { kind: 'current' } : { kind, id });
  });
  side.addEventListener('dblclick', (e) => {
    const n = e.target.closest('[data-view]'); if (!n) return;
    const v = n.dataset.view; if (!/^(set|crate|current):/.test(v)) return;
    S.editName = v; renderSide(); focusRename();
  });
  side.addEventListener('keydown', (e) => {
    const inp = e.target.closest('[data-rename]');
    if (inp) { if (e.key === 'Enter') commitRename(inp, true); if (e.key === 'Escape') commitRename(inp, false); return; }
    const n = e.target.closest('[data-view], [data-a]');
    if (n && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); n.click(); }
  });
  side.addEventListener('contextmenu', (e) => {
    const n = e.target.closest('[data-view]'); if (!n) return;
    const [kind, id] = n.dataset.view.split(/:(.*)/s);
    if (kind === 'set') { e.preventDefault(); openMenu(e.clientX, e.clientY, [{ label: 'Use in Cue Coach', icon: 'play', run: () => playSetInLearn(id) }, { label: 'Rename', icon: 'pencil', run: () => { S.editName = `set:${id}`; renderSide(); focusRename(); } }, { label: 'Duplicate', run: () => { const r = M.duplicateSetList(S.sets, id); S.sets = r.list; shared.set('savedSets', S.sets); renderAll(); } }, '-', { label: 'Delete set list', icon: 'trash', run: () => deleteSet(id) }]); }
    if (kind === 'crate') { e.preventDefault(); openMenu(e.clientX, e.clientY, [{ label: 'Rename', icon: 'pencil', run: () => { S.editName = `crate:${id}`; renderSide(); focusRename(); } }, { label: 'Make a set list from it', icon: 'list', run: () => newSetFrom(S.crates.find((c) => c.id === id)?.trackIds.map((l) => `lib:${l}`) || []) }, '-', { label: 'Delete crate', icon: 'trash', run: () => deleteCrate(id) }]); }
  });
  document.addEventListener('focusout', (e) => { const inp = e.target.closest?.('[data-rename]'); if (inp) commitRename(inp, true); });

  // dropping tracks on crates and set lists
  const dropOf = (e) => e.target.closest('[data-drop]');
  side.addEventListener('dragover', (e) => {
    const n = dropOf(e); if (!n || !e.dataTransfer.types.includes(DRAG_TYPE)) return;
    const d = n.dataset.drop; if (d === 'all' || d === 'todo') return;
    e.preventDefault(); e.dataTransfer.dropEffect = 'copy';
    $$('.node.drop', side).forEach((x) => x !== n && x.classList.remove('drop')); n.classList.add('drop');
  });
  side.addEventListener('dragleave', (e) => { const n = dropOf(e); if (n && !n.contains(e.relatedTarget)) n.classList.remove('drop'); });
  side.addEventListener('drop', (e) => {
    const n = dropOf(e); $$('.node.drop', side).forEach((x) => x.classList.remove('drop'));
    if (!n) return; e.preventDefault();
    let ids = []; try { ids = JSON.parse(e.dataTransfer.getData(DRAG_TYPE) || '[]'); } catch { /* nothing */ }
    if (!ids.length) return;
    const [kind, id] = n.dataset.drop.split(/:(.*)/s);
    if (kind === 'new-set') newSetFrom(ids);
    else if (kind === 'set') addToSetList({ kind: 'set', id }, ids);
    else if (kind === 'current') addToSetList({ kind: 'current' }, ids);
    else if (kind === 'crate') addToCrate(id, ids);
  });
  // "New crate" + also takes drops
  side.addEventListener('dragover', (e) => { const b = e.target.closest('[data-a="new-crate"]'); if (b && e.dataTransfer.types.includes(DRAG_TYPE)) e.preventDefault(); });
  side.addEventListener('drop', (e) => { const b = e.target.closest('[data-a="new-crate"]'); if (!b) return; e.preventDefault(); try { newCrateFrom(JSON.parse(e.dataTransfer.getData(DRAG_TYPE) || '[]')); } catch { /* nothing */ } });

  // heading
  const head = $('#listHead');
  head.addEventListener('click', (e) => {
    const a = e.target.closest('[data-a]')?.dataset.a; if (!a) return;
    const v = S.view;
    if (a === 'play-set') return playSetInLearn(v.id);
    if (a === 'dup-set') { const r = M.duplicateSetList(S.sets, v.id); S.sets = r.list; shared.set('savedSets', S.sets); return setView({ kind: 'set', id: r.id }); }
    if (a === 'del-set') return deleteSet(v.id);
    if (a === 'save-current') return saveCurrentAsList();
    if (a === 'del-crate') return deleteCrate(v.id);
    if (a === 'crate-to-set') return newSetFrom(lib.tracksInCrate(S.tracks, crateOf()).map((t) => t.id));
    if (a === 'm3u') return exportM3U();
    if (a === 'f-key') { S.f.matchKey = !S.f.matchKey; return renderTable(); }
    if (a === 'f-grid') { S.f.gridTodo = !S.f.gridTodo; return renderTable(); }
    if (a === 'f-clear') { S.f = { bpmMin: null, bpmMax: null, matchKey: false, gridTodo: false }; S.query = ''; $('#search').value = ''; return renderTable(); }
    if (a === 'add-menu') { const r = e.target.closest('button').getBoundingClientRect(); return openMenu(r.left, r.bottom + 4, addToItems(selectedIds())); }
    if (a === 'remove-sel') return removeFromView(selectedIds());
  });
  head.addEventListener('dblclick', (e) => { if (e.target.closest('[data-a="rename-view"]')) { S.editName = S.view.kind === 'current' ? 'current:' : `${S.view.kind}:${S.view.id}`; renderHead(); focusRename(); } });
  head.addEventListener('keydown', (e) => { const inp = e.target.closest('[data-rename]'); if (inp) { if (e.key === 'Enter') commitRename(inp, true); if (e.key === 'Escape') commitRename(inp, false); } });
  head.addEventListener('change', (e) => {
    const k = e.target.dataset.f; if (!k) return;
    const v = e.target.value === '' ? null : Number(e.target.value);
    S.f[k] = Number.isFinite(v) ? v : null; renderTable();
  });
  head.addEventListener('click', (e) => { const d = e.target.closest('[data-eid]'); if (d) selectRow(d.dataset.eid); });

  // table
  const table = $('#table');
  table.addEventListener('click', (e) => {
    const th = e.target.closest('th[data-sort]');
    if (th) { const c = th.dataset.sort; S.sort = S.sort.col === c ? (S.sort.dir > 0 ? { col: c, dir: -1 } : { col: null, dir: 1 }) : { col: c, dir: 1 }; shared.set('mgrSort', S.sort); return renderTable(); }
    const tr = e.target.closest('tr[data-id]'); if (!tr) return;
    const ld = e.target.closest('[data-load]'); if (ld) return loadOnDeck(tr.dataset.id, ld.dataset.load);
    selectRow(tr.dataset.id, e);
  });
  table.addEventListener('dblclick', (e) => { const tr = e.target.closest('tr[data-id]'); if (tr && !e.target.closest('button')) { if (E.buffer && E.t?.id === tr.dataset.id) toggle(); } });
  table.addEventListener('contextmenu', (e) => { const tr = e.target.closest('tr[data-id]'); if (!tr) return; e.preventDefault(); rowMenu(e, tr.dataset.id); });
  let dragIds = null;
  table.addEventListener('dragstart', (e) => {
    const tr = e.target.closest('tr[data-id]'); if (!tr) return;
    const id = tr.dataset.id;
    if (!S.sel.has(id)) { S.sel = new Set([id]); S.anchor = id; $$('tr.sel', table).forEach((r) => r.classList.remove('sel')); tr.classList.add('sel'); }
    dragIds = selectedIds();
    e.dataTransfer.setData(DRAG_TYPE, JSON.stringify(dragIds));
    e.dataTransfer.setData('text/plain', dragIds.map((x) => S.tracks.find((t) => t.id === x)?.title).join('\n'));
    e.dataTransfer.effectAllowed = 'copyMove';
    const ghost = document.createElement('div'); ghost.className = 'drag-ghost';
    ghost.textContent = dragIds.length === 1 ? (S.tracks.find((t) => t.id === id)?.title || '1 track') : `${dragIds.length} tracks`;
    document.body.append(ghost); e.dataTransfer.setDragImage(ghost, 10, 10); setTimeout(() => ghost.remove(), 0);
    for (const r of $$('tr.sel', table)) r.classList.add('dragging');
  });
  table.addEventListener('dragend', () => { dragIds = null; $$('tr.dragging, tr.drop-before, tr.drop-after', table).forEach((r) => r.classList.remove('dragging', 'drop-before', 'drop-after')); });
  // reordering a set list
  const dropRow = (e) => {
    const tr = e.target.closest('tr[data-id]'); if (!tr) return null;
    const r = tr.getBoundingClientRect();
    return { tr, after: e.clientY > r.top + r.height / 2 };
  };
  table.addEventListener('dragover', (e) => {
    if (!isSetView() || filtering() || !dragIds) return;
    const d = dropRow(e); if (!d) return;
    e.preventDefault(); e.dataTransfer.dropEffect = 'move';
    $$('tr.drop-before, tr.drop-after', table).forEach((r) => r.classList.remove('drop-before', 'drop-after'));
    d.tr.classList.add(d.after ? 'drop-after' : 'drop-before');
  });
  table.addEventListener('drop', (e) => {
    if (!isSetView() || filtering() || !dragIds) return;
    const d = dropRow(e); if (!d) return;
    e.preventDefault();
    const order = setOf().items.map((i) => i.id), moving = new Set(dragIds);
    const rest = order.filter((id) => !moving.has(id));
    let at = rest.indexOf(d.tr.dataset.id);
    if (at < 0) at = order.filter((id, i) => i < order.indexOf(d.tr.dataset.id) && !moving.has(id)).length; else if (d.after) at++;
    editItems(S.view, (items) => M.moveItems(items, dragIds, at));
  });

  // editor
  const ed = $('#editor');
  ed.addEventListener('click', (e) => {
    const tab = e.target.closest('[data-tab]'); if (tab) { E.tab = tab.dataset.tab; return renderEditor(); }
    const ld = e.target.closest('[data-load]'); if (ld && E.t) return loadOnDeck(E.t.id, ld.dataset.load);
    const x = e.target.closest('[data-hot-x]'); if (x) { e.stopPropagation(); return hotCue(+x.dataset.hotX, { clear: true }); }
    const p = e.target.closest('[data-hot]'); if (p) return hotCue(+p.dataset.hot, { clear: e.altKey });
    const gr = e.target.closest('[data-grid]'); if (gr) return gridAction(gr.dataset.grid, e);
    const cl = e.target.closest('[data-cl]'); if (cl) { const [k, i, a] = cl.dataset.cl.split(':'); return cueRowAction(k, +i, a); }
    const st = e.target.closest('[data-star]'); if (st) return setRating(+st.dataset.star);
    const a = e.target.closest('[data-ed]')?.dataset.ed; if (!a) return;
    if (a === 'play') return toggle();
    if (a === 'cue-go') { pause(); return seek(cuePointOf(E.t)); }
    if (a === 'set-cue') return setCuePoint();
    if (a === 'mem') return addMemory();
    if (a === 'zoom-') return zoom(1.4);
    if (a === 'zoom+') return zoom(1 / 1.4);
    const bar = E.t?.grid ? 240 / E.t.grid.bpm : 2;
    if (a === 'bar-') return seek(pos() - bar);
    if (a === 'bar+') return seek(pos() + bar);
  });
  ed.addEventListener('change', (e) => {
    if (e.target.id === 'bpmIn') { const g = M.gridSetBpm(E.t.grid, Number(e.target.value)); if (g) applyGrid(g); else renderEditor(); }
    const n = e.target.dataset?.clName; if (n) { const [k, i] = n.split(':'); cueRowAction(k, +i, 'name', e.target.value); }
  });
  ed.addEventListener('submit', (e) => { e.preventDefault(); saveInfo(e.target); });
  ed.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.dataset?.clName) e.target.blur(); });

  // keyboard
  window.addEventListener('keydown', onKey);
  document.addEventListener('pointerdown', (e) => { if (!e.target.closest('.menu')) closeMenu(); });
  window.addEventListener('blur', closeMenu);
  $('#helpBtn').addEventListener('click', showHelp);
}

function onKey(e) {
  if (e.key === 'Escape') { closeMenu(); if (e.target.matches?.('input')) e.target.blur(); return; }
  const typing = e.target.matches?.('input, textarea, select');
  const mod = e.metaKey || e.ctrlKey;
  if (mod && e.key.toLowerCase() === 'f') { e.preventDefault(); $('#search').focus(); return; }
  if (typing) return;
  if (mod && e.key.toLowerCase() === 'a') { e.preventDefault(); S.sel = new Set(S.rows.map((t) => t.id)); renderTable(); return; }
  if (mod || e.altKey) return;
  const k = e.key;
  if (k === 'ArrowDown' || k === 'ArrowUp') {
    e.preventDefault();
    const ids = S.rows.map((t) => t.id); if (!ids.length) return;
    const i = ids.indexOf(S.focus), n = clamp(i < 0 ? 0 : i + (k === 'ArrowDown' ? 1 : -1), 0, ids.length - 1);
    return selectRow(ids[n], { shiftKey: e.shiftKey });
  }
  if ((k === 'Delete' || k === 'Backspace') && (isSetView() || S.view.kind === 'crate')) { e.preventDefault(); return removeFromView(selectedIds()); }
  if (!E.t) return;
  if (k === ' ') { e.preventDefault(); return toggle(); }
  if (/^[1-8]$/.test(k)) return hotCue(+k - 1);
  if (/^Digit[1-8]$/.test(e.code) && e.shiftKey) return hotCue(+e.code.slice(5) - 1, { clear: true });
  const beat = E.t.grid ? 60 / E.t.grid.bpm : 0.5;
  if (k === 'ArrowLeft') { e.preventDefault(); return seek(pos() - (e.shiftKey ? 4 * beat : beat)); }
  if (k === 'ArrowRight') { e.preventDefault(); return seek(pos() + (e.shiftKey ? 4 * beat : beat)); }
  if (e.code === 'BracketLeft') return gridAction('early', e);
  if (e.code === 'BracketRight') return gridAction('late', e);
  const lk = k.toLowerCase();
  if (lk === 'c') return setCuePoint();
  if (lk === 'm') return addMemory();
  if (lk === 't') return gridAction('tap', e);
  if (lk === 'k') return gridAction('click', e);
  if (k === 'Home') { pause(); return seek(cuePointOf(E.t)); }
  if (k === '+' || k === '=') return zoom(1 / 1.4);
  if (k === '-') return zoom(1.4);
}
function showHelp() {
  const rows = [['Space', 'Play / pause'], ['1 – 8', 'Set or jump to a hot cue (Shift: clear)'], ['C', 'Set the CUE point here'], ['Home', 'Back to the CUE point'], ['M', 'Add a memory cue'],
    ['← →', 'Back / forward a beat (Shift: a bar)'], ['[ ]', 'Slide the grid 5 ms (Shift: 20 ms)'], ['T', 'Tap the tempo'], ['K', 'Metronome click'], ['+ −', 'Zoom the waveform'],
    ['↑ ↓', 'Next / previous track'], ['Delete', 'Remove from the set list or crate'], ['Shift-drag', 'Slide the grid on the waveform']];
  openMenu(innerWidth - 340, 52, [{ head: 'Keyboard shortcuts' }, ...rows.map(([a, b]) => ({ label: `${a}   ${b}`, run: () => {} }))]);
}

// ---------- the Learn window ----------
function bindSync() {
  onShared(['savedSets', 'set', 'cues', 'cuepoints', 'memcues', 'cuenames', 'theme'], (key) => {
    if (key === 'theme') return applyTheme();
    if (key === 'savedSets') S.sets = shared.get('savedSets', []);
    if (key === 'set') S.current = shared.get('set', null);
    if (S.view.kind === 'set' && !S.sets.some((x) => x.id === S.view.id)) S.view = { kind: 'all' };
    if (S.view.kind === 'current' && !S.current) S.view = { kind: 'all' };
    renderAll();
  });
  onMessage(async (m) => {
    if (m.type === 'analysis') {
      const t = S.tracks.find((x) => x.id === m.id); if (!t) return;
      if (m.grid) { t.grid = m.grid; t.bpm = m.bpm ?? m.grid.bpm; t.analysed = true; }
      if (m.phrases) t.phrases = m.phrases;
      renderTable(); if (E.t === t) { renderEditor(); }
    } else if (m.type === 'library') reloadManaged();
  });
  desktop?.library?.onProgress?.((p) => { if (p.finished) reloadManaged(); });
}
/** My library changed in the other window: take the new details and crates, keeping open track objects. */
async function reloadManaged() {
  if (S.source !== 'managed' || !lib.hasManaged()) return;
  const { tracks, crates } = await lib.loadManaged();
  const old = new Map(S.tracks.map((t) => [t.id, t]));
  S.crates = crates;
  setTracks(tracks.map((t) => (old.has(t.id) ? Object.assign(old.get(t.id), { title: t.title, artist: t.artist, genre: t.genre, key: t.key, camelot: t.camelot, energy: t.energy, rating: t.rating, comment: t.comment }) : t)), 'My library', 'managed');
}

// ---------- start ----------
if (desktop?.platform) document.documentElement.classList.add(desktop.platform);
applyTheme();
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);
bind(); bindSync(); renderAll();
const startSource = shared.get('source', null) || (lib.hasManaged() ? 'managed' : 'practice');
useSource(startSource === 'managed' && !lib.hasManaged() ? 'practice' : startSource);
