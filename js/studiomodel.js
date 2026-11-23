// Studio: the track maker's pure parts (no audio, no page), unit-tested in Node.
//
// A track is a grid: rows are lanes (drums, bass, vocals…), columns are sections (intro, build, drop…).
// Each cell holds one loop that repeats for the whole section. Sections are whole phrases (multiples of
// 8 bars) at one steady tempo, so whatever you make lines up with a DJ's beat grid and phrase counter.
// That's the "mixable format": a beat-only intro and outro of 16+ bars, phrases you can count, one tempo.
import { GRID_VERSION } from './beatgrid.js';

export const LANES = [
  { id: 'drums', name: 'Drums', mixSafe: true },
  { id: 'perc', name: 'Percussion', mixSafe: true },
  { id: 'bass', name: 'Bass' },
  { id: 'chords', name: 'Chords' },
  { id: 'lead', name: 'Lead' },
  { id: 'vocals', name: 'Vocals' },
  { id: 'fx', name: 'FX', mixSafe: true },
];
export const LANE_IDS = LANES.map((l) => l.id);
export const DEFAULT_GAIN = { drums: 0.9, perc: 0.6, bass: 0.8, chords: 0.55, lead: 0.45, vocals: 0.85, fx: 0.5 };

// Section kinds, and the rekordbox-style phrase label each one becomes in the library.
export const SECTION_KINDS = {
  intro: { name: 'Intro', phrase: 'Intro' },
  build: { name: 'Build', phrase: 'Up' },
  drop: { name: 'Drop', phrase: 'Chorus' },
  break: { name: 'Break', phrase: 'Down' },
  outro: { name: 'Outro', phrase: 'Outro' },
};

export const STYLES = {
  house: { name: 'House', bpm: 124 },
  deephouse: { name: 'Deep house', bpm: 120 },
  techhouse: { name: 'Tech house', bpm: 126 },
  techno: { name: 'Techno', bpm: 132 },
  trance: { name: 'Trance', bpm: 138 },
  garage: { name: 'UK garage', bpm: 132 },
};

