import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeFrame, beatAdvice, tickSpacing } from '../js/beatvision.js';
import { readBmp } from './helpers/bmp.mjs';

/** Draw a rekordbox-like 2-deck waveform strip with known positions. */
function synth({ width = 1000, height = 160, playhead = 500, bar1 = 240, bar2 = 240, pos1 = 0, pos2 = 0 }) {
  const data = new Uint8ClampedArray(width * height * 4);
  const set = (x, y, [r, g, b]) => { if (x < 0 || x >= width) return; const o = (y * width + x) * 4; data[o] = r; data[o + 1] = g; data[o + 2] = b; data[o + 3] = 255; };
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) set(x, y, [0, 2, 1]);
  for (let y = 25; y < 135; y++) for (let x = 20; x < width - 20; x++) if ((x * 7 + y * 3) % 5 < 2) set(x, y, y < 80 ? [0, 82, 225] : [178, 101, 4]);
  // downbeat markers: deck 1 at y=18 (top), deck 2 at y=142 (bottom). pos = bar position (0..1) at the playhead
  for (const [y, bar, pos] of [[18, bar1, pos1], [142, bar2, pos2]]) {
    const first = playhead - pos * bar;
    for (let t = first - bar * 5; t < width; t += bar) for (let dx = -2; dx <= 2; dx++) for (let dy = -1; dy <= 1; dy++) set(Math.round(t) + dx, y + dy, [217, 17, 18]);
  }
  for (let y = 24; y < 137; y++) set(playhead, y, [79, 81, 82]); // playhead
  return { width, height, data };
}

test('reads the real rekordbox strip (from a screenshot)', () => {
  const r = analyzeFrame(readBmp(new URL('./fixtures/rekordbox-2deck-waveforms.bmp', import.meta.url)));
  assert.equal(r.ok, true, r.reason);
  assert.ok(Math.abs(r.playheadX - 582) <= 1.5, `playhead ${r.playheadX}`);
  assert.ok(Math.abs(r.decks[1].spacing - 272) < 2);
  assert.equal(r.decks[1].beatInBar, 4); // deck 1 is in the 4th beat
  assert.equal(r.decks[2].beatInBar, 1); // deck 2 sits just after its "1"
  assert.ok(Math.abs(Math.abs(r.phase) - 0.465) < 0.03, `phase ${r.phase}`); // about half a beat apart
  assert.ok(Math.abs(r.tempoRatio - 1) < 0.01);
});

test('synthetic: in phase, ahead, behind, bar offset, tempo', () => {
  const inPhase = analyzeFrame(synth({ pos1: 0.3, pos2: 0.3 }));
  assert.equal(inPhase.ok, true, inPhase.reason);
  assert.ok(Math.abs(inPhase.phase) < 0.01);
  assert.equal(inPhase.barOffset, 0);
  assert.equal(beatAdvice(inPhase, { next: 2, bpm: 128 }).phaseOk, true);

  // deck 2 a tenth of a beat further into its bar = ahead
  const ahead = analyzeFrame(synth({ pos1: 0.3, pos2: 0.3 + 0.1 / 4 }));
  assert.ok(Math.abs(ahead.phase - 0.1) < 0.01, `phase ${ahead.phase}`);
  const adv = beatAdvice(ahead, { next: 2, bpm: 120 });
  assert.match(adv.beats, /50 ms ahead/);
  // seen from deck 1 as the next deck, deck 1 is behind
  assert.match(beatAdvice(ahead, { next: 1, bpm: 120 }).beats, /behind/);

  // beats aligned but one beat apart in the bar
  const offBar = analyzeFrame(synth({ pos1: 0.3, pos2: 0.55 }));
  assert.ok(Math.abs(offBar.phase) < 0.01);
  assert.equal(Math.abs(offBar.barOffset), 1);

  // deck 2 faster: its beats are closer together on the time-based waveform
  const faster = analyzeFrame(synth({ bar2: 240 / 1.04 }));
  const fa = beatAdvice(faster, { next: 2 });
  assert.ok(Math.abs(fa.tempoPct - 4) < 0.3, `tempo ${fa.tempoPct}`);
  assert.match(fa.tempo, /faster/);
});

test('no rekordbox waveforms → clear reason', () => {
  const blank = { width: 400, height: 200, data: new Uint8ClampedArray(400 * 200 * 4) };
  assert.deepEqual(analyzeFrame(blank), { ok: false, reason: 'no-waveforms' });
  assert.equal(tickSpacing([10, 110, 310, 410]).spacing, 100); // a hidden tick at 210
});

test('reads a full-resolution (Retina) capture of the live rekordbox window', () => {
  const r = analyzeFrame(readBmp(new URL('./fixtures/rekordbox-2deck-waveforms-retina.bmp', import.meta.url)));
  assert.equal(r.ok, true, r.reason);
  assert.ok(Math.abs(r.playheadX - 1000.5) <= 1.5, `playhead ${r.playheadX}`); // 1150 in the window, minus the 150 px crop
  assert.ok(Math.abs(r.decks[1].bar - 0.175) < 0.02, `deck 1 ${r.decks[1].bar}`);
  assert.ok(r.decks[2].bar > 0.97 || r.decks[2].bar < 0.03, `deck 2 ${r.decks[2].bar}`); // right at a downbeat
});

test('synced decks: lined-up beat lines are not mistaken for the playhead', () => {
  const r = analyzeFrame(readBmp(new URL('./fixtures/rekordbox-2deck-synced-retina.bmp', import.meta.url)));
  assert.equal(r.ok, true, r.reason);
  assert.ok(Math.abs(r.playheadX - 1000) <= 1.5, `playhead ${r.playheadX}`);
  assert.ok(Math.abs(r.phase) < 0.03, `phase ${r.phase}`);
  assert.equal(r.decks[1].beatInBar, r.decks[2].beatInBar);
  assert.equal(r.barOffset, 0);
});
