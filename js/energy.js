// Energy: an estimate (1–10) for tracks whose tags don't carry one. DOM-free.

const clamp01 = (x) => Math.max(0, Math.min(1, x));

/** The energy to use for a track: its tagged energy first, then Cue Coach's estimate. */
export const energyOf = (t) => t?.energy ?? t?.energyEst ?? null;

/**
 * Energy 1–10 from three plain features of the track's main part (not the intro or outro):
 * loudness (RMS in dBFS), brightness (how much of the sound is high frequency, 0..1) and tempo.
 * Loud, bright and fast is high energy; quiet, dark and slow is low.
 */
export function estimateEnergy({ rmsDb, brightness, bpm }) {
  const loud = clamp01((rmsDb + 22) / 14);       // -22 dBFS → 0, -8 dBFS → 1
  const bright = clamp01((brightness - 0.05) / 0.3);
  const tempo = clamp01(((bpm || 120) - 100) / 45); // 100 → 0, 145 → 1
  return Math.max(1, Math.min(10, Math.round(1 + 9 * (0.5 * loud + 0.3 * bright + 0.2 * tempo))));
}

/**
 * Features from one channel of audio. The main part is the loud phrases (Chorus) when there are phrases,
 * else the middle 60% of the track.
 */
export function energyFeatures(x, sr, { bpm, phrases } = {}) {
  let spans = (phrases || []).filter((p) => p.label === 'Chorus').map((p) => [p.start, p.end]);
  if (!spans.length) spans = [[(x.length / sr) * 0.2, (x.length / sr) * 0.8]];
  let sum = 0, dsum = 0, n = 0;
  for (const [a, b] of spans) {
    const i0 = Math.max(1, Math.floor(a * sr)), i1 = Math.min(x.length, Math.floor(b * sr));
    for (let i = i0; i < i1; i += 3) { const v = x[i], d = v - x[i - 1]; sum += v * v; dsum += d * d; n++; }
  }
  if (!n) return null;
  const rms = Math.sqrt(sum / n);
  return { rmsDb: 20 * Math.log10(rms + 1e-9), brightness: Math.sqrt(dsum / n) / (rms + 1e-9), bpm };
}
