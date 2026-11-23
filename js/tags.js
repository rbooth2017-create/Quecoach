// Read the tags DJs care about (title, artist, genre, BPM, key, comment) from the start of an audio file.
// Supports ID3v2.2/2.3/2.4 (MP3, AIFF/WAV with ID3) and FLAC Vorbis comments. DOM-free.
// Everything else falls back to the file name (see musiclib.js parseFileName).

/** How many bytes to read from the start of a file to find its tags. */
export const TAG_BYTES = 256 * 1024;

const latin1 = new TextDecoder('latin1');
const utf8 = new TextDecoder('utf-8');
const utf16le = new TextDecoder('utf-16le');
const utf16be = new TextDecoder('utf-16be');

/** @param {ArrayBuffer} buf the first TAG_BYTES of the file */
export function readTags(buf) {
  const b = new Uint8Array(buf);
  if (b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) return readID3(b);
  if (b[0] === 0x66 && b[1] === 0x4c && b[2] === 0x61 && b[3] === 0x43) return readFLAC(b);
  return {};
}

// ---------- ID3v2 ----------
const synchsafe = (b, o) => ((b[o] & 0x7f) << 21) | ((b[o + 1] & 0x7f) << 14) | ((b[o + 2] & 0x7f) << 7) | (b[o + 3] & 0x7f);
const be32 = (b, o) => ((b[o] << 24) >>> 0) + (b[o + 1] << 16) + (b[o + 2] << 8) + b[o + 3];

const ID3_FIELDS = {
  TIT2: 'title', TT2: 'title', TPE1: 'artist', TP1: 'artist', TCON: 'genre', TCO: 'genre',
  TBPM: 'bpm', TBP: 'bpm', TKEY: 'key', TKE: 'key', COMM: 'comment', COM: 'comment',
};

function decodeText(bytes, enc) {
  let s;
  if (enc === 1) {
    if (bytes[0] === 0xfe && bytes[1] === 0xff) s = utf16be.decode(bytes.subarray(2));
    else s = utf16le.decode(bytes[0] === 0xff && bytes[1] === 0xfe ? bytes.subarray(2) : bytes);
  } else if (enc === 2) s = utf16be.decode(bytes);
  else if (enc === 3) s = utf8.decode(bytes);
  else s = latin1.decode(bytes);
  return s.replace(/\0+$/, '');
}

/** Split at the first null terminator for this encoding (1 byte, or 2 aligned bytes for UTF-16). */
function splitNull(bytes, enc) {
  const wide = enc === 1 || enc === 2;
  for (let i = 0; i < bytes.length - (wide ? 1 : 0); i += wide ? 2 : 1) {
    if (bytes[i] === 0 && (!wide || bytes[i + 1] === 0)) return [bytes.subarray(0, i), bytes.subarray(i + (wide ? 2 : 1))];
  }
  return [bytes, new Uint8Array(0)];
}

function readID3(b) {
  const ver = b[3], flags = b[5];
  const end = Math.min(b.length, 10 + synchsafe(b, 6));
  let o = 10;
  if (flags & 0x40) o += ver === 4 ? synchsafe(b, 10) : be32(b, 10) + 4; // extended header
  const idLen = ver === 2 ? 3 : 4, headLen = ver === 2 ? 6 : 10;
  const out = {};
  while (o + headLen <= end) {
    const id = latin1.decode(b.subarray(o, o + idLen));
    if (!/^[A-Z0-9]+$/.test(id)) break; // padding
    const size = ver === 2 ? (b[o + 3] << 16) | (b[o + 4] << 8) | b[o + 5] : ver === 4 ? synchsafe(b, o + 4) : be32(b, o + 4);
    const body = b.subarray(o + headLen, Math.min(end, o + headLen + size));
    o += headLen + size;
    const field = ID3_FIELDS[id];
    if (!field || !body.length || out[field]) continue;
    const enc = body[0];
    let text;
    if (field === 'comment') {
      const [, rest] = splitNull(body.subarray(4), enc); // skip language, then the description
      text = decodeText(rest, enc);
    } else text = decodeText(body.subarray(1), enc).split('\0')[0];
    text = text.trim();
    if (text) out[field] = text;
  }
  return clean(out);
}

// ---------- FLAC ----------
const VORBIS_FIELDS = { TITLE: 'title', ARTIST: 'artist', GENRE: 'genre', BPM: 'bpm', TEMPO: 'bpm', INITIALKEY: 'key', KEY: 'key', COMMENT: 'comment', DESCRIPTION: 'comment' };
const le32 = (b, o) => b[o] + (b[o + 1] << 8) + (b[o + 2] << 16) + ((b[o + 3] << 24) >>> 0);

function readFLAC(b) {
  let o = 4;
  while (o + 4 <= b.length) {
    const last = b[o] & 0x80, type = b[o] & 0x7f, len = (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3];
    if (type === 4) return clean(vorbis(b.subarray(o + 4, o + 4 + len)));
    o += 4 + len;
    if (last) break;
  }
  return {};
}

function vorbis(b) {
  const out = {};
  let o = 4 + le32(b, 0); // vendor string
  const n = le32(b, o); o += 4;
  for (let i = 0; i < n && o + 4 <= b.length; i++) {
    const len = le32(b, o); o += 4;
    const s = utf8.decode(b.subarray(o, o + len)); o += len;
    const eq = s.indexOf('=');
    const field = VORBIS_FIELDS[s.slice(0, eq).toUpperCase()];
    if (field && !out[field] && s.slice(eq + 1).trim()) out[field] = s.slice(eq + 1).trim();
  }
  return out;
}

// ---------- tidy up ----------
function clean(t) {
  const out = { ...t };
  if (out.genre) out.genre = out.genre.replace(/^\(\d+\)\s*/, '').trim() || undefined; // "(13)House" → "House"
  if (out.bpm != null) {
    const n = parseFloat(String(out.bpm).replace(',', '.'));
    out.bpm = Number.isFinite(n) && n >= 40 && n <= 250 ? n : undefined;
  }
  const energy = out.comment && out.comment.match(/energy\s*[:\-]?\s*(\d{1,2})/i); // Mixed In Key style
  if (energy && +energy[1] >= 1 && +energy[1] <= 10) out.energy = +energy[1];
  for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k];
  return out;
}
