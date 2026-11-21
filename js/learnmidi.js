// DJ controller → Learn app actions. DOM-free so it can be tested with real controller messages.
// Uses the per-model MIDI maps in controllers.js (generated from Mixxx) via applyMidi in controller.js.
import { applyMidi } from './controller.js';

/** EQ knob 0..1 → dB: centre is flat, fully left is a full cut (−30 dB), fully right is +6 dB. */
export const eqDb = (v) => (v >= 0.5 ? (v - 0.5) * 12 : -30 * (1 - v * 2));

/**
 * Jog wheel movement in ticks (+ forward, − back). Pioneer jogs centre on 64 (65 = +1, 63 = −1);
 * Hercules and Numark count from 1 forward and down from 127 backward.
 */
export function jogTicks(profile, value) {
  if (profile.jog === 'centered' || (!profile.jog && profile.id.startsWith('ddj-'))) return value - 64;
  return value >= 64 ? value - 128 : value;
}

/**
 * One MIDI message → one action for the app, or null. `ctl` is the controller state from
 * emptyController() and is updated in place (so knobs and toggles remember where they are).
 * Actions: play, restart, sync, jog, tempo, eq, volume, listen, xfader. Deck 1 is A (left), deck 2 is B (right).
 */
export function midiToAction(profile, ctl, data, { tempoRange = 8, now = Date.now() } = {}) {
  const extra = EXTRAS[profile.id]?.(ctl, data);
  if (extra !== undefined) return extra;
  const hit = applyMidi(profile, ctl, data, now, { tempoRange });
  if (!hit) return null;
  const [where, what] = hit.split('.');
  const side = where === '1' ? 'left' : where === '2' ? 'right' : null;
  const d = side ? ctl.decks[where] : null;
  switch (what) {
    case 'play': return { type: 'play', side };
    case 'cue': return { type: 'restart', side };
    case 'sync': return { type: 'sync', side };
    case 'jog': return { type: 'jog', side, ticks: jogTicks(profile, data[2]) };
    case 'tempo': return { type: 'tempo', side, pct: Math.max(-tempoRange, Math.min(tempoRange, d.tempo)) };
    case 'hi': case 'mid': case 'low': return { type: 'eq', side, band: what === 'hi' ? 'high' : what, db: Math.round(eqDb(d[what]) * 10) / 10 };
    case 'fader': return { type: 'volume', side, value: d.fader };
    case 'trim': return { type: 'trim', side, db: Math.round((d.trim - 0.5) * 24 * 10) / 10 };
    case 'filter': return { type: 'filter', side, value: d.filter };
    case 'headphones': return { type: 'listen', side, on: d.headphones };
    case 'crossfader': return { type: 'xfader', value: ctl.crossfader };
    case 'headMix': return ctl.headMix == null ? null : { type: 'headMix', value: ctl.headMix };
    default: return null;
  }
}

/**
 * Some controllers wait for DJ software to say hello before they report their controls. This is the
 * message Mixxx sends the DDJ-FLX4 at start and every 200 ms (it also asks for the knob positions).
 */
export const KEEPALIVE = {
  'ddj-flx4': { bytes: [0xF0, 0x00, 0x40, 0x05, 0x00, 0x00, 0x04, 0x05, 0x00, 0x50, 0x02, 0xF7], everyMs: 200 },
};

const SIDE_NAME = { left: 'deck A', right: 'deck B' };
/** Plain words for the controller monitor: what Cue Coach did with a message. */
export function describeAction(a) {
  if (!a) return 'not used yet';
  const deck = a.side ? `, ${SIDE_NAME[a.side]}` : '';
  switch (a.type) {
    case 'play': return `Play / pause${deck}`;
    case 'restart': return `Cue: back to the start${deck}`;
    case 'sync': return `Beat sync: align this deck's phrase to the other deck${deck}`;
    case 'jog': return `Jog ${a.ticks > 0 ? '+' : ''}${a.ticks}${deck}`;
    case 'tempo': return `Tempo ${a.pct >= 0 ? '+' : ''}${a.pct.toFixed(2)}%${deck}`;
    case 'eq': return `${{ high: 'Treble', mid: 'Mid', low: 'Bass' }[a.band]} ${a.db > 0 ? '+' : ''}${a.db} dB${deck}`;
    case 'volume': return `Channel fader ${Math.round(a.value * 100)}%${deck}`;
    case 'listen': return `Listen ${a.on ? 'on' : 'off'}${deck}`;
    case 'xfader': return `Crossfader ${Math.round(a.value * 100)}% to B`;
    case 'headMix': return `Headphone mix ${Math.round(a.value * 100)}% room`;
    case 'search': return `Fast search ${a.ticks > 0 ? '+' : ''}${a.ticks}${deck}`;
    case 'touch': return `Jog top ${a.on ? 'touched' : 'released'}${deck}`;
    case 'shift': return `Shift ${a.on ? 'down' : 'up'}`;
    case 'pad': return `Pad ${a.pad + 1}${a.mode ? ` (${a.mode === 'hotcue' ? 'hot cue' : a.mode})` : ''}${a.shift ? ' + Shift' : ''} ${a.down ? 'pressed' : 'released'}${deck}`;
    case 'padMode': return `Pad mode: ${a.mode}${deck}`;
    case 'loopIn': return `Loop in${deck}`;
    case 'loopOut': return `Loop out${deck}`;
    case 'reloop': return `Reloop / exit${deck}`;
    case 'loopHalf': return `Halve loop${deck}`;
    case 'loopDouble': return `Double loop${deck}`;
    case 'jump': return `Jump ${a.beats > 0 ? '+' : ''}${a.beats} beats${deck}`;
    case 'fxOn': return 'Beat FX on / off';
    case 'fxSelect': return `Beat FX: ${a.step > 0 ? 'next' : 'previous'} effect`;
    case 'fxBeats': return `Beat FX: ${a.step > 0 ? 'longer' : 'shorter'} beat`;
    case 'fxChannel': return `Beat FX channel: ${a.ch}`;
    case 'fxLevel': return `Beat FX level ${Math.round(a.value * 100)}%`;
    case 'browse': return `Browse ${a.steps > 0 ? 'down' : 'up'}`;
    case 'browsePress': return 'Browse press: switch library tab';
    case 'load': return `Load the selected track${deck}`;
    case 'trim': return `Trim ${a.db > 0 ? '+' : ''}${a.db} dB${deck}`;
    case 'filter': return `Filter ${a.value < 0.47 ? 'low-pass' : a.value > 0.53 ? 'high-pass' : 'off'}${deck}`;
    default: return a.type;
  }
}

