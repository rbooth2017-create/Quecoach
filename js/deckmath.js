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
