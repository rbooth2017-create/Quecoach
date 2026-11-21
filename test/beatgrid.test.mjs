import test from 'node:test';
import assert from 'node:assert/strict';
import { analyseGrid, onsetEnvelope, roughTempo, beatPhase, bandPeaks, barEnergies, phrasesFromEnergy, GRID_VERSION } from '../js/beatgrid.js';

const SR = 22050;
// A dance track: kick on every beat, offbeat hats, bass in the drops; sections of 16 bars.
// [label, bars, kick, bass]
const LAYOUT = [['intro', 32, 0.6, 0], ['drop', 32, 1, 1], ['break', 16, 0, 0.2], ['drop', 32, 1, 1], ['outro', 32, 0.6, 0]];
function synthTrack(bpm, firstDownbeat, { pre = 0 } = {}) {
  const beat = 60 / bpm, bars = LAYOUT.reduce((s, l) => s + l[1], 0);
  const dur = firstDownbeat + bars * 4 * beat + 2;
  const x = new Float32Array(Math.ceil(dur * SR));
  let seed = 7; const noise = () => ((seed = (seed * 16807) % 2147483647) / 1073741823.5 - 1);
  const add = (t, fn, len, g) => { const o = Math.round(t * SR); for (let i = 0; i < len * SR && o + i < x.length; i++) if (o + i >= 0) x[o + i] += fn(i / SR) * g; };
  const kick = (t) => Math.sin(2 * Math.PI * (50 * t + 40 * (1 - Math.exp(-t * 35)) / 35)) * Math.exp(-t * 9);
  const hat = (t) => noise() * Math.exp(-t * 80);
  const bass = (t) => Math.sin(2 * Math.PI * 55 * t) * Math.min(1, t * 100) * Math.exp(-t * 5);
  // something before the first downbeat (a pickup) to make finding the "1" harder
  for (let k = 1; k <= pre; k++) add(firstDownbeat - k * beat, kick, 0.3, 0.3);
  let b = 0;
  for (const [, n, kg, bg] of LAYOUT) {
    for (let i = 0; i < n * 4; i++, b++) {
      const t = firstDownbeat + b * beat;
      if (kg) add(t, kick, 0.3, kg);
      add(t + beat / 2, hat, 0.05, 0.12);
      if (bg) add(t + beat / 2, bass, beat * 0.45, 0.5 * bg);
    }
  }
  return { x, dur, bars };
}

/** Worst timing error (ms) of a grid against the true beats, over the whole track. */
function worstErrorMs(grid, bpm, first, bars) {
  let worst = 0;
  for (let k = 0; k < bars * 4; k++) {
    const truth = first + k * 60 / bpm;
    const nearest = grid.firstDownbeat + Math.round((truth - grid.firstDownbeat) * grid.bpm / 60) * 60 / grid.bpm;
    worst = Math.max(worst, Math.abs(nearest - truth));
  }
  return worst * 1000;
}

test('the old first-75-seconds estimate drifts audibly by the end of the track', () => {
  const bpm = 128.37, first = 0.213, { x, bars } = synthTrack(bpm, first);
  const { env, fps } = onsetEnvelope(x, SR, 75);
  const b = roughTempo(env, fps), period = fps * 60 / b;
  const old = { bpm: Math.round(b * 100) / 100, firstDownbeat: Math.max(0, beatPhase(env, period) - 0.5) / fps };
  const err = worstErrorMs(old, bpm, first, bars);
  assert.ok(err > 15, `expected the old method to drift, got ${err.toFixed(1)} ms`); // documents the bug we're fixing
});

// 4 ms is far below what anyone hears (rekordbox's own grids sit ~10-15 ms from ours on real tracks).
test('whole-track fitting keeps every beat within 4 ms, at awkward tempos too', () => {
  for (const [bpm, first] of [[128.37, 0.213], [122.0, 0.05], [174.2, 0.4], [96.85, 0.31]]) {
    const { x, bars } = synthTrack(bpm, first);
    const g = analyseGrid(x, SR);
    const err = worstErrorMs(g, bpm, first, bars);
    assert.ok(err < 4, `${bpm} BPM: worst beat ${err.toFixed(2)} ms off (got ${g.bpm} BPM, first ${g.firstDownbeat})`);
    assert.ok(Math.abs(g.bpm - bpm) < 0.01, `${bpm} BPM read as ${g.bpm}`);
    assert.equal(g.v, GRID_VERSION); assert.equal(g.estimated, true);
  }
});

test('the "1" lands on the real downbeat, even with a pickup before it', () => {
  for (const pre of [0, 3]) {
    const bpm = 125, first = 2.0, { x } = synthTrack(bpm, first, { pre });
    const g = analyseGrid(x, SR);
    const beatsOff = (g.firstDownbeat - first) / (60 / bpm);
    const barPos = ((Math.round(beatsOff) % 4) + 4) % 4;
    assert.equal(barPos, 0, `pre=${pre}: the "1" is ${barPos} beats off (first downbeat ${g.firstDownbeat})`);
  }
});

test('three-band waveform and phrases from the audio', () => {
  const bpm = 124, first = 0.1, { x } = synthTrack(bpm, first);
  const w = bandPeaks(x, SR, 100);
  assert.ok(Math.abs(w.rate - 100) < 1);
  assert.ok(w.low.length > 100 && w.low.every((v) => v >= 0 && v <= 1));
  assert.ok(Math.max(...w.low) > Math.max(...w.high)); // a kick-heavy track is mostly low end
  const grid = { bpm, firstDownbeat: first };
  const ph = phrasesFromEnergy(barEnergies(x, SR, grid), grid);
  assert.deepEqual(ph.map((p) => p.label), ['Intro', 'Up', 'Chorus', 'Chorus', 'Down', 'Chorus', 'Chorus', 'Outro', 'Outro']);
  assert.ok(Math.abs(ph.at(-1).end - (first + 145 * 240 / bpm)) < 1e-6, 'the short tail joins the last phrase');
  assert.ok(Math.abs(ph[2].start - (first + 32 * 240 / bpm)) < 1e-6);
});

import { gridUnsure, GRID_UNSURE } from '../js/beatgrid.js';
test('the grid says when it is unsure: a steady kick is sure, noise is not', () => {
  const { x } = synthTrack(126, 0.4);
  const sure = analyseGrid(x, SR);
  assert.ok(sure.fit > GRID_UNSURE, `steady kick fit ${sure.fit}`);
  assert.equal(gridUnsure(sure), false);
  let seed = 3; const noise = new Float32Array(SR * 60).map(() => ((seed = (seed * 16807) % 2147483647) / 1073741823.5 - 1) * 0.3);
  const unsure = analyseGrid(noise, SR);
  assert.ok(unsure.fit < GRID_UNSURE, `noise fit ${unsure.fit}`);
  assert.equal(gridUnsure(unsure), true);
  assert.equal(gridUnsure({ ...unsure, adjusted: true }), false); // the DJ fixed it
  assert.equal(gridUnsure({ bpm: 120, firstDownbeat: 0 }), false); // rekordbox's grid
});