/** "90 0B 7F" for the monitor. */
export const hexBytes = (data) => [...data].map((b) => b.toString(16).toUpperCase().padStart(2, '0')).join(' ');

// ---------- extra DDJ-FLX4 controls (not in the generated map) ----------
// Codes from Mixxx's DDJ-FLX4 mapping. Deck 1 = A (left), deck 2 = B (right).
/** Jog wheel steps per full turn (the FLX4 reports 720, like a turntable). */
export const JOG_STEPS_PER_TURN = 720;

/** Browse knob: 1–63 = clockwise steps, 65–127 = anticlockwise (two's complement). */
export const browseSteps = (v) => (v === 0 || v === 64 ? 0 : v < 64 ? v : v - 128);

/** Pad mode buttons on each deck (status 0x90 / 0x91). */
export const PAD_MODES = { 0x1b: 'hotcue', 0x69: 'keyboard', 0x1e: 'fx1', 0x6b: 'fx2', 0x20: 'jump', 0x6d: 'loop', 0x22: 'sampler', 0x6f: 'keyshift' };
/** First pad note for each mode on the pad channels (0x97 / 0x99, Shift 0x98 / 0x9A). */
export const PAD_BASE = { hotcue: 0x00, jump: 0x20, sampler: 0x30, keyboard: 0x40, loop: 0x60 };
const PAD_RANGES = Object.entries(PAD_BASE).map(([mode, base]) => [mode, base]);

