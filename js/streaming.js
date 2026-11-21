// Spotify and Apple Music, the part that works for everyone: links out to listen or buy, and playlists
// brought in from an export file (or pasted), matched against My library. The tracks you don't own yet
// are kept on the crate as "still to get".
//
// Streamed audio can't play on Cue Coach's decks: both services protect it, and their terms rule out
// mixing it. Signing in to Spotify's API is limited to five users per app in development mode (Feb 2026)
// and Apple Music's needs a paid developer key, so playlists come in from export files instead.
// Everything here is pure, so it's unit-tested in Node.

// ---------- links ----------
const q = (t) => [t.artist, t.title].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();

/** Where to listen to or buy a track. A Spotify track id from an export opens that exact track. */
export function trackLinks(t) {
  const s = encodeURIComponent(q(t));
  const sp = spotifyTrackId(t.spotify);
  return [
    { id: 'spotify', label: 'Spotify', kind: 'listen', url: sp ? `https://open.spotify.com/track/${sp}` : `https://open.spotify.com/search/${s}` },
    { id: 'apple', label: 'Apple Music', kind: 'listen', url: `https://music.apple.com/search?term=${s}` },
    { id: 'beatport', label: 'Beatport', kind: 'buy', url: `https://www.beatport.com/search?q=${s}` },
    { id: 'juno', label: 'Juno Download', kind: 'buy', url: `https://www.junodownload.com/search/?q%5Ball%5D%5B%5D=${s}` },
    { id: 'traxsource', label: 'Traxsource', kind: 'buy', url: `https://www.traxsource.com/search?term=${s}` },
    { id: 'bandcamp', label: 'Bandcamp', kind: 'buy', url: `https://bandcamp.com/search?q=${s}&item_type=t` },
    { id: 'amazon', label: 'Amazon MP3', kind: 'buy', url: `https://www.amazon.com/s?k=${s}&i=digital-music` },
  ];
}

/** "spotify:track:ID" or "https://open.spotify.com/track/ID?si=…" → "ID" ('' if neither). */
export function spotifyTrackId(s) {
  const m = String(s || '').match(/(?:spotify:track:|open\.spotify\.com\/(?:intl-[a-z-]+\/)?track\/)([A-Za-z0-9]{22})/);
  return m ? m[1] : '';
}

// ---------- reading export files ----------
/** Export files come as UTF-8, or UTF-16 from Apple Music and iTunes. */
export function decodeText(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (b[0] === 0xff && b[1] === 0xfe) return new TextDecoder('utf-16le').decode(b.subarray(2));
  if (b[0] === 0xfe && b[1] === 0xff) return new TextDecoder('utf-16be').decode(b.subarray(2));
  // UTF-16 without a BOM: every other byte of plain text is 0
  if (b.length > 3 && b[1] === 0 && b[3] === 0 && b[0] !== 0) return new TextDecoder('utf-16le').decode(b);
  return new TextDecoder('utf-8').decode(b).replace(/^﻿/, '');
}

/** One CSV or tab-separated line per row, with quoted fields ("a, b" and "say ""hi"""). */
export function parseDelimited(text, sep) {
  const rows = []; let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"' && cell === '') quoted = true;
    else if (c === sep) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim()));
}

// Column names in the exports we know: Exportify (Spotify), TuneMyMusic, Soundiiz, Apple Music / iTunes.
const COLS = {
  title: /^(track ?name|title|name|song|song ?name|track ?title|track)$/i,
  artist: /^(artist ?name\(?s?\)?|artists?|artist ?names?|performer)$/i,
  album: /^(album ?name|album)$/i,
  isrc: /^isrc$/i,
  spotify: /^(track ?uri|spotify ?(uri|id|url)|uri|track ?url)$/i,
  ms: /^(duration ?\(ms\)|duration_ms|track ?duration ?\(ms\))$/i,
  time: /^(time|duration|length)$/i,
  playlist: /^playlist ?name$/i,
};
const findCol = (head, re) => head.findIndex((h) => re.test(h.trim()));

function fromTable(rows) {
  const head = rows[0].map((h) => h.trim());
  const col = Object.fromEntries(Object.entries(COLS).map(([k, re]) => [k, findCol(head, re)]));
  if (col.title < 0) return null;
  const items = [];
  let name = '';
  for (const r of rows.slice(1)) {
    const get = (k) => (col[k] >= 0 ? String(r[col[k]] ?? '').trim() : '');
    const title = get('title'); if (!title) continue;
    const secs = col.ms >= 0 ? Number(get('ms')) / 1000 : parseTime(get('time'));
    items.push(clean({ title, artist: get('artist'), album: get('album'), isrc: get('isrc').toUpperCase(), spotify: spotifyTrackId(get('spotify')), duration: secs > 0 ? Math.round(secs) : 0 }));
    name ||= get('playlist');
  }
  return { items, name };
}

