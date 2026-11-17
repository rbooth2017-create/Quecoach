// Read any supported DJ controller: raw MIDI → simple state. DOM-free.
// Profiles (MIDI numbers per model) live in controllers.js, generated from Mixxx's mappings.
import { CONTROLLERS } from './controllers.js';

export { CONTROLLERS };
export const findController = (id) => CONTROLLERS.find((c) => c.id === id) || null;
/** Which supported controller is this MIDI device? */
export const detectController = (deviceName) => CONTROLLERS.find((c) => deviceName.toLowerCase().includes(c.match.toLowerCase())) || null;

export function emptyController() {
  const deck = () => ({
    fader: null, trim: null, hi: null, mid: null, low: null, filter: null, tempo: null,
    headphones: false, // headphone CUE, toggled by presses
    presses: { play: 0, cue: 0, sync: 0, jog: 0 },
    lastPress: {},     // button → time of last press (ms)
  });
  return { connected: false, decks: { 1: deck(), 2: deck() }, crossfader: null, headMix: null, msb: {} };
}

const lookups = new WeakMap();
function lookup(profile) {
  if (!lookups.has(profile)) lookups.set(profile, new Map(profile.controls.map(([s, d, name, part]) => [`${s}:${d}`, [name, part]])));
  return lookups.get(profile);
}

/**
 * Apply one MIDI message for this controller profile. Returns e.g. "2.play" / "1.low", or null.
 * opts.tempoRange: ±% set in the DJ software (rekordbox default 10). opts.invertTempo flips the slider.
 */
export function applyMidi(profile, ctl, [status, data1, data2], now = Date.now(), opts = {}) {
  const hit = lookup(profile).get(`${status}:${data1}`);
  if (!hit) return null;
  const [name, part] = hit;
  const [where, what] = name.split('.');
  const deckNo = where === 'd1' ? 1 : where === 'd2' ? 2 : null;
  const d = deckNo ? ctl.decks[deckNo] : null;
  const type = status & 0xf0;

  if (part === 'note') {
    if (type !== 0x90 || data2 === 0) return null; // presses only
    if (what === 'headphones') d.headphones = !d.headphones;
    else { d.presses[what] = (d.presses[what] || 0) + 1; d.lastPress[what] = now; }
    return `${deckNo}.${what}`;
  }
  if (part === 'rel') { d.presses.jog++; d.lastPress.jog = now; return `${deckNo}.jog`; }

  // continuous controls → 0..1
  let raw, max;
  if (part === 'msb') { ctl.msb[name] = data2; raw = data2 << 7; max = 16383; }
  else if (part === 'lsb') { raw = ((ctl.msb[name] ?? 0) << 7) | data2; max = 16383; }
  else { raw = data2; max = 127; }
  const v = raw / max;
  if (what === 'tempo') {
    // Pioneer-style: top of the slider (0) = slower, middle = 0 %, bottom = faster
    const pct = (raw / ((max + 1) / 2) - 1) * (opts.tempoRange ?? 10);
    d.tempo = opts.invertTempo ? -pct : pct;
  } else if (d) d[what] = v;
  else ctl[what] = v;
  return part === 'lsb' ? null : `${deckNo || 'mixer'}.${what}`;
}
