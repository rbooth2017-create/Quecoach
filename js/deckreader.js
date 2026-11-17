// Deck reader: which track is on each rekordbox deck, from OCR text of the deck's header. DOM-free.
//
// The header shows the title (large), the artist and the BPM. OCR adds noise from nearby
// buttons ("BEAT SYNC", "MASTER", times), so instead of trusting the text we look for the
// library title that best appears in it, allowing small OCR mistakes.

const norm = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, ' ').trim();
const words = (s) => norm(s).split(' ').filter(Boolean);

/** Similarity 0..1 of two short strings (Levenshtein). */
export function similarity(a, b) {
  if (a === b) return 1;
  const m = a.length, n = b.length;
  if (!m || !n) return 0;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return 1 - prev[n] / Math.max(m, n);
}

/** How well `phrase` appears somewhere in the word list (best window of the same length). */
function phraseScore(phrase, textWords) {
  const p = words(phrase);
  if (!p.length || !textWords.length) return 0;
  const target = p.join(' ');
  let best = 0;
  for (let len = Math.max(1, p.length - 1); len <= p.length + 1; len++) {
    for (let i = 0; i + len <= textWords.length; i++) {
      const win = textWords.slice(i, i + len).join(' ');
      const s = similarity(target, win);
      if (s > best) best = s;
    }
  }
  return best;
}

/** BPM shown in the header (e.g. "128.00"), if OCR caught one. */
export function readBpm(text) {
  const m = [...String(text).matchAll(/(?<![\d:.])(\d{2,3}[.,]\d{1,2})(?![\d:])/g)].map((x) => parseFloat(x[1].replace(',', '.')));
  const plausible = m.filter((v) => v >= 50 && v <= 220);
  return plausible.length ? plausible[plausible.length - 1] : null;
}

/**
 * Best library match for a deck header's OCR text.
 * Returns { track, score, bpm } or { track: null, bpm } when nothing matches well enough.
 */
export function matchDeck(text, library) {
  const tw = words(text);
  const bpm = readBpm(text);
  let best = null, second = 0;
  for (const t of library) {
    if (!t.title) continue;
    let score = phraseScore(t.title, tw);
    // whole title found: favour longer exact titles ("House 3" over "House")
    if (score > 0.99) score += words(t.title).length * 0.01;
    if (t.artist) score += 0.08 * phraseScore(t.artist, tw);
    if (bpm && t.bpm && Math.abs(t.bpm - bpm) < 0.6) score += 0.03;
    if (!best || score > best.score) { second = best ? best.score : 0; best = { track: t, score }; }
    else if (score > second) second = score;
  }
  if (!best || best.score < 0.82) return { track: null, score: best?.score ?? 0, bpm };
  return { track: best.track, score: best.score, margin: best.score - second, bpm };
}