/** "5:42" → 342, "342" → 342 (Apple Music's Time column is seconds). */
function parseTime(s) {
  s = String(s || '').trim(); if (!s) return 0;
  if (/^\d+(\.\d+)?$/.test(s)) return Number(s);
  const p = s.split(':').map(Number); if (p.some((n) => !Number.isFinite(n))) return 0;
  return p.reduce((acc, n) => acc * 60 + n, 0);
}

function fromM3u(text) {
  const items = []; let name = '', pending = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim(); if (!line) continue;
    if (/^#PLAYLIST:/i.test(line)) { name = line.slice(10).trim(); continue; }
    const inf = line.match(/^#EXTINF:\s*(-?\d+(?:\.\d+)?)?\s*(?:[^,]*?)?,(.*)$/i);
    if (inf) { pending = { ...splitArtistTitle(inf[2].trim()), duration: Math.max(0, Math.round(Number(inf[1]) || 0)) }; continue; }
    if (line.startsWith('#')) continue;
    // a file path or URL: use the #EXTINF before it, or the file name
    const sp = spotifyTrackId(line);
    const it = pending || splitArtistTitle(decodeURIComponent(line.split(/[\\/]/).pop().replace(/\.[a-z0-9]{2,5}$/i, '')).replace(/^\d{1,3}\s*[-.)]\s*/, ''));
    items.push(clean({ ...it, spotify: sp }));
    pending = null;
  }
  return { items, name };
}

/** "Kora Vale - Night Drive" or "Night Drive by Kora Vale" → { artist, title }. */
export function splitArtistTitle(s) {
  s = String(s || '').replace(/\s+/g, ' ').trim();
  const dash = s.split(/\s+[-–—]\s+/);
  if (dash.length >= 2) return { artist: dash[0].trim(), title: dash.slice(1).join(' - ').trim() };
  const by = s.match(/^(.+?)\s+by\s+(.+)$/i);
  if (by) return { artist: by[2].trim(), title: by[1].trim() };
  return { artist: '', title: s };
}

/** Lines typed or pasted in: "Artist - Title", "Title by Artist", or "Title<tab>Artist" (copied from a table). */
function fromLines(text) {
  const items = [];
  let links = 0;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/^\s*(\d{1,3}[.)]|[-*•])\s+/, '').trim();
    if (!line) continue;
    if (/^https?:\/\//i.test(line) || /^spotify:/i.test(line)) { links++; continue; } // a bare link has no name in it
    const cells = line.split('\t').map((c) => c.trim()).filter(Boolean);
    items.push(clean(cells.length >= 2 ? { title: cells[0], artist: cells[1] } : splitArtistTitle(line)));
  }
  return { items, name: '', links };
}

const clean = (it) => {
  const out = { title: String(it.title || '').trim(), artist: String(it.artist || '').trim() };
  for (const k of ['album', 'isrc', 'spotify']) if (it[k]) out[k] = String(it[k]).trim().slice(0, 200);
  if (it.duration > 0) out.duration = Math.round(it.duration);
  out.title = out.title.slice(0, 300); out.artist = out.artist.slice(0, 300);
  return out;
};

/**
 * A playlist from an export file or pasted text: { name, items: [{ title, artist, album?, isrc?, spotify?, duration? }], format, links }.
 * Knows Exportify and TuneMyMusic CSV (Spotify), Apple Music / iTunes "Export Playlist" text, M3U, and plain lists.
 */
