import test from 'node:test';
import assert from 'node:assert/strict';
import { estimateEnergy, energyFeatures, energyOf } from '../js/energy.js';
import { shapeLabels, setArc, energyChartSVG } from '../js/setchart.js';

const sr = 8000;
/** A test signal: a kick-like low thump plus optional hi-hat noise, at a level. */
function synth({ seconds = 8, level = 0.5, hats = 0, bpm = 124 }) {
  const x = new Float32Array(seconds * sr); let seed = 1;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  const beat = (60 / bpm) * sr;
  for (let i = 0; i < x.length; i++) {
    const p = (i % beat) / sr;
    x[i] = level * Math.sin(2 * Math.PI * 55 * p) * Math.exp(-p * 8) + hats * rnd() * Math.exp(-((i % (beat / 2)) / sr) * 30);
  }
  return x;
}
const est = (o) => estimateEnergy(energyFeatures(synth(o), sr, { bpm: o.bpm || 124 }));

test('loud, bright and fast scores higher than quiet, dark and slow', () => {
  const low = est({ level: 0.08, hats: 0, bpm: 112 });
  const mid = est({ level: 0.3, hats: 0.05, bpm: 124 });
  const high = est({ level: 0.8, hats: 0.3, bpm: 134 });
  assert.ok(low < mid && mid < high, `${low} ${mid} ${high}`);
  for (const e of [low, mid, high]) assert.ok(e >= 1 && e <= 10);
});

test('estimateEnergy stays within 1–10 at the extremes', () => {
  assert.equal(estimateEnergy({ rmsDb: -80, brightness: 0, bpm: 60 }), 1);
  assert.equal(estimateEnergy({ rmsDb: 0, brightness: 1, bpm: 180 }), 10);
});

test('only the main (Chorus) part counts when there are phrases', () => {
  const x = synth({ seconds: 8, level: 0.6, hats: 0.1 });
  for (let i = 0; i < 4 * sr; i++) x[i] *= 0.05; // a quiet intro
  const all = energyFeatures(x, sr, { bpm: 124 });
  const main = energyFeatures(x, sr, { bpm: 124, phrases: [{ label: 'Intro', start: 0, end: 4 }, { label: 'Chorus', start: 4, end: 8 }] });
  assert.ok(main.rmsDb > all.rmsDb);
});

test('tagged energy wins over the estimate', () => {
  assert.equal(energyOf({ energy: 7, energyEst: 3 }), 7);
  assert.equal(energyOf({ energyEst: 3 }), 3);
  assert.equal(energyOf({}), null);
});

test('shape labels: build, peak, breather, cool-down', () => {
  assert.deepEqual(shapeLabels([3, 4, 5, 6, 8, 8, 5, 7, 4]), [null, null, 'Build', 'Build', 'Peak', 'Peak', 'Breather', null, 'Cool-down']);
  assert.deepEqual(shapeLabels([5, 5]), [null, null]);
  assert.deepEqual(shapeLabels([4, null, 6, 7, 9]), [null, null, null, 'Build', 'Peak']);
});

test('setArc places tracks by time and warns about big jumps from the vibe', () => {
  const tr = (id, energy, duration = 300) => ({ track: { id, energy, duration } });
  const arc = setArc([tr('a', 3), tr('b', 9), tr('c', null), tr('d', 4, 600)], 'warmup');
  assert.equal(arc.length, 4);
  assert.ok(arc[0].x < arc[1].x && arc[2].x < arc[3].x);
  assert.ok(Math.abs(arc[3].x1 - 1) < 1e-9);
  assert.match(arc[1].warn, /Higher than the plan/);
  assert.equal(arc[2].energy, null);
  const svg = energyChartSVG(arc, { vibe: 'warmup' });
  assert.match(svg, /ec-target/);
  assert.match(svg, /unknown/);
  assert.match(svg, /not analysed yet/);
  assert.equal(energyChartSVG([]), '');
});
