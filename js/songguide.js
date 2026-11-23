// How songs are built: a plain-word breakdown of any analysed track, and the "How songs are built" guide
// with its pictures (inline SVG strings drawn from data). DOM-free, so it's unit-tested in Node.
import { PART_INFO, partInfo } from './mixplan.js';

/** One colour per part, shared by the deck phrase bar, the breakdown and the guide. Readable on every theme. */
export const PHRASE_COLORS = { Intro: '#2bb5a0', Up: '#f0a020', Chorus: '#ef4f5c', Down: '#8b6cf6', Outro: '#4a90e2', Verse: '#7cbf3a', Bridge: '#c06cd8' };
export const partKey = (label = '') => (PHRASE_COLORS[label] ? label : Object.keys(PHRASE_COLORS).find((k) => label.startsWith(k)) || null);
export const phraseColor = (label = '') => PHRASE_COLORS[partKey(label)] || '#888';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
export function clock(t) {
  if (!Number.isFinite(t)) return '–:––';
  const s = Math.max(0, Math.round(t));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * The track's parts in order, with neighbouring phrases of the same kind joined into one section.
 * Each: { key, name, what, mix, color, start, end, startBar, endBar (exclusive), bars }.
 */
export function trackSections(track) {
  const g = track?.grid, ph = track?.phrases;
  if (!g?.bpm || !ph?.length) return [];
  const bl = 240 / g.bpm;
  const bar = (t) => Math.max(1, Math.round((t - g.firstDownbeat) / bl) + 1);
  const out = [];
  for (const p of [...ph].sort((a, b) => a.start - b.start)) {
    const key = partKey(p.label) || p.label || 'Part';
    const last = out.at(-1);
    if (last && last.key === key && Math.abs(last.end - p.start) < bl) { last.end = p.end; continue; }
    out.push({ key, start: p.start, end: p.end });
  }
  return out.map((s) => {
    const info = partInfo(s.key);
    const startBar = bar(s.start), endBar = bar(s.end);
    return { ...s, name: info.name, what: info.what, mix: info.mix, color: phraseColor(s.key), startBar, endBar, bars: Math.max(1, endBar - startBar) };
  });
}

/** How easy the track is to mix for a learner, from the room its intro and outro give you. */
export function mixability(sections) {
  const intro = sections[0]?.key === 'Intro' ? sections[0].bars : 0;
  const outro = sections.at(-1)?.key === 'Outro' ? sections.at(-1).bars : 0;
  if (intro >= 16 && outro >= 16) return { id: 'easy', name: 'Easy to mix', why: `A ${intro}-bar intro and a ${outro}-bar outro give you plenty of room to blend.` };
  if (intro >= 8 && outro >= 8) return { id: 'ok', name: 'Fine to mix', why: 'The intro and outro are on the short side, so keep your blends to 8 bars.' };
  if (!intro && !outro) return { id: 'hard', name: 'Tricky to mix', why: 'No clear intro or outro: try a quick cut on a phrase, or loop the first bars to make room.' };
  return { id: 'hard', name: 'Tricky to mix', why: intro < 8 ? 'The beat and bass come in almost straight away. Start it on a phrase and cut its bass first.' : 'It ends quickly. Have the next track ready before the outro.' };
}

/**
 * A plain-word description of a track's structure.
 * Returns null when the track has no beat grid or phrases yet.
 * { headline, story: [sentences], sections, mixIn, mixOut, shape, ease, tips: [sentences] }
 */
export function describeTrack(track) {
  const sections = trackSections(track);
  if (!sections.length) return null;
  const g = track.grid, bl = 240 / g.bpm;
  const dur = track.duration || sections.at(-1).end;
  const drops = sections.filter((s) => s.key === 'Chorus');
  const breaks = sections.filter((s) => s.key === 'Down');
  const builds = sections.filter((s) => s.key === 'Up');
  const intro = sections[0].key === 'Intro' ? sections[0] : null;
  const outro = sections.at(-1).key === 'Outro' ? sections.at(-1) : null;
  const vocal = sections.some((s) => s.key === 'Verse' || s.key === 'Bridge');

  const shapeName = vocal ? 'Song shape: verses and choruses'
    : drops.length >= 2 && breaks.length ? `Club shape: ${drops.length} drops with a breakdown between`
    : drops.length === 1 ? 'One big drop'
    : drops.length ? `${plural(drops.length, 'drop')}` : 'A steady groove with no big drop';

  const story = [];
  if (intro) story.push(`It opens with a ${intro.bars}-bar intro (${clock(intro.end - intro.start)}): ${lower(intro.what)} That's your window to mix it in.`);
  else story.push(`There's no real intro: the track starts with ${lower(sections[0].name)} straight away.`);
  if (builds[0] && drops[0] && builds[0].start < drops[0].start) story.push(`A build starts at ${clock(builds[0].start)} and lifts the energy.`);
  if (drops[0]) story.push(`The first drop lands at ${clock(drops[0].start)}, bar ${drops[0].startBar}. That's the moment the crowd waits for.`);
  if (breaks.length) story.push(breaks.length === 1 ? `A breakdown at ${clock(breaks[0].start)} takes the beat away for ${plural(breaks[0].bars, 'bar')}, then it drops again.` : `There are ${breaks.length} breakdowns, at ${breaks.map((b) => clock(b.start)).join(' and ')}.`);
  if (outro) story.push(`The outro starts at ${clock(outro.start)} and gives you ${plural(outro.bars, 'bar')} (${clock(outro.end - outro.start)}) to bring the next track in.`);
  else story.push('It ends without a long outro, so start the next track before the last drop finishes.');

  const mixIn = { time: g.firstDownbeat, bar: 1, label: intro ? 'Start of the intro' : 'First beat', why: intro ? `Start the track here, on its first "1". Its intro gives you ${plural(intro.bars, 'bar')} to blend.` : 'Start here, on the first "1", with the bass cut.' };
  const outBar = outro ? outro.startBar : Math.max(1, Math.floor((Math.floor((dur - g.firstDownbeat) / bl) - 32) / 16) * 16 + 1);
  const mixOut = { time: g.firstDownbeat + (outBar - 1) * bl, bar: outBar, label: outro ? 'Start of the outro' : '32 bars from the end', why: outro ? 'Bring the next track in here, so its intro plays over this outro.' : 'No outro was found, so this is a safe phrase to start the next track.' };

  const tips = [];
  if (intro && intro.bars >= 32) tips.push('Long intro: you can mix it in slowly over 16 or even 32 bars.');
  if (intro && intro.bars < 16) tips.push('Short intro: start it a phrase early, or cut its bass until you swap.');
  if (drops.length && breaks.length) tips.push('Don\'t start the next track in the breakdown: there\'s no beat to line up with.');
  if (drops[0]) tips.push(`Want a quick mix? Cut straight to the drop at ${clock(drops[0].start)} on a phrase "1".`);
  if (vocal) tips.push('Vocal track: avoid mixing another vocal over its verses.');

  return {
    headline: [g.bpm && `${(+g.bpm).toFixed(1)} BPM`, track.camelot && `key ${track.camelot}`, dur && clock(dur)].filter(Boolean).join(' · '),
    shape: shapeName, story, sections, mixIn, mixOut, tips, ease: mixability(sections),
    drops: drops.map((s) => ({ time: s.start, bar: s.startBar })),
  };
}
const lower = (s = '') => (s ? s[0].toLowerCase() + s.slice(1) : s);

// ---------- pictures ----------
// Each returns an SVG string. Text uses currentColor so it reads on light and dark themes.

/** Four beats in a bar, the first one big: the "1". */
export function beatsSVG({ now = -1 } = {}) {
  const dots = [0, 1, 2, 3].map((i) => {
    const x = 40 + i * 70, r = i === 0 ? 17 : 11, on = i === now;
    return `<circle cx="${x}" cy="34" r="${r}" fill="${i === 0 ? '#ef4f5c' : '#4a90e2'}" opacity="${now < 0 || on ? 1 : 0.35}"/>
      <text x="${x}" y="${34 + 5}" text-anchor="middle" font-size="${i === 0 ? 15 : 12}" font-weight="700" fill="#fff">${i + 1}</text>`;
  }).join('');
  return `<svg viewBox="0 0 290 78" class="sg-pic" role="img" aria-label="One bar: four beats, counted 1 2 3 4. The 1 is the downbeat.">${dots}
    <text x="40" y="72" text-anchor="middle" font-size="11" fill="currentColor" opacity=".7">downbeat</text></svg>`;
}

/** A 16-bar phrase: four rows of four bars, bar 1 and bar 9 marked. */
export function phraseSVG({ bars = 16, color = '#2bb5a0' } = {}) {
  const cells = [];
  for (let i = 0; i < bars; i++) {
    const row = Math.floor(i / 4), col = i % 4, x = 4 + col * 66, y = 4 + row * 30;
    const big = i === 0 || i === 8;
    cells.push(`<rect x="${x}" y="${y}" width="60" height="24" rx="5" fill="${color}" opacity="${big ? 0.95 : 0.35}"/>
      <text x="${x + 30}" y="${y + 16}" text-anchor="middle" font-size="11" font-weight="${big ? 700 : 500}" fill="${big ? '#fff' : 'currentColor'}">${i + 1}</text>`);
  }
  return `<svg viewBox="0 0 270 126" class="sg-pic" role="img" aria-label="A 16-bar phrase: four lines of four bars. Changes happen on bar 1 of a phrase.">${cells.join('')}</svg>`;
}

/** The typical club track used when no track is loaded: intro, build, drop, breakdown, drop, outro. */
export const TYPICAL_TRACK = [['Intro', 32], ['Up', 16], ['Chorus', 32], ['Down', 16], ['Chorus', 32], ['Outro', 32]];

/** Sections from a [label, bars] list at a tempo, in the same shape trackSections returns. */
export function sectionsFromBars(list = TYPICAL_TRACK, bpm = 124) {
  const bl = 240 / bpm; let bar = 1;
  return list.map(([key, bars]) => {
    const info = partInfo(key), s = { key, name: info.name, what: info.what, mix: info.mix, color: phraseColor(key), startBar: bar, endBar: bar + bars, bars, start: (bar - 1) * bl, end: (bar - 1 + bars) * bl };
    bar += bars; return s;
  });
}

/**
 * A track's parts as a coloured timeline with names, and optional markers.
 * opts: { width, marks: [{ time, label, color }], now (seconds), times: show start times under the parts }
 */
export function timelineSVG(sections, { width = 320, marks = [], now = null, times = true } = {}) {
  if (!sections?.length) return '';
  const t0 = Math.min(sections[0].start, 0), t1 = sections.at(-1).end, span = Math.max(1e-6, t1 - t0);
  const x = (t) => ((t - t0) / span) * width;
  const H = times ? 62 : 46, top = marks.length ? 14 : 2;
  const blocks = sections.map((s) => {
    const x0 = x(s.start), w = Math.max(1, x(s.end) - x0 - 1.5);
    const label = w > 34 ? `<text x="${x0 + w / 2}" y="${top + 19}" text-anchor="middle" font-size="10.5" font-weight="600" fill="#fff">${esc(w > 58 ? s.name : s.name.slice(0, 5))}</text>` : '';
    const tm = times && w > 26 ? `<text x="${x0 + 1}" y="${top + 44}" font-size="9.5" fill="currentColor" opacity=".65">${clock(s.start)}</text>` : '';
    return `<g data-section="${s.startBar}"><title>${esc(`${s.name}: ${clock(s.start)}–${clock(s.end)}, ${plural(s.bars, 'bar')}`)}</title><rect x="${x0}" y="${top}" width="${w}" height="28" rx="4" fill="${s.color}"/>${label}${tm}</g>`;
  }).join('');
  const mk = marks.filter((m) => Number.isFinite(m.time)).map((m) => {
    const mx = Math.max(1, Math.min(width - 1, x(m.time)));
    const anchor = mx < 40 ? 'start' : mx > width - 40 ? 'end' : 'middle';
    return `<line x1="${mx}" x2="${mx}" y1="${top - 3}" y2="${top + 31}" stroke="${m.color || 'currentColor'}" stroke-width="2"/><text x="${mx}" y="${top - 5}" text-anchor="${anchor}" font-size="9.5" font-weight="700" fill="${m.color || 'currentColor'}">${esc(m.label)}</text>`;
  }).join('');
  const nowLine = Number.isFinite(now) ? `<line x1="${x(now)}" x2="${x(now)}" y1="${top - 2}" y2="${top + 30}" stroke="currentColor" stroke-width="2" data-now/>` : '';
  return `<svg viewBox="0 0 ${width} ${H + top - 2}" class="sg-pic sg-time" preserveAspectRatio="none" role="img" aria-label="${esc(sections.map((s) => `${s.name} ${plural(s.bars, 'bar')}`).join(', '))}">${blocks}${mk}${nowLine}</svg>`;
}

/** Two tracks overlapping: A's outro under B's intro, with the start point and the bass swap marked. */
export function mixMapSVG({ width = 320 } = {}) {
  const A = sectionsFromBars([['Chorus', 32], ['Outro', 32]]), B = sectionsFromBars([['Intro', 32], ['Up', 16], ['Chorus', 16]]);
  const unit = width / 112; // 64 bars of A, B starts at A's bar 33 and runs 64 bars → 96 bars shown, plus room
  const row = (secs, off, y, name) => secs.map((s) => `<rect x="${(off + s.startBar - 1) * unit}" y="${y}" width="${s.bars * unit - 1.5}" height="22" rx="4" fill="${s.color}"/><text x="${(off + s.startBar - 1) * unit + 5}" y="${y + 15}" font-size="10" font-weight="600" fill="#fff">${esc(s.name)}</text>`).join('')
    + `<text x="${off * unit - 6}" y="${y + 15}" text-anchor="end" font-size="11" font-weight="700" fill="currentColor">${name}</text>`;
  const start = 32 * unit + 14, swap = 48 * unit + 14, end = 64 * unit + 14;
  return `<svg viewBox="0 0 ${width + 16} 108" class="sg-pic" role="img" aria-label="Mix map: start track B on the first bar of track A's outro, swap the bass halfway, and A ends as B's build begins.">
    <g transform="translate(14 0)">${row(A, 0, 16, 'A')}${row(B, 32, 50, 'B')}</g>
    ${[[start, 'Start B'], [swap, 'Swap bass'], [end, 'A out']].map(([x, l], i) => `<line x1="${x}" x2="${x}" y1="12" y2="78" stroke="currentColor" stroke-width="1.5" stroke-dasharray="${i === 1 ? '0' : '3 3'}"/><text x="${x}" y="96" text-anchor="middle" font-size="10" font-weight="${i === 1 ? 700 : 500}" fill="currentColor">${l}</text>`).join('')}
  </svg>`;
}

// ---------- the guide ----------
const ORDER = ['Intro', 'Up', 'Chorus', 'Down', 'Outro', 'Verse', 'Bridge'];
/** The parts, in the order a track usually plays them, with the same wording as the deck labels. */
export const GUIDE_PARTS = ORDER.map((k) => ({ key: k, color: PHRASE_COLORS[k], ...PART_INFO[k] }));

/**
 * The guide's sections, in reading order. Each: { id, title, text: [paragraphs], pic: 'beats' | 'phrase' | 'parts' | 'mixmap' | null }.
 * Plain words for someone who has never DJed.
 */
export const GUIDE = [
  { id: 'beats', title: 'Beats and bars', pic: 'beats', text: [
    'Dance music has a steady beat, usually a kick drum. Four beats make one bar.',
    'Count along "1, 2, 3, 4, 1, 2, 3, 4". The "1" is called the downbeat: it\'s where things start and change.',
  ] },
  { id: 'phrases', title: 'Phrases', pic: 'phrase', text: [
    'Bars come in groups called phrases, usually 8 or 16 bars. Two phrases make 32.',
    'Something changes at the start of every phrase: a new sound comes in, the bass drops out, the drop hits. That\'s why DJs start mixes on the first bar of a phrase.',
  ] },
  { id: 'parts', title: 'The parts of a track', pic: 'parts', text: [
    'Most club tracks are built the same way, so DJs know what comes next. Here are the parts, in the colours you see on the decks.',
  ] },
  { id: 'where', title: 'Where to mix', pic: 'mixmap', text: [
    'Bring the next track in over this track\'s outro, starting with its intro. Both parts are mostly drums, so they sit together nicely.',
    'Start the new track on a phrase "1", with its bass cut. Halfway through, swap the bass: one track\'s bass down, the other\'s up, on the same "1".',
    'What goes wrong otherwise: two drops at once sound messy, two vocals clash, and in a breakdown there\'s no beat to line up with.',
  ] },
];

/** One-screen summary at the end of the guide. */
export const CHEAT_SHEET = [
  'Count in fours. The "1" is where things change.',
  'Phrases are 16 bars. Start the next track on bar 1 of a phrase.',
  'Mix in over the intro. Mix out over the outro.',
  'One bass at a time: swap on a "1".',
  'Let the drop play. Don\'t start a track in a breakdown.',
];
