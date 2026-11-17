// Library: rekordbox XML import, Camelot keys, demo library.
// DOM-free so it can be unit-tested in Node.

const MAJOR = { B: '1B', 'F#': '2B', Gb: '2B', Db: '3B', 'C#': '3B', Ab: '4B', 'G#': '4B', Eb: '5B', 'D#': '5B',
  Bb: '6B', 'A#': '6B', F: '7B', C: '8B', G: '9B', D: '10B', A: '11B', E: '12B' };
const MINOR = { Ab: '1A', 'G#': '1A', Eb: '2A', 'D#': '2A', Bb: '3A', 'A#': '3A', F: '4A', C: '5A', G: '6A',
  D: '7A', A: '8A', E: '9A', B: '10A', 'F#': '11A', Gb: '11A', Db: '12A', 'C#': '12A' };
const PITCH_CLASS = { C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11 };

/** Convert "Am", "F#m", "Db", "8A", "Abmin" etc. to Camelot ("8A"). Returns null if unknown. */
export function toCamelot(raw) {
  if (!raw) return null;
  const s = String(raw).trim().replace('♯', '#').replace('♭', 'b');
  const cam = s.match(/^(\d{1,2})\s*([AB])$/i);
  if (cam && +cam[1] >= 1 && +cam[1] <= 12) return `${+cam[1]}${cam[2].toUpperCase()}`;
  const m = s.match(/^([A-Ga-g])([#b]?)\s*(m|min|minor|maj|major)?$/);
  if (!m) return null;
  const note = m[1].toUpperCase() + m[2];
  const minor = m[3] && m[3].toLowerCase().startsWith('m') && !m[3].toLowerCase().startsWith('maj');
  return (minor ? MINOR : MAJOR)[note] || null;
}

/** Root pitch class (0=C) of a Camelot key — used by the demo synth. */
export function camelotRoot(cam) {
  const table = cam.endsWith('A') ? MINOR : MAJOR;
  const name = Object.keys(table).find((k) => table[k] === cam);
  return name ? PITCH_CLASS[name] : 9;
}

/** How two Camelot keys relate. score 0..1, label for the UI. */
export function keyRelation(a, b) {
  if (!a || !b) return { score: 0.5, label: 'key unknown' };
  const na = parseInt(a, 10), nb = parseInt(b, 10);
  const la = a.slice(-1), lb = b.slice(-1);
  const diff = (((nb - na) % 12) + 12) % 12;
  if (la === lb) {
    if (diff === 0) return { score: 1, label: 'same key' };
    if (diff === 1) return { score: 0.9, label: '+1 · lifts energy' };
    if (diff === 11) return { score: 0.9, label: '−1 · calms energy' };
    if (diff === 2) return { score: 0.6, label: '+2 · energy boost' };
    if (diff === 7) return { score: 0.55, label: '+7 · semitone boost' };
  } else {
    if (diff === 0) return { score: 0.85, label: la === 'A' ? 'relative major · brighter' : 'relative minor · darker' };
    if ((la === 'A' && diff === 1) || (la === 'B' && diff === 11)) return { score: 0.6, label: 'diagonal · mood shift' };
  }
  return { score: 0.1, label: 'key clash' };
}

const decode = (s) => s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
function attrs(str) {
  const out = {};
  for (const m of str.matchAll(/([\w:]+)="([^"]*)"/g)) out[m[1]] = decode(m[2]);
  return out;
}

/** Turn a rekordbox Location URL into a file name. */
export function fileNameOf(location) {
  if (!location) return '';
  let p = location;
  try { p = decodeURIComponent(location); } catch { /* keep raw */ }
  return p.split(/[\\/]/).pop();
}

/** Parse rekordbox "Export Collection in xml format" output. */
export function parseRekordboxXML(text) {
  const start = text.indexOf('<COLLECTION');
  const end = text.indexOf('</COLLECTION>');
  if (start < 0) throw new Error('No <COLLECTION> found — is this a rekordbox XML export?');
  const body = text.slice(start, end < 0 ? undefined : end);
  const tracks = [];
  for (const m of body.matchAll(/<TRACK\b([^>]*?)(?:\/>|>([\s\S]*?)<\/TRACK>)/g)) {
    const a = attrs(m[1]);
    if (!a.TrackID) continue;
    const inner = m[2] || '';
    const tempos = [...inner.matchAll(/<TEMPO\b([^>]*)\/?>/g)].map((t) => attrs(t[1]))
      .map((t) => ({ time: +t.Inizio, bpm: +t.Bpm, beat: +(t.Battito || 1) }));
    const cues = [...inner.matchAll(/<POSITION_MARK\b([^>]*)\/?>/g)].map((t) => attrs(t[1]))
      .map((t) => ({ name: t.Name || '', time: +t.Start, num: +(t.Num ?? -1), loop: t.Type === '4' }));
    const bpm = tempos[0]?.bpm || +a.AverageBpm || 0;
    const energy = (a.Comments || '').match(/energy\s*(\d{1,2})/i);
    tracks.push({
      id: a.TrackID,
      title: a.Name || fileNameOf(a.Location),
      artist: a.Artist || '',
      genre: a.Genre || '',
      bpm,
      key: a.Tonality || '',
      camelot: toCamelot(a.Tonality),
      duration: +a.TotalTime || 0,
      rating: Math.round((+a.Rating || 0) / 51),
      playCount: +a.PlayCount || 0,
      location: a.Location || '',
      fileName: fileNameOf(a.Location),
      energy: energy ? +energy[1] : null,
      grid: gridFromTempos(tempos, bpm),
      cues,
    });
  }
  return tracks;
}

/** Beat grid: first downbeat (seconds) + bpm. Uses the first TEMPO marker. */
export function gridFromTempos(tempos, bpm) {
  if (!bpm) return null;
  const beat = 60 / bpm;
  const t = tempos[0];
  let downbeat = t ? t.time - ((t.beat || 1) - 1) * beat : 0;
  const bar = beat * 4;
  while (downbeat >= bar) downbeat -= bar;
  while (downbeat < 0) downbeat += bar;
  return { bpm, firstDownbeat: downbeat };
}

// ---------- Demo library (so the app works without rekordbox) ----------
function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}
const ADJ = ['Midnight', 'Velvet', 'Neon', 'Hollow', 'Golden', 'Liquid', 'Static', 'Silent', 'Electric', 'Lunar', 'Deep', 'Paper', 'Copper', 'Glass', 'Northern'];
const NOUN = ['Signal', 'Drift', 'Tides', 'Motion', 'Rooms', 'Pulse', 'Horizon', 'Echoes', 'Circuit', 'Garden', 'Engine', 'Mirage', 'Orbit', 'Fever', 'Lanes'];
const ARTISTS = ['Kora Vale', 'Mono Atlas', 'Ferro', 'Juno Ride', 'Tamsin Ode', 'Halcyon Unit', 'Desk 9', 'Rue Marlowe', 'Oskar Dune', 'Phase Kid'];
const GENRES = [['Deep House', 118, 123], ['House', 122, 126], ['Tech House', 124, 128], ['Techno', 128, 134]];
const KEYS = ['1A', '2A', '3A', '4A', '5A', '6A', '7A', '8A', '9A', '10A', '11A', '12A', '1B', '4B', '8B', '9B', '11B'];

/** Arrangement in bars used by the demo synth: intro, build, drop, break, drop, outro. */
export const DEMO_STRUCTURE = [
  ['intro', 32], ['build', 16], ['drop', 32], ['break', 16], ['drop', 32], ['outro', 32],
];

const DEMO_LABELS = { intro: 'Intro', build: 'Up', drop: 'Chorus', break: 'Down', outro: 'Outro' };
function demoPhrases(firstDownbeat, barLen) {
  let bar = 0;
  return DEMO_STRUCTURE.map(([kind, bars]) => {
    const start = firstDownbeat + bar * barLen; bar += bars;
    return { label: DEMO_LABELS[kind], start, end: firstDownbeat + bar * barLen };
  });
}

export function demoLibrary(n = 40) {
  const r = rng(7);
  const pick = (arr) => arr[Math.floor(r() * arr.length)];
  const tracks = [];
  for (let i = 0; i < n; i++) {
    const [genre, lo, hi] = pick(GENRES);
    const bpm = Math.round((lo + r() * (hi - lo)) * 100) / 100;
    const camelot = pick(KEYS);
    const firstDownbeat = Math.round((0.05 + r() * 0.35) * 1000) / 1000;
    const bars = DEMO_STRUCTURE.reduce((s, [, b]) => s + b, 0);
    const barLen = 240 / bpm;
    const duration = Math.round(firstDownbeat + bars * barLen + 2);
    tracks.push({
      id: `demo-${i + 1}`,
      title: `${pick(ADJ)} ${pick(NOUN)}`,
      artist: pick(ARTISTS),
      genre, bpm, key: camelot, camelot, duration,
      rating: 1 + Math.floor(r() * 5),
      playCount: Math.floor(r() * 20),
      energy: genre === 'Deep House' ? 3 + Math.floor(r() * 3) : genre === 'Techno' ? 6 + Math.floor(r() * 4) : 4 + Math.floor(r() * 4),
      location: '', fileName: '',
      demo: true,
      grid: { bpm, firstDownbeat },
      phrases: demoPhrases(firstDownbeat, barLen),
      cues: [
        { name: 'Start', time: firstDownbeat, num: -1, loop: false },
        { name: 'Drop', time: firstDownbeat + 48 * barLen, num: 0, loop: false },
      ],
    });
  }
  return tracks;
}