export function parsePlaylist(text, fileName = '') {
  text = String(text || '').replace(/^﻿/, '');
  const stem = String(fileName).split(/[\\/]/).pop().replace(/\.[a-z0-9]{1,5}$/i, '').replace(/_/g, ' ').trim();
  let r = null, format = 'list';
  const first = text.split(/\r?\n/, 1)[0] || '';
  if (/^#EXTM3U/i.test(first) || /\.m3u8?$/i.test(fileName)) { r = fromM3u(text); format = 'm3u'; }
  else if (first.includes('\t') && findCol(first.split('\t'), COLS.title) >= 0) { r = fromTable(parseDelimited(text, '\t')); format = 'apple'; }
  else if (first.includes(',') && findCol(parseDelimited(first, ',')[0] || [], COLS.title) >= 0) { r = fromTable(parseDelimited(text, ',')); format = 'csv'; }
  if (!r) { r = fromLines(text); format = 'list'; }
  const seen = new Set();
  const items = r.items.filter((it) => {
    if (!it.title) return false;
    const k = `${norm(it.artist)}|${norm(it.title)}`;
    if (seen.has(k)) return false;
    seen.add(k); return true;
  }).slice(0, 5000);
  return { name: r.name || stem || 'Imported playlist', items, format, links: r.links || 0 };
}

// ---------- matching against My library ----------
/** Lowercase, no accents, no punctuation: "Café del Mar!" → "cafe del mar". */
export function norm(s) {
  return String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/&/g, ' and ').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

// "(feat. X)", "[with X]", or a bare "feat. X" up to the next bracket or dash ("with" alone is part of many titles)
const FEAT = /\s*[([]\s*(?:feat\.?|ft\.?|featuring|with)\s+[^)\]]*[)\]]|\s+(?:feat\.?|ft\.?|featuring)\s+[^-–—([]*/gi;
const REMASTER = /\b(remaster(ed)?( \d{4})?|\d{4} remaster(ed)?|mono|stereo|explicit|clean)\b/g;
const PLAIN_MIX = new Set(['', 'original mix', 'original', 'album version', 'single version']);

/**
 * "Night Drive - Extended Mix" and "Night Drive (Extended Mix) [feat. Ana]" → { core: 'night drive', mix: 'extended mix' }.
 * Spotify writes versions after " - ", download stores in brackets; featured artists are left out of both.
 */
export function titleParts(title) {
  let s = String(title || '').replace(FEAT, ' ').trim();
  const mixes = [];
  s = s.replace(/[([]([^)\]]*)[)\]]/g, (_m, inner) => { mixes.push(inner); return ' '; });
  const dash = s.split(/\s+[-–—]\s+/);
  if (dash.length >= 2) { s = dash[0]; mixes.push(...dash.slice(1)); }
  const mix = norm(mixes.join(' ')).replace(REMASTER, ' ').replace(/\s+/g, ' ').trim();
  return { core: norm(s), mix: PLAIN_MIX.has(mix) ? '' : mix };
}

/** Everyone credited: "A, B & C feat. D" → ['a', 'b', 'c', 'd']. */
export function artistNames(s) {
  return String(s || '').split(/\s*(?:,|;|&|\/|\+|\bx\b|\band\b|\bvs\.?|\bfeat\.?|\bft\.?|\bfeaturing\b|\bwith\b)\s*/i)
    .map((a) => norm(a).replace(/^the /, '')).filter(Boolean); // "The Prodigy" is often tagged "Prodigy"
}

/** Does the playlist's `want` look like library track `have`? 2 = same version, 1 = another mix of it, 0 = no. */
export function matchScore(want, have) {
  const w = titleParts(want.title), h = titleParts(have.title);
  if (!w.core || w.core !== h.core) {
    // a file with no artist tag may have "Artist - Title" as its title
    if (have.artist || !w.core) return 0;
    const split = splitArtistTitle(have.title);
    if (!split.artist) return 0;
    return matchScore(want, split);
  }
  const wa = artistNames(want.artist), ha = artistNames(have.artist);
  const sameArtist = !wa.length || !ha.length || wa.some((a) => ha.includes(a)) || wa.some((a) => norm(have.title).includes(a));
  if (!sameArtist) return 0;
  if (w.mix === h.mix) return 2;
  return w.core.length >= 4 ? 1 : 0; // very short titles ("Go") only match the exact version
}

/** The library track that best matches each playlist item: [{ item, track, exact }] (track null if none). */
export function matchPlaylist(items, tracks) {
  const byCore = new Map();
  const index = (core, t) => { if (!core) return; if (!byCore.has(core)) byCore.set(core, []); byCore.get(core).push(t); };
  for (const t of tracks) {
    index(titleParts(t.title).core, t);
    if (!t.artist) index(titleParts(splitArtistTitle(t.title).title).core, t);
  }
  const used = new Set();
  return items.map((item) => {
    let best = null, bestScore = 0;
    for (const t of byCore.get(titleParts(item.title).core) || []) {
      const s = matchScore(item, t);
      if (s > bestScore || (s === bestScore && s && used.has(best?.id) && !used.has(t.id))) { best = t; bestScore = s; }
    }
    if (best) used.add(best.id);
    return { item, track: best, exact: bestScore === 2 };
  });
}

/** "42 tracks · 17 in My library · 25 to get" */
export function playlistSummary(matches) {
  const have = matches.filter((m) => m.track).length, n = matches.length;
  const parts = [`${n} track${n === 1 ? '' : 's'}`];
  if (have) parts.push(`${have} in My library`);
  if (n - have) parts.push(`${n - have} to get`);
  return parts.join(' · ');
}

/** Where to export a playlist from, for the import dialog. */
export const EXPORT_HELP = {
  spotify: {
    label: 'Spotify',
    steps: [
      'Go to exportify.net and sign in with Spotify.',
      'Press Export next to the playlist. You get a .csv file.',
      'Choose that file below.',
    ],
    url: 'https://exportify.net',
  },
  apple: {
    label: 'Apple Music',
    steps: [
      'In the Music app on a Mac (or iTunes on Windows), select the playlist.',
      'Choose File › Library › Export Playlist… and save it as a text file.',
      'Choose that file below.',
    ],
    url: '',
  },
};
