// Pure maths for our own decks (audio spike, later the real engine). DOM-free and testable.

/**
 * Time-stretch settings for a deck.
 * tempoPct: tempo fader in % (e.g. +2.5). bend: temporary jog nudge as a fraction (e.g. 0.04).
 * keyLock on: the pitch stays put and only the speed changes. Off: pitch follows speed, like a turntable.
 */
export function stretchParams(tempoPct, bend = 0, keyLock = true) {
  const rate = (1 + tempoPct / 100) * (1 + bend);
  const semitones = keyLock ? 0 : 12 * Math.log2(rate);
  return { rate, semitones };
}

/**
 * Key lock as a pitch correction after the deck: the deck plays at its tempo (which bends the pitch, like a
 * turntable) and the key lock shifts it back by this many semitones. Only the tempo fader is corrected, not a
 * jog nudge, so a nudge still sounds like a nudge and the correction doesn't wobble while the wheel moves.
 */
export const keyLockSemitones = (tempoPct) => (tempoPct ? -12 * Math.log2(1 + tempoPct / 100) : 0);

/**
 * Where the listener is in the track (track seconds) when the sound reaches them `lag` seconds late
 * (the key lock's processing delay). raw: where the deck's playhead is. since: seconds since play was pressed,
 * startOffset: where play was pressed. During the first `lag` seconds nothing has come out yet.
 */
export function heardPosition({ raw, lag = 0, rate = 1, since = Infinity, startOffset = raw }) {
  if (!(lag > 0)) return raw;
  return since < lag ? startOffset : raw - lag * rate;
}

/**
 * Jog wheel nudge from a relative MIDI value (Pioneer, Hercules and Numark send 64 = still,
 * above 64 = forward, below 64 = back). Returns a temporary bend fraction, clamped to ±maxBend.
 */
export function jogBend(value, { sensitivity = 0.01, maxBend = 0.08 } = {}) {
  const ticks = value - 64;
  return Math.max(-maxBend, Math.min(maxBend, ticks * sensitivity));
}

/**
 * Which output channels to use for the room (master) and the headphones (cue).
 * DJ controllers with a built-in sound card (DDJ-FLX4, DDJ-400, Inpulse…) expose 4 outputs:
 * 1/2 = master, 3/4 = headphones. A plain 2-channel device has no separate cue.
 */
export function outputPlan(maxChannelCount, cuePair = 2) {
  const n = Math.max(2, Math.floor(maxChannelCount || 2));
  const cueStart = (cuePair - 1) * 2;
  if (cuePair > 1 && n >= cueStart + 2) {
    return { channels: Math.max(4, cueStart + 2), master: [0, 1], cue: [cueStart, cueStart + 1], separateCue: true };
  }
  return { channels: 2, master: [0, 1], cue: null, separateCue: false };
}

/** Pass/fail for the spike's go criteria. latency in seconds, quality is the tester's own ear check. */
export function spikeVerdict({ separateCue, totalLatency, keyLockClean }) {
  const checks = {
    separateCue: !!separateCue,
    latency: Number.isFinite(totalLatency) && totalLatency < 0.025,
    keyLock: keyLockClean === true,
  };
  return { ...checks, go: checks.separateCue && checks.latency && checks.keyLock };
}

// ---------- on-screen jog wheel and dials ----------