function flx4Extras(ctl, [status, d1, v]) {
  const type = status & 0xf0, ch = status & 0x0f;
  const isNote = type === 0x90 || type === 0x80;
  const down = type === 0x90 && v > 0;
  const deckSide = ch === 0 ? 'left' : ch === 1 ? 'right' : null;
  // jog wheel: side (0x21, via the generated map), top with vinyl mode on/off (0x22/0x23), Shift + top = search (0x29)
  if (type === 0xb0 && deckSide && (d1 === 0x22 || d1 === 0x23)) return { type: 'jog', side: deckSide, ticks: v - 64 };
  if (type === 0xb0 && deckSide && d1 === 0x29) return { type: 'search', side: deckSide, ticks: v - 64 };
  if (isNote && deckSide) {
    if (d1 === 0x36 || d1 === 0x67) return { type: 'touch', side: deckSide, on: down };
    if (d1 === 0x3f) { ctl.shift = down; return { type: 'shift', on: down }; }
    if (PAD_MODES[d1]) return down ? { type: 'padMode', side: deckSide, mode: PAD_MODES[d1] } : null;
    // loop section
    const loopKey = { 0x10: 'loopIn', 0x11: 'loopOut', 0x4d: 'reloop', 0x51: 'loopHalf', 0x53: 'loopDouble' }[d1];
    if (loopKey) return down ? { type: loopKey, side: deckSide } : null;
    if (d1 === 0x3e || d1 === 0x3d) return down ? { type: 'jump', side: deckSide, beats: d1 === 0x3e ? -32 : 32 } : null;
    if (d1 === 0x4c || d1 === 0x4e || d1 === 0x50) return null; // loop adjust with the jog, reloop-and-stop: not used yet
  }
  // performance pads: 0x97 / 0x99 (deck 1 / 2), 0x98 / 0x9A with Shift
  if (isNote && ch >= 7 && ch <= 10) {
    const side = ch <= 8 ? 'left' : 'right', shift = ch === 8 || ch === 10;
    const hit = PAD_RANGES.find(([, base]) => d1 >= base && d1 < base + 8);
    if (hit?.[0] === 'keyboard') return null; // keyboard mode isn't used yet
    // pads we don't have codes for (PAD FX) come in on other notes: they follow the deck's current pad mode
    return { type: 'pad', side, mode: hit ? hit[0] : null, pad: hit ? d1 - hit[1] : d1 & 0x07, down, shift };
  }
  // browse knob, browse press, Load A / Load B
  if (type === 0xb0 && ch === 6 && d1 === 0x40) return { type: 'browse', steps: browseSteps(v) };
  if (isNote && ch === 6 && (d1 === 0x41 || d1 === 0x42)) return down ? { type: 'browsePress' } : null;
  if (isNote && ch === 6 && (d1 === 0x46 || d1 === 0x47)) return down ? { type: 'load', side: d1 === 0x46 ? 'left' : 'right' } : null;
  // Beat FX (0x94 / 0x95)
  if (isNote && (ch === 4 || ch === 5)) {
    if (d1 === 0x10 || d1 === 0x11) { // CH SELECT switch: CH1 / CH2 / both
      ctl.bfxSel ||= { a: false, b: false };
      if (d1 === 0x10) ctl.bfxSel.a = down; else ctl.bfxSel.b = down;
      return { type: 'fxChannel', ch: ctl.bfxSel.a && !ctl.bfxSel.b ? 'A' : ctl.bfxSel.b && !ctl.bfxSel.a ? 'B' : 'both' };
    }
    if (!down) return null;
    if (d1 === 0x47) return { type: 'fxOn' };
    if (d1 === 0x63) return { type: 'fxSelect', step: 1 };
    if (d1 === 0x64) return { type: 'fxSelect', step: -1 };
    if (d1 === 0x4a) return { type: 'fxBeats', step: -1 };
    if (d1 === 0x4b) return { type: 'fxBeats', step: 1 };
    return null;
  }
  if (type === 0xb0 && ch === 4 && d1 === 0x02) return { type: 'fxLevel', value: v / 127 };
  return undefined; // let the generated map handle it
}
// The DDJ-400 is the FLX4's predecessor with the same MIDI layout (its Mixxx map matches the FLX4's control
// for control), so it gets the same pads, loops, browse, Beat FX and lights.
const EXTRAS = { 'ddj-flx4': flx4Extras, 'ddj-400': flx4Extras };
/** Controllers whose button lights and level meters Cue Coach drives. */
export const LIGHTS = new Set(['ddj-flx4', 'ddj-400']);

/**
 * Button lights to send for the current state: [[status, data1, value], ...] (FLX4).
 * Each deck: { playing, loaded, listening, cues: [8], padMode, loopBeats, fxPads: Set, sampling: Set }; plus fxOn.
 */
export function flx4Lights({ left, right, fxOn = false }) {
  const out = [];
  const LOOP_SIZES = [0.25, 0.5, 1, 2, 4, 8, 16, 32];
  for (const [ch, d] of [[0, left], [1, right]]) {
    out.push([0x90 + ch, 0x0b, d.playing ? 0x7f : 0]);        // PLAY
    out.push([0x90 + ch, 0x0c, d.loaded ? 0x7f : 0]);         // CUE
    out.push([0x90 + ch, 0x54, d.listening ? 0x7f : 0]);      // headphone CUE
    const looping = d.loopBeats != null;
    out.push([0x90 + ch, 0x10, looping ? 0x7f : 0]); out.push([0x90 + ch, 0x11, looping ? 0x7f : 0]); out.push([0x90 + ch, 0x4d, looping ? 0x7f : 0]);
    const mode = d.padMode || 'hotcue';
    for (const [note, m] of Object.entries(PAD_MODES)) out.push([0x90 + ch, +note, m === mode ? 0x7f : 0]); // pad mode buttons
    const padSt = 0x97 + ch * 2;
    for (let i = 0; i < 8; i++) {
      out.push([padSt, PAD_BASE.hotcue + i, mode === 'hotcue' && d.cues?.[i] != null ? 0x7f : 0]);
      out.push([padSt, PAD_BASE.loop + i, mode === 'loop' && d.loopBeats === LOOP_SIZES[i] ? 0x7f : 0]);
      out.push([padSt, PAD_BASE.sampler + i, mode === 'sampler' ? 0x7f : 0]);
    }
  }
  out.push([0x94, 0x47, fxOn ? 0x7f : 0]);                      // Beat FX on
  return out;
}

/**
 * Channel level meters (the LED columns by each channel's EQ): level 0..1 per deck → MIDI messages.
 * Deck 1 is 0xB0 0x02, deck 2 is 0xB1 0x02 (from Mixxx's DDJ-FLX4 mapping).
 */
export function flx4Meters({ left = 0, right = 0 }) {
  const v = (x) => Math.max(0, Math.min(127, Math.round(Math.min(1, x) * 127)));
  return [[0xb0, 0x02, v(left)], [0xb1, 0x02, v(right)]];
}