export const KEYS = ['Am', 'A#m', 'Bm', 'Cm', 'C#m', 'Dm', 'D#m', 'Em', 'Fm', 'F#m', 'Gm', 'G#m',
  'C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const PC = { C: 0, 'C#': 1, DB: 1, D: 2, 'D#': 3, EB: 3, E: 4, F: 5, 'F#': 6, GB: 6, G: 7, 'G#': 8, AB: 8, A: 9, 'A#': 10, BB: 10, B: 11 };

/** "F#m" → { pc: 6, minor: true }. Unknown keys fall back to A minor. */
export function parseKey(k) {
  const m = /^([A-Ga-g])([#b]?)\s*(m|min|minor)?$/i.exec(String(k || '').trim());
  if (!m) return { pc: 9, minor: true };
  const pc = PC[(m[1] + (m[2] === 'b' ? 'B' : m[2])).toUpperCase()];
  return { pc: pc ?? 9, minor: !!m[3] };
}

// Chord progressions, as scale degrees (0 = the key's own chord), one chord per bar, repeating.
export const PROGRESSIONS = [
  { id: 'i-VI-VII-v', name: 'Classic (i – VI – VII – v)', prog: [0, 5, 6, 4] },
  { id: 'i-iv', name: 'Moody (i – iv)', prog: [0, 3] },
  { id: 'i', name: 'One chord', prog: [0] },
  { id: 'i-VII-VI-VII', name: 'Anthem (i – VII – VI – VII)', prog: [0, 6, 5, 6] },
  { id: 'i-v-VI-iv', name: 'Uplifting (i – v – VI – iv)', prog: [0, 4, 5, 3] },
];

const SCALE = { minor: [0, 2, 3, 5, 7, 8, 10], major: [0, 2, 4, 5, 7, 9, 11] };
/** A scale degree (0 = root, 7 = root an octave up, −1 = the note below the root) as a MIDI note. */
export function degreeToMidi(deg, key, base) {
  const { minor } = typeof key === 'string' ? parseKey(key) : key;
  const sc = minor ? SCALE.minor : SCALE.major;
  const d = Math.round(deg), oct = Math.floor(d / 7), i = ((d % 7) + 7) % 7;
  return base + oct * 12 + sc[i];
}
/** The root note for each register, so every key sits in the same comfortable range. */
export function registerBase(key, register) {
  const { pc } = typeof key === 'string' ? parseKey(key) : key;
  const lo = { bass: 33, chords: 55, lead: 67 }[register] ?? 55; // A1, G3, G4
  return lo + ((pc - (lo % 12) + 12) % 12);
}

// ---------- built-in loops (patterns the app plays with its own synths) ----------
// Drum steps: one character per 16th note, 'x' = hit, 'o' = soft hit, anything else = rest.
const R = (s, n = 1) => s.repeat(n);
const FOUR = 'x---x---x---x---';
export const BUILTINS = {
  // drums
  'drums.kick': { lane: 'drums', name: 'Kick only', type: 'drums', bars: 1, steps: { kick: FOUR } },
  'drums.intro': { lane: 'drums', name: 'Kick + hats', type: 'drums', bars: 1, steps: { kick: FOUR, open: '--x---x---x---x-' } },
  'drums.house': { lane: 'drums', name: 'House beat', type: 'drums', bars: 1, steps: { kick: FOUR, clap: '----x-------x---', hat: 'o-o-o-o-o-o-o-o-', open: '--x---x---x---x-' } },
  'drums.deep': { lane: 'drums', name: 'Deep beat', type: 'drums', bars: 1, swing: 0.12, steps: { kick: FOUR, clap: '----x-------x---', hat: '--o---o---o-o-o-', open: '--x---x---x---x-' } },
  'drums.tech': { lane: 'drums', name: 'Tech beat', type: 'drums', bars: 1, steps: { kick: FOUR, clap: '----x-------x---', hat: 'oooooooooooooooo', open: '--x---x---x---x-', perc: '---x------x--x--' } },
  'drums.techno': { lane: 'drums', name: 'Techno beat', type: 'drums', bars: 1, steps: { kick: FOUR, clap: '----o-------o---', hat: 'xoxoxoxoxoxoxoxo', open: '--x---x---x---x-' } },
  'drums.trance': { lane: 'drums', name: 'Trance beat', type: 'drums', bars: 1, steps: { kick: FOUR, clap: '----x-------x---', hat: 'o-oxo-oxo-oxo-ox', open: '--x---x---x---x-' } },
  'drums.garage': { lane: 'drums', name: '2-step beat', type: 'drums', bars: 1, swing: 0.2, steps: { kick: 'x------x--x-----', clap: '----x-------x---', hat: 'o-ooo-ooo-ooo-oo', open: '' } },
  'drums.roll': { lane: 'drums', name: 'Build roll', type: 'drums', bars: 4, steps: { kick: R(FOUR, 4), clap: R('----x-------x---', 2) + 'x---x---x---x---' + 'x-x-x-x-xxxxxxxx', hat: R('o-o-o-o-o-o-o-o-', 4) } },
  // percussion
  'perc.shaker': { lane: 'perc', name: 'Shaker', type: 'drums', bars: 1, steps: { hat: 'oxooxoxooxooxoxo' } },
  'perc.conga': { lane: 'perc', name: 'Congas', type: 'drums', bars: 2, steps: { perc: 'x--x--x---x-x---x--x--x---xx-x--' } },
  'perc.ride': { lane: 'perc', name: 'Ride', type: 'drums', bars: 1, steps: { open: 'o-x-o-x-o-x-o-x-' } },
  // bass (degrees follow the chord progression when follow is on)
  'bass.offbeat': { lane: 'bass', name: 'Offbeat bass', type: 'bass', tone: 'sub', follow: true, bars: 1, notes: [[2, 0, 2], [6, 0, 2], [10, 0, 2], [14, 0, 2]] },
  'bass.rolling': { lane: 'bass', name: 'Rolling bass', type: 'bass', tone: 'reese', follow: true, bars: 1, notes: [[1, 0, 1], [2, 0, 1], [3, 0, 1], [5, 0, 1], [6, 0, 1], [7, 0, 1], [9, 0, 1], [10, 0, 1], [11, 0, 1], [13, 0, 1], [14, 7, 1], [15, 0, 1]] },
  'bass.acid': { lane: 'bass', name: 'Acid line', type: 'bass', tone: 'acid', follow: true, bars: 2, notes: [[0, 0, 1], [2, 7, 1], [3, 0, 1], [6, 2, 1], [8, 0, 1], [10, 3, 1], [11, 0, 1], [14, 7, 2], [16, 0, 1], [18, 0, 1], [19, 7, 1], [22, 4, 1], [24, 0, 1], [26, 3, 2], [29, 0, 1], [30, -2, 2]] },
  'bass.deep': { lane: 'bass', name: 'Deep long notes', type: 'bass', tone: 'sub', follow: true, bars: 1, notes: [[0, 0, 6], [7, 0, 2], [10, 0, 5]] },
  'bass.garage': { lane: 'bass', name: 'Wobble bass', type: 'bass', tone: 'reese', follow: true, bars: 2, notes: [[0, 0, 3], [6, 0, 2], [10, 7, 2], [14, 0, 2], [16, 0, 3], [22, 2, 2], [26, 0, 4]] },
  // chords (they follow the progression)
  'chords.stab': { lane: 'chords', name: 'Chord stabs', type: 'chords', tone: 'stab', bars: 1, hits: '--x-----x-----x-' },
  'chords.organ': { lane: 'chords', name: 'House organ', type: 'chords', tone: 'organ', bars: 1, hits: 'x--x--x---x--x--' },
  'chords.pad': { lane: 'chords', name: 'Warm pad', type: 'chords', tone: 'pad', bars: 1, hits: 'x' },
  // lead
  'lead.arp': { lane: 'lead', name: 'Pluck arp', type: 'lead', tone: 'pluck', follow: true, bars: 1, notes: [[0, 0, 1], [2, 2, 1], [4, 4, 1], [6, 7, 1], [8, 4, 1], [10, 2, 1], [12, 4, 1], [14, 7, 1]] },
  'lead.hook': { lane: 'lead', name: 'Saw hook', type: 'lead', tone: 'saw', bars: 2, notes: [[0, 4, 3], [4, 3, 2], [6, 2, 2], [8, 0, 4], [14, 2, 2], [16, 4, 3], [20, 6, 2], [22, 7, 4], [28, 4, 4]] },
  'lead.bell': { lane: 'lead', name: 'Bells', type: 'lead', tone: 'bell', bars: 2, notes: [[0, 7, 4], [6, 4, 2], [12, 2, 4], [20, 4, 4], [28, 0, 4]] },
  // fx (play once at the start of the section, stretched to fit it)
  'fx.riser': { lane: 'fx', name: 'Riser', type: 'fx', fx: 'riser' },
  'fx.crash': { lane: 'fx', name: 'Crash', type: 'fx', fx: 'crash' },
  'fx.impact': { lane: 'fx', name: 'Impact', type: 'fx', fx: 'impact' },
  'fx.down': { lane: 'fx', name: 'Downlifter', type: 'fx', fx: 'downlifter' },
  'fx.sweep': { lane: 'fx', name: 'Noise sweep', type: 'fx', fx: 'sweep' },
};
export const PATTERN_TYPES = ['drums', 'bass', 'chords', 'lead', 'fx'];
export const TONES = { bass: ['sub', 'reese', 'acid', 'pluck'], lead: ['pluck', 'saw', 'bell', 'acid'], chords: ['stab', 'pad', 'organ'] };
export const FX_KINDS = ['riser', 'crash', 'impact', 'downlifter', 'sweep'];
export const DRUM_VOICES = ['kick', 'clap', 'hat', 'open', 'perc'];

// ---------- projects ----------
const TEMPLATE = [['intro', 32], ['build', 16], ['drop', 32], ['break', 16], ['build', 8], ['drop', 32], ['outro', 32]];
/** What each style uses by default: [drums, perc, bass, chords, lead]. */
const STYLE_KIT = {
  house: ['drums.house', 'perc.shaker', 'bass.offbeat', 'chords.organ', 'lead.arp'],
  deephouse: ['drums.deep', 'perc.conga', 'bass.deep', 'chords.pad', 'lead.bell'],
  techhouse: ['drums.tech', 'perc.conga', 'bass.rolling', 'chords.stab', 'lead.arp'],
  techno: ['drums.techno', 'perc.ride', 'bass.acid', 'chords.stab', 'lead.arp'],
  trance: ['drums.trance', 'perc.shaker', 'bass.rolling', 'chords.pad', 'lead.hook'],
  garage: ['drums.garage', 'perc.shaker', 'bass.garage', 'chords.organ', 'lead.bell'],
};

let idn = 0;
export const newId = (p = 'x') => `${p}${Date.now().toString(36)}${(idn++).toString(36)}${Math.random().toString(36).slice(2, 5)}`;

/** Which loop goes in each lane for a kind of section, given the kit (lane → loop ref). */
function cellsFor(kind, kit, i, vocal) {
  const c = {};
  if (kind === 'intro') { c.drums = kit.intro; if (kit.perc) c.perc = kit.perc; }
  if (kind === 'build') { c.drums = i > 1 ? kit.roll : kit.drums; c.bass = kit.bass; c.chords = kit.chords; c.fx = 'b:fx.riser'; }
  if (kind === 'drop') { Object.assign(c, { drums: kit.drums, perc: kit.perc, bass: kit.bass, chords: kit.chords, lead: kit.lead, fx: 'b:fx.crash' }); if (vocal) c.vocals = vocal; }
  if (kind === 'break') { c.chords = kit.pad || kit.chords; c.lead = kit.lead; c.fx = 'b:fx.impact'; if (vocal) c.vocals = vocal; }
  if (kind === 'outro') { c.drums = kit.drums; if (kit.perc) c.perc = kit.perc; }
  for (const k of Object.keys(c)) if (!c[k]) delete c[k];
  return c;
}

export function arrange(sections, kit, vocal = null) {
  const cells = {};
  sections.forEach((s, i) => { cells[s.id] = cellsFor(s.kind, kit, i, vocal); });
  return cells;
}

/** A new track in a style, already laid out the mixable way. */
export function newProject({ style = 'house', bpm, key = 'Am', title = 'New track', progId = 'i-VI-VII-v' } = {}) {
  const st = STYLES[style] ? style : 'house';
  const sections = TEMPLATE.map(([kind, bars]) => ({ id: newId('s'), kind, bars }));
  const [drums, perc, bass, chords, lead] = STYLE_KIT[st].map((id) => `b:${id}`);
  const kit = { drums, perc, bass, chords, lead, intro: 'b:drums.intro', roll: 'b:drums.roll', pad: chords === 'b:chords.pad' ? null : 'b:chords.pad' };
  const prog = (PROGRESSIONS.find((p) => p.id === progId) || PROGRESSIONS[0]).prog;
  return {
    v: 1, id: newId('t'), title, style: st, bpm: clampBpm(bpm || STYLES[st].bpm), key: KEYS.includes(key) ? key : 'Am',
    prog: [...prog], pump: st !== 'deephouse', sections, cells: arrange(sections, kit), patterns: {},
    lanes: Object.fromEntries(LANE_IDS.map((l) => [l, { gain: DEFAULT_GAIN[l], mute: false, solo: false }])),
    created: Date.now(), updated: Date.now(),
  };
}
export const clampBpm = (b) => Math.max(70, Math.min(180, Math.round(Number(b) * 10) / 10 || 124));

export const totalBars = (p) => p.sections.reduce((s, x) => s + x.bars, 0);
export const barSeconds = (bpm) => 240 / bpm;
export const trackSeconds = (p) => totalBars(p) * barSeconds(p.bpm);

/** Which section a bar is in: { section, index, start, barIn }. null past the end. */
export function slotAt(p, bar) {
  let start = 0;
  for (let i = 0; i < p.sections.length; i++) {
    const s = p.sections[i];
    if (bar < start + s.bars) return { section: s, index: i, start, barIn: bar - start };
    start += s.bars;
  }
  return null;
}
export function sectionStart(p, id) {
  let start = 0;
  for (const s of p.sections) { if (s.id === id) return start; start += s.bars; }
  return -1;
}
/** The chord (scale degree) under a bar. */
export const chordAt = (p, bar) => (p.prog?.length ? p.prog[bar % p.prog.length] : 0);

/** A loop by reference: 'b:…' built in, 'p:…' made for this track, 's:…' an imported sample. */
export function resolve(p, ref, samples = {}) {
  if (!ref) return null;
  const [kind, id] = [ref.slice(0, 1), ref.slice(2)];
  if (kind === 'b') return BUILTINS[id] ? { kind: 'pattern', ...BUILTINS[id] } : null;
  if (kind === 'p') return p.patterns?.[id] ? { kind: 'pattern', ...p.patterns[id] } : null;
  if (kind === 's') return samples[id] ? { kind: 'sample', ...samples[id] } : null;
  return null;
}
export const refName = (p, ref, samples) => resolve(p, ref, samples)?.name || '';

// ---------- editing ----------
const touch = (p) => { p.updated = Date.now(); return p; };
export const snapBars = (n) => Math.max(8, Math.min(64, Math.round((Number(n) || 8) / 8) * 8));

export function setCell(p, sectionId, lane, ref) {
  p.cells[sectionId] ||= {};
  if (ref) p.cells[sectionId][lane] = ref; else delete p.cells[sectionId][lane];
  return touch(p);
}
export function resizeSection(p, id, bars) {
  const s = p.sections.find((x) => x.id === id);
  if (s) s.bars = snapBars(bars);
  return touch(p);
}
export function addSection(p, kind = 'drop', afterId = null, copyFrom = null) {
  const s = { id: newId('s'), kind: SECTION_KINDS[kind] ? kind : 'drop', bars: 16 };
  const at = afterId ? p.sections.findIndex((x) => x.id === afterId) + 1 : p.sections.length;
  p.sections.splice(at || p.sections.length, 0, s);
  p.cells[s.id] = copyFrom ? { ...(p.cells[copyFrom] || {}) } : {};
  return touch(p), s;
}
export function removeSection(p, id) {
  if (p.sections.length <= 1) return p;
  p.sections = p.sections.filter((s) => s.id !== id);
  delete p.cells[id];
  return touch(p);
}
export function moveSection(p, id, dir) {
  const i = p.sections.findIndex((s) => s.id === id), j = i + dir;
  if (i < 0 || j < 0 || j >= p.sections.length) return p;
  [p.sections[i], p.sections[j]] = [p.sections[j], p.sections[i]];
  return touch(p);
}
/** Cut a section into two halves of the same kind (each at least 8 bars), keeping its loops in both. */
export function splitSection(p, id) {
  const i = p.sections.findIndex((s) => s.id === id), s = p.sections[i];
  if (!s || s.bars < 16) return null;
  const half = Math.floor(s.bars / 16) * 8;
  const t = { id: newId('s'), kind: s.kind, bars: s.bars - half };
  s.bars = half;
  p.sections.splice(i + 1, 0, t);
  p.cells[t.id] = { ...(p.cells[s.id] || {}) };
  touch(p);
  return t;
}
/** Copy a built-in loop into the track so it can be edited without changing the built-in one. */
export function ownPattern(p, ref) {
  if (ref?.startsWith('p:')) return ref;
  const src = resolve(p, ref);
  if (!src || src.kind !== 'pattern') return null;
  const id = newId('p');
  const { kind, ...pat } = src;
  p.patterns[id] = JSON.parse(JSON.stringify({ ...pat, name: `${pat.name} (mine)` }));
  for (const c of Object.values(p.cells)) for (const l of Object.keys(c)) if (c[l] === ref) c[l] = `p:${id}`;
  touch(p);
  return `p:${id}`;
}
export function toggleStep(pat, voice, step) {
  const len = (pat.bars || 1) * 16;
  const s = (pat.steps[voice] || '').padEnd(len, '-').split('');
  s[step] = s[step] === 'x' ? 'o' : s[step] === 'o' ? '-' : 'x';
  pat.steps[voice] = s.join('');
  return pat;
}

// ---------- the mixable check ----------
/**
 * Is this track easy for a DJ to mix? Returns [{ id, ok, text, tip }]. `ok` is true, false, or 'warn'.
 * Rules: a beat-only intro and outro of 16+ bars, whole phrases, a drop, and one steady tempo (always true here).
 */
export function mixCheck(p, samples = {}) {
  const out = [];
  const first = p.sections[0], last = p.sections.at(-1);
  const has = (s, lane) => !!resolve(p, p.cells[s.id]?.[lane], samples);
  const drumsIn = (s) => has(s, 'drums') || has(s, 'perc');
  const melodic = (s) => LANES.filter((l) => !l.mixSafe && has(s, l.id)).map((l) => l.name.toLowerCase());
  const introOk = first?.kind === 'intro' && first.bars >= 16;
  out.push({ id: 'intro', ok: introOk, text: introOk ? `Starts with a ${first.bars}-bar intro` : 'Start with an intro of 16 bars or more', tip: 'DJs need a few phrases at the start to bring your track in.' });
  const outroOk = last?.kind === 'outro' && last.bars >= 16;
  out.push({ id: 'outro', ok: outroOk, text: outroOk ? `Ends with a ${last.bars}-bar outro` : 'End with an outro of 16 bars or more', tip: 'DJs need room at the end to mix the next track in.' });
  const beats = [first, last].filter(Boolean).every(drumsIn);
  out.push({ id: 'beats', ok: beats, text: beats ? 'Beats in the intro and outro' : 'Put drums in the intro and outro', tip: 'A clear kick drum is what DJs line up when they beatmatch.' });
  const clash = [...new Set([first, last].filter((s) => s && (s.kind === 'intro' || s.kind === 'outro')).flatMap(melodic))];
  out.push({ id: 'clean', ok: clash.length ? 'warn' : true, text: clash.length ? `The intro or outro has ${clash.join(', ')}` : 'Intro and outro are just drums and FX', tip: 'Melody, bass and vocals in the mix-in and mix-out parts can clash with the other track. Drums and FX only are safest.' });
  const odd = p.sections.filter((s) => s.bars % 8);
  out.push({ id: 'phrases', ok: !odd.length, text: odd.length ? 'Some parts aren\'t whole phrases' : 'Every part is a whole phrase', tip: 'Parts of 8, 16 or 32 bars keep the phrase count right for DJs.' });
  const drop = p.sections.some((s) => s.kind === 'drop');
  out.push({ id: 'drop', ok: drop, text: drop ? 'Has a drop' : 'Add a drop', tip: 'The drop is the part a DJ builds the mix toward.' });
  const mins = trackSeconds(p) / 60;
  out.push({ id: 'length', ok: mins >= 4 ? true : 'warn', text: `${fmtTime(trackSeconds(p))} long at a steady ${p.bpm} BPM`, tip: 'Club tracks are usually 5 to 7 minutes, so DJs have time to blend.' });
  return out;
}
export const mixScore = (checks) => checks.filter((c) => c.ok === true).length / checks.length;

export function fmtTime(s) { s = Math.max(0, Math.round(s)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }

// ---------- what the library gets ----------
/** The exact beat grid and phrases of a rendered track, so the decks need no analysis. */
export function libraryInfo(p) {
  const bl = barSeconds(p.bpm);
  const phrases = []; let bar = 0;
  for (const s of p.sections) {
    phrases.push({ label: SECTION_KINDS[s.kind]?.phrase || 'Chorus', start: round4(bar * bl), end: round4((bar + s.bars) * bl) });
    bar += s.bars;
  }
  return {
    title: p.title || 'Untitled', artist: p.artist || 'Me', genre: STYLES[p.style]?.name || 'Dance',
    bpm: p.bpm, key: p.key, duration: round4(bar * bl),
    grid: { bpm: p.bpm, firstDownbeat: 0, v: GRID_VERSION, made: true },
    phrases,
  };
}
const round4 = (x) => Math.round(x * 10000) / 10000;

// ---------- imported loops ----------
const KIND_WORDS = [
  ['vocals', /\b(vox|vocal|voc|acapella|acappella|sing|spoken|chant|choir|phrase)/i],
  ['fx', /\b(fx|riser|sweep|impact|uplift|downlift|whoosh|crash|noise|transition)/i],
  ['bass', /\b(bass|sub|808|reese)/i],
  ['perc', /\b(perc|shaker|conga|bongo|tamb|tambourine|ride|cowbell|rim)/i],
  ['drums', /\b(drum|beat|kick|top|tops|hat|hats|hihat|clap|snare|groove|break)/i],
  ['chords', /\b(chord|pad|stab|keys|piano|organ|rhodes|string)/i],
  ['lead', /\b(lead|synth|arp|pluck|melody|hook|bell)/i],
];
/** Guess the lane for a sample from its name. */
export function guessLane(name) {
  const s = String(name || '').replace(/[_\-.]+/g, ' ');
  for (const [lane, re] of KIND_WORDS) if (re.test(s)) return lane;
  return 'fx';
}
/** "Deep_Bass_124bpm_Am.wav" → 124. Also "124 BPM", "124-bpm". */
export function bpmFromName(name) {
  const m = /(?:^|[^\d])(\d{2,3}(?:\.\d+)?)\s*-?\s*bpm/i.exec(String(name || '')) || /bpm\s*-?\s*(\d{2,3})/i.exec(String(name || ''));
  const b = m ? Number(m[1]) : NaN;
  return b >= 60 && b <= 200 ? b : null;
}
/** "Pad_F#min_120.wav" → 'F#m'. Only takes clear key tokens, not any stray letter. */
export function keyFromName(name) {
  const s = String(name || '').replace(/\.[a-z0-9]+$/i, '');
  const m = /(?:^|[\s_\-()[\]])([A-G])([#b]|sharp|flat)?\s*(m|min|minor|maj|major)?(?=$|[\s_\-()[\]])/.exec(s);
  if (!m || (!m[2] && !m[3])) return null; // a bare "A" or "E" is too easy to misread
  const acc = m[2] === 'sharp' ? '#' : m[2] === 'flat' ? 'b' : m[2] || '';
  const minor = m[3] && /^m(in(or)?)?$/i.test(m[3]) && m[3] !== 'maj';
  const { pc } = parseKey(m[1] + acc);
  const name12 = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'][pc];
  return name12 + (minor ? 'm' : '');
}
/**
 * How a sample fits the grid: { bpm, bars, mode }. Short sounds are one-shots. A loop's tempo comes from its
 * name, or else from its length: whichever whole number of bars gives a tempo nearest the track's.
 */
export function loopInfo({ name, duration }, trackBpm = 124) {
  const named = bpmFromName(name);
  if (!(duration > 0)) return { bpm: named, bars: 1, mode: 'once' };
  if (named) {
    const bars = duration * named / 240;
    const whole = Math.max(1, Math.round(bars));
    return { bpm: named, bars: whole, mode: Math.abs(bars - whole) < 0.08 && duration > 1 ? 'loop' : 'once' };
  }
  if (duration < 1.2) return { bpm: null, bars: 1, mode: 'once' };
  let best = null;
  for (const bars of [1, 2, 4, 8, 16, 32]) {
    const bpm = bars * 240 / duration;
    if (bpm < 70 || bpm > 180) continue;
    const off = Math.abs(Math.log(bpm / trackBpm));
    if (!best || off < best.off) best = { bpm: Math.round(bpm * 100) / 100, bars, off };
  }
  return best && best.off < 0.12 ? { bpm: best.bpm, bars: best.bars, mode: 'loop' } : { bpm: null, bars: Math.max(1, Math.round(duration * trackBpm / 240)), mode: 'once' };
}
/** How fast a loop must play to fit the track: 1 = as recorded. */
export const sampleRate = (s, trackBpm) => (s?.mode === 'loop' && s.bpm ? trackBpm / s.bpm : 1);
/** Semitones of pitch change that speed causes (players without time-stretch). */
export const rateSemitones = (r) => 12 * Math.log2(r);

// ---------- generation without AI ("Surprise me") ----------
export function seeded(seed) { let s = (Math.abs(Math.floor(seed)) % 2147483646) + 1; return () => (s = (s * 16807) % 2147483647) / 2147483647; }
const pick = (rnd, a) => a[Math.floor(rnd() * a.length)];

function randomDrums(rnd, style) {
  const base = JSON.parse(JSON.stringify(BUILTINS[STYLE_KIT[style][0]]));
  const hat = pick(rnd, ['o-o-o-o-o-o-o-o-', 'oooooooooooooooo', 'xoxoxoxoxoxoxoxo', '--o---o---o-o-o-', 'o-ox-oo-o-ox-oo-']);
  base.steps.hat = hat;
  if (rnd() < 0.5) base.steps.perc = Array.from({ length: 16 }, (_, i) => (i % 4 !== 0 && rnd() < 0.22 ? 'o' : '-')).join('');
  return { ...base, name: 'Drums (surprise)' };
}
function randomBass(rnd, style) {
  const rhythms = {
    house: [2, 6, 10, 14], deephouse: [0, 7, 10], techhouse: [1, 2, 3, 5, 6, 7, 9, 10, 11, 13, 14, 15],
    techno: [0, 2, 3, 6, 8, 10, 11, 14], trance: [1, 2, 3, 5, 6, 7, 9, 10, 11, 13, 14, 15], garage: [0, 6, 10, 14],
  };
  const r = rhythms[style] || rhythms.house;
  const notes = r.map((s, i) => [s, i === 0 || rnd() < 0.7 ? 0 : pick(rnd, [7, 2, 4, -2, 3]), style === 'deephouse' ? 3 : 1]);
  return { lane: 'bass', name: 'Bass (surprise)', type: 'bass', tone: pick(rnd, style === 'techno' ? ['acid', 'sub'] : ['sub', 'reese', 'pluck']), follow: true, bars: 1, notes };
}
function randomLead(rnd) {
  const pool = [0, 2, 3, 4, 6, 7, 9];
  const notes = []; let s = 0;
  while (s < 32) { const l = pick(rnd, [1, 2, 2, 3, 4]); if (rnd() < 0.72) notes.push([s, pick(rnd, pool), l]); s += l; }
  return { lane: 'lead', name: 'Melody (surprise)', type: 'lead', tone: pick(rnd, ['pluck', 'saw', 'bell']), bars: 2, notes };
}
/** A whole new track with fresh drum, bass and melody patterns, made from a seed. */
export function surpriseProject(seed, { style, key, bpm, samples = [] } = {}) {
  const rnd = seeded(seed);
  const st = STYLES[style] ? style : pick(rnd, Object.keys(STYLES));
  const p = newProject({ style: st, bpm: bpm || STYLES[st].bpm, key: key || pick(rnd, KEYS.slice(0, 12)), progId: pick(rnd, PROGRESSIONS).id, title: `${pick(rnd, ['Night', 'Neon', 'Deep', 'Late', 'Lost', 'Golden', 'Low', 'Blue'])} ${pick(rnd, ['Drive', 'Signal', 'Motion', 'Hours', 'Tide', 'Pulse', 'Room', 'Echo'])}` });
  const add = (pat) => { const id = newId('p'); p.patterns[id] = pat; return `p:${id}`; };
  const [, perc, , chords] = STYLE_KIT[st].map((id) => `b:${id}`);
  const vocals = samples.filter((s) => s.lane === 'vocals');
  const kit = {
    drums: add(randomDrums(rnd, st)), perc, bass: add(randomBass(rnd, st)), chords: pick(rnd, [chords, 'b:chords.stab', 'b:chords.organ']),
    lead: add(randomLead(rnd)), intro: 'b:drums.intro', roll: 'b:drums.roll', pad: 'b:chords.pad',
  };
  p.cells = arrange(p.sections, kit, vocals.length ? `s:${pick(rnd, vocals).id}` : null);
  return p;
}

// ---------- AI ----------
/** JSON schema for a track written by the AI (Claude). Kept simple: every field required, empty = unused. */
export function aiSchema() {
  const lanes = Object.fromEntries(LANE_IDS.map((l) => [l, { type: 'string', description: 'A loop id, or "" for silence.' }]));
  return {
    type: 'object', additionalProperties: false, required: ['title', 'about', 'bpm', 'key', 'progression', 'sections', 'patterns'],
    properties: {
      title: { type: 'string' },
      about: { type: 'string', description: 'Two short sentences about the track, for a beginner.' },
      bpm: { type: 'number' },
      key: { type: 'string', enum: KEYS },
      progression: { type: 'array', items: { type: 'integer' }, description: 'Chord per bar as scale degrees 0-6 (0 = home chord), 1 to 4 items, repeating.' },
      sections: {
        type: 'array',
        items: { type: 'object', additionalProperties: false, required: ['kind', 'bars', 'lanes'], properties: { kind: { type: 'string', enum: Object.keys(SECTION_KINDS) }, bars: { type: 'integer' }, lanes: { type: 'object', additionalProperties: false, required: LANE_IDS, properties: lanes } } },
      },
      patterns: {
        type: 'array',
        items: {
          type: 'object', additionalProperties: false,
          required: ['id', 'name', 'type', 'bars', 'tone', 'follow', 'kick', 'clap', 'hat', 'open', 'perc', 'notes', 'hits'],
          properties: {
            id: { type: 'string', description: 'Your own short id, e.g. "p1".' },
            name: { type: 'string' },
            type: { type: 'string', enum: ['drums', 'bass', 'chords', 'lead'] },
            bars: { type: 'integer', description: '1, 2 or 4.' },
            tone: { type: 'string', enum: [...new Set([...TONES.bass, ...TONES.lead, ...TONES.chords])] },
            follow: { type: 'boolean', description: 'Bass/lead notes move with the chord progression.' },
            kick: { type: 'string' }, clap: { type: 'string' }, hat: { type: 'string' }, open: { type: 'string' }, perc: { type: 'string' },
            notes: { type: 'array', items: { type: 'array', items: { type: 'integer' } }, description: '[step, degree, lengthInSteps] for bass and lead.' },
            hits: { type: 'string', description: 'Chords: 16 characters, x = play the chord on that 16th. "x" alone = sustained pad.' },
          },
        },
      },
    },
  };
}

const cleanSteps = (s, len) => String(s || '').toLowerCase().replace(/[^xo]/g, '-').slice(0, len).padEnd(len, '-');
/** Check one pattern from outside (AI or a file) and make it safe to play. null when it can't be used. */
export function cleanPattern(x, lane) {
  const type = PATTERN_TYPES.includes(x?.type) ? x.type : null;
  if (!type || type === 'fx') return null;
  const bars = [1, 2, 4].includes(x.bars) ? x.bars : 1, len = bars * 16;
  const name = String(x.name || 'Loop').slice(0, 40);
  if (type === 'drums') {
    const steps = {};
    for (const v of DRUM_VOICES) { const s = x.steps?.[v] ?? x[v]; if (s && /[xo]/i.test(s)) steps[v] = cleanSteps(s, len); }
    return Object.keys(steps).length ? { lane: lane || 'drums', name, type, bars, steps } : null;
  }
  if (type === 'chords') {
    const tone = TONES.chords.includes(x.tone) ? x.tone : 'stab';
    const hits = tone === 'pad' ? 'x' : cleanSteps(x.hits || 'x', 16);
    return { lane: 'chords', name, type, tone, bars: 1, hits };
  }
  const tone = TONES[type === 'bass' ? 'bass' : 'lead'].includes(x.tone) ? x.tone : (type === 'bass' ? 'sub' : 'pluck');
  const notes = (Array.isArray(x.notes) ? x.notes : [])
    .filter((n) => Array.isArray(n) && n.length >= 3 && n.every(Number.isFinite))
    .map(([s, d, l]) => [Math.round(s), Math.max(-7, Math.min(14, Math.round(d))), Math.max(1, Math.min(16, Math.round(l)))])
    .filter(([s]) => s >= 0 && s < len).sort((a, b) => a[0] - b[0]).slice(0, 64);
  return notes.length ? { lane: type, name, type, tone, follow: !!x.follow, bars, notes } : null;
}

/** Turn the AI's answer into a project, keeping only loops that exist and sections that are whole phrases. */
export function projectFromAI(data, { style = 'house', samples = {} } = {}) {
  const p = newProject({ style, bpm: data?.bpm, key: data?.key, title: String(data?.title || 'AI track').slice(0, 60) });
  p.about = String(data?.about || '').slice(0, 400);
  const prog = (data?.progression || []).filter(Number.isFinite).map((d) => ((Math.round(d) % 7) + 7) % 7).slice(0, 4);
  if (prog.length) p.prog = prog;
  const ids = new Map();
  for (const x of data?.patterns || []) {
    const pat = cleanPattern(x);
    if (!pat) continue;
    const id = newId('p'); p.patterns[id] = pat; ids.set(String(x.id), `p:${id}`);
  }
  const ref = (v, lane) => {
    v = String(v || '');
    if (!v) return null;
    if (ids.has(v)) return ids.get(v);
    if (BUILTINS[v] && BUILTINS[v].lane === lane) return `b:${v}`;
    if (v.startsWith('b:') && BUILTINS[v.slice(2)]) return v;
    const sid = v.startsWith('s:') ? v.slice(2) : v;
    if (samples[sid]) return `s:${sid}`;
    return null;
  };
  const sections = (data?.sections || []).filter((s) => SECTION_KINDS[s?.kind]).slice(0, 16);
  if (sections.length >= 2) {
    p.sections = []; p.cells = {};
    for (const s of sections) {
      const sec = { id: newId('s'), kind: s.kind, bars: snapBars(s.bars) };
      p.sections.push(sec);
      p.cells[sec.id] = {};
      for (const lane of LANE_IDS) { const r = ref(s.lanes?.[lane], lane); if (r) p.cells[sec.id][lane] = r; }
    }
  }
  return p;
}

/** What the AI is told about the loops it may use. */
export function aiCatalog(samples = []) {
  const built = Object.entries(BUILTINS).map(([id, b]) => `${id} (${b.lane}: ${b.name})`).join('\n');
  const own = samples.map((s) => `s:${s.id} (${s.lane}: ${s.name}${s.mode === 'loop' ? `, ${s.bars}-bar loop` : ', one-shot'}${s.key ? `, key ${s.key}` : ''})`).join('\n');
  return `Built-in loops:\n${built}${own ? `\n\nThe producer's own samples:\n${own}` : ''}`;
}

// ---------- WAV ----------
/** 16-bit PCM WAV from one Float32Array per channel. */
export function encodeWav(channels, sr = 44100) {
  const n = channels[0].length, ch = channels.length, bytes = n * ch * 2;
  const buf = new ArrayBuffer(44 + bytes), v = new DataView(buf);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + bytes, true); str(8, 'WAVE'); str(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, ch, true); v.setUint32(24, sr, true);
  v.setUint32(28, sr * ch * 2, true); v.setUint16(32, ch * 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, bytes, true);
  let o = 44;
  for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) { const x = Math.max(-1, Math.min(1, channels[c][i])); v.setInt16(o, x < 0 ? x * 0x8000 : x * 0x7fff, true); o += 2; }
  return buf;
}