/** Smallest signed angle from a to b, in radians (−π..π). */
export function angleDelta(a, b) {
  let d = b - a;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

/** One turn of the on-screen wheel = this many seconds of music when scrubbing a paused track. */
export const SECONDS_PER_TURN = 1.8;
/** How far the platter turns per second of music (33⅓ rpm, like a turntable). */
export const TURNS_PER_SECOND = 100 / 3 / 60;

/** Spinning the wheel while the track plays: angular speed (rad/s) → temporary speed bend, clamped. */
export function jogBendFromSpeed(radPerSec, { gain = 0.012, maxBend = 0.12 } = {}) {
  return Math.max(-maxBend, Math.min(maxBend, radPerSec * gain));
}

/** Turning the wheel while paused moves through the track. */
export const scrubSeconds = (dAngle) => (dAngle / (2 * Math.PI)) * SECONDS_PER_TURN;

/** A dial dragged up/down: `dy` pixels (up = negative) from `start`, `px` pixels for the full range. */
export function dialValue(start, dy, min, max, px = 160) {
  return Math.max(min, Math.min(max, start - (dy / px) * (max - min)));
}

/**
 * Value → dial travel 0..1. With a centre (EQ: 0 dB), the centre sits at 12 o'clock and each side is
 * scaled on its own, so a −30…+6 dB EQ reads "flat" at noon like a mixer, not three-quarters of the way round.
 */
export function dialT(v, min, max, centre = null) {
  const x = Math.max(min, Math.min(max, v));
  if (centre == null || !(centre > min && centre < max)) return (x - min) / (max - min);
  return x <= centre ? 0.5 * (x - min) / (centre - min) : 0.5 + 0.5 * (x - centre) / (max - centre);
}
/** Dial travel 0..1 → value (the inverse of dialT). */
export function dialFromT(t, min, max, centre = null) {
  const u = Math.max(0, Math.min(1, t));
  if (centre == null || !(centre > min && centre < max)) return min + u * (max - min);
  return u <= 0.5 ? min + (u / 0.5) * (centre - min) : centre + ((u - 0.5) / 0.5) * (max - centre);
}

/** Dial position 0..1 → pointer angle in radians, sweeping 270° from bottom-left (−135°) to bottom-right (+135°). */
export const dialAngle = (t) => (-135 + 270 * Math.max(0, Math.min(1, t))) * Math.PI / 180;

// ---------- counting ----------

/**
 * Where a deck is in the music: beat 1–4 of the bar, bar number, bar 1–16 within the phrase,
 * which 4-bar block of the phrase (1–4), and the phrase number. null before the first downbeat.
 */
export function beatCount(grid, pos, phraseBars = 16) {
  if (!grid?.bpm) return null;
  const beats = Math.floor((pos - grid.firstDownbeat) * grid.bpm / 60 + 1e-6);
  if (beats < 0) return null;
  const bar = Math.floor(beats / 4) + 1, barInPhrase = ((bar - 1) % phraseBars) + 1;
  return { beat: (beats % 4) + 1, bar, barInPhrase, block: Math.ceil(barInPhrase / 4), barInBlock: ((barInPhrase - 1) % 4) + 1, phrase: Math.floor((bar - 1) / phraseBars) + 1 };
}

/** Beats into the phrase (0 ≤ x < phraseBars×4, fractional), or null before the first downbeat or without a grid. */
export function phraseBeat(grid, pos, phraseBars = 16) {
  if (!grid?.bpm) return null;
  const beats = (pos - grid.firstDownbeat) * grid.bpm / 60;
  if (beats < -1e-6) return null;
  const n = phraseBars * 4;
  return ((beats % n) + n) % n;
}

/**
 * How far `other` has to jump, in whole beats, to sit on the same beat and bar of the phrase as `ref`
 * (the nearest way round, so −½ phrase ≤ beats < +½ phrase). Whole beats keep the other deck's place
 * within the beat, so beatmatching survives the jump. Each deck uses its own grid, so the BPMs can differ.
 * Returns { beats, bars, target, canAlign } or null. `canAlign`: 1 beat to `maxBeats` apart and the
 * landing point is inside the music.
 */
export function phraseOffset(refGrid, refPos, otherGrid, otherPos, { phraseBars = 16, maxBeats = 8, duration = Infinity } = {}) {
  const a = phraseBeat(refGrid, refPos, phraseBars), b = phraseBeat(otherGrid, otherPos, phraseBars);
  if (a == null || b == null) return null;
  const n = phraseBars * 4;
  let beats = Math.round(a - b);
  beats = ((beats % n) + n) % n;
  if (beats >= n / 2) beats -= n;
  beats = beats || 0; // no −0
  const target = otherPos + beats * 60 / otherGrid.bpm;
  const canAlign = beats !== 0 && Math.abs(beats) <= maxBeats && target >= otherGrid.firstDownbeat - 1e-6 && target < duration;
  return { beats, bars: beats / 4, target, canAlign };
}

// ---------- loops and beat jump ----------

/** Beat loop sizes on the pads (beats): ¼, ½, 1, 2, 4, 8, 16, 32. */
export const LOOP_SIZES = [0.25, 0.5, 1, 2, 4, 8, 16, 32];
/** Beat jump pads: back/forward 1, 2, 4 and 8 beats. */
export const JUMP_SIZES = [-1, 1, -2, 2, -4, 4, -8, 8];

/**
 * A loop of `beats` starting on the grid line at or just before `pos` (for loops shorter than a beat, the
 * nearest fraction of a beat before `pos`). Without a grid, the loop starts right at `pos` at 120 BPM.
 */
export function loopAt(grid, pos, beats) {
  const beat = grid?.bpm ? 60 / grid.bpm : 0.5;
  const unit = beat * Math.min(1, beats);
  const origin = grid?.firstDownbeat ?? pos;
  const start = origin + Math.floor((pos - origin) / unit + 1e-9) * unit;
  return { start, end: start + beats * beat, beats };
}

/** Where playback really is once it has wrapped around a loop. */
export function wrapInLoop(p, loop) {
  if (!loop || p < loop.end) return p;
  const len = loop.end - loop.start;
  return loop.start + ((p - loop.start) % len);
}

/** Jump `beats` (± ) from pos, keeping the same place in the beat. */
export function jumpBy(grid, pos, beats) {
  const beat = grid?.bpm ? 60 / grid.bpm : 0.5;
  return Math.max(0, pos + beats * beat);
}

/** Halve or double a loop from its start, never shorter than ⅛ beat or longer than 64 beats. */
export function scaleLoop(loop, factor, grid) {
  const beat = grid?.bpm ? 60 / grid.bpm : 0.5;
  const beats = Math.max(0.125, Math.min(64, loop.beats * factor));
  return { start: loop.start, end: loop.start + beats * beat, beats };
}
