import test from 'node:test';
import assert from 'node:assert/strict';
import { newRecorder, feed, scoreMix, gradeFor, addToHistory, progressStats, sparkSVG, PARTS } from '../js/mixreport.js';

const dt = 0.05;
/**
 * Simulate a crossfade from A to B over `seconds` with a beat offset and bass settings.
 * opts: { offsetMs, barOffset, phraseStart, bassSwap, bassTool, keyScore, bpm, back (crossfade back to A instead) }
 */
function simulate(seconds, opts = {}) {
  const { offsetMs = 5, barOffset = 0, phraseStart = 0, bassSwap = true, bassTool = true, keyScore = 1, bpm = 120, back = false } = opts;
  const rec = newRecorder(); let report = null;
  const step = (x, both = true, lowA = 0, lowB = -30) => {
    const s = {
      left: { gain: Math.cos(x * Math.PI / 2), playing: true, low: lowA, phrasePos: phraseStart },
      right: { gain: Math.sin(x * Math.PI / 2), playing: both, low: lowB, phrasePos: 0 },
      offsetMs: both ? offsetMs : null, barOffset, keyScore, bassTool, bpm,
    };
    return feed(rec, s, dt) || null;
  };
  for (let i = 0; i < 20; i++) step(0, false); // A alone
  const n = Math.round(seconds / dt);
  for (let i = 0; i <= n; i++) {
    const x = back ? Math.min(0.5, i / n) : i / n;
    const swapped = i > n / 2;
    report = step(x, true, bassSwap && swapped ? -30 : 0, bassSwap ? (swapped ? 0 : -30) : 0) || report;
  }
  for (let i = 0; i < 40; i++) report = step(back ? 0 : 1, true, -30, 0) || report; // hold, so the end is seen
  return report;
}

test('a long, locked blend with a bass swap on a phrase scores high', () => {
  const r = simulate(32);
  assert.ok(r, 'a report comes out');
  assert.ok(r.score >= 90, `score ${r.score}`);
  assert.equal(r.grade, 'Smooth as butter');
  assert.equal(r.from, 'left'); assert.equal(r.to, 'right');
  assert.ok(r.bars >= 13 && r.bars <= 16, `bars ${r.bars}`);
  assert.equal(r.tips.length, 0);
  assert.ok(r.praise);
});

test('drifting beats and both basses up are the top tips', () => {
  const r = simulate(32, { offsetMs: 80, bassSwap: false });
  assert.ok(r.score < 55, `score ${r.score}`);
  assert.deepEqual(r.tips.map((t) => t.id), ['beats', 'bass']);
  assert.equal(r.tips[0].lesson, 'nudge');
  assert.match(r.tips[1].text, /basses were up/);
});

test('starting mid-phrase and a short blend are called out', () => {
  const r = simulate(5, { phraseStart: 6 });
  const ids = r.tips.map((t) => t.id);
  assert.ok(ids.includes('phrase') || ids.includes('length'), ids.join());
  assert.ok(r.parts.find((p) => p.id === 'phrase').score <= 55);
  assert.ok(r.parts.find((p) => p.id === 'length').score <= 55);
});

test('no bass dial (Starter): bass is not scored, but the next skill is mentioned', () => {
  const r = simulate(32, { bassSwap: false, bassTool: false });
  assert.ok(!r.parts.some((p) => p.id === 'bass'));
  assert.ok(r.score >= 85, `score ${r.score}`);
  assert.match(r.notes[0], /bass swap/);
});

test('backing out of a mix, or a quick flick, makes no report', () => {
  assert.equal(simulate(20, { back: true }), null);
  assert.equal(simulate(1), null);
});

test('grades', () => {
  assert.equal(gradeFor(95), 'Smooth as butter');
  assert.equal(gradeFor(80), 'Clean mix');
  assert.equal(gradeFor(60), 'Getting there');
  assert.equal(gradeFor(10), 'A rough one');
  assert.ok(Object.values(PARTS).every((p) => p.lesson));
});

test('scoreMix with nothing timed does not crash', () => {
  const r = scoreMix({ t: 10, bpm: 120, timed: 0, aligned: 0, wreck: 0, ones: 0, clash: 0, dip: 0, keyScore: 0.5, bassTool: false, startPhrase: null, from: 'left', to: 'right' });
  assert.ok(Number.isFinite(r.score));
});

test('progress: count, recent average, best, trend and a day streak', () => {
  const day = 86400000, now = new Date(2026, 10, 21, 18).getTime();
  let h = [];
  const scores = [40, 50, 55, 60, 62, 70, 75, 80, 82, 90];
  scores.forEach((s, i) => { h = addToHistory(h, { score: s, bars: 16 }, now - (9 - i) * day / 3); });
  const p = progressStats(h, now);
  assert.equal(p.count, 10);
  assert.equal(p.best, 90);
  assert.equal(p.recent, 79);
  assert.ok(p.trend > 0);
  assert.equal(p.streak, 4);
  assert.equal(progressStats([], now).count, 0);
  assert.equal(progressStats([{ at: now - 3 * day, score: 50 }], now).streak, 0);
  assert.match(sparkSVG(p.last), /<polyline/);
  assert.equal(sparkSVG([50]), '');
});

test('history keeps the last 100', () => {
  let h = [];
  for (let i = 0; i < 120; i++) h = addToHistory(h, { score: i % 100, bars: 8 }, i);
  assert.equal(h.length, 100);
  assert.equal(h[0].at, 20);
});

test('per-skill progress: weakest skill first, with a lesson to practise', async () => {
  const { skillStats, levelAdvice } = await import('../js/mixreport.js');
  let h = [];
  for (let i = 0; i < 6; i++) h = addToHistory(h, { score: 60, bars: 16, parts: [{ id: 'beats', score: 90 }, { id: 'bass', score: 30 + i * 5 }] }, i);
  const s = skillStats(h);
  assert.deepEqual(s.map((x) => x.id), ['bass', 'beats']);
  assert.equal(s[0].lesson, 'bass-swap');
  assert.equal(s[1].avg, 90);
  assert.deepEqual(skillStats([{ score: 50 }]), [], 'old entries without parts are skipped');
  const low = Array.from({ length: 5 }, () => ({ score: 30 }));
  assert.deepEqual(levelAdvice(low, 'confident'), { dir: 'down', to: 'improver' });
  assert.equal(levelAdvice(low, 'starter'), null);
  assert.equal(levelAdvice(low.slice(0, 4), 'pro'), null);
  assert.equal(levelAdvice(Array.from({ length: 5 }, () => ({ score: 70 })), 'pro'), null);
});

test('track choice scores the key and the energy step together', async () => {
  const { energyFit } = await import('../js/mixreport.js');
  assert.equal(energyFit(1), 100); assert.equal(energyFit(-1), 75); assert.equal(energyFit(5), 35); assert.equal(energyFit(null), null);
  const base = { t: 30, bpm: 120, timed: 30, aligned: 30, wreck: 0, ones: 30, clash: 0, dip: 0, keyScore: 1, bassTool: true, startPhrase: 0, from: 'left', to: 'right' };
  const good = scoreMix({ ...base, energyStep: 1 }), drop = scoreMix({ ...base, energyStep: -4 });
  const part = (r) => r.parts.find((p) => p.id === 'key');
  assert.equal(part(good).score, 100); assert.ok(part(drop).score < 70);
  assert.equal(part(good).name, 'Track choice');
  assert.ok(drop.tips.some((t) => /energy dropped/.test(t.text)));
  assert.equal(part(scoreMix({ ...base })).score, 100, 'no energy data: the key alone');
});

test('a song started on the phrase with its volume down and faded in slowly still counts as on the phrase', () => {
  // A plays alone; B starts silently on bar 0 of its phrase with A on bar 0 of its own, then fades up over 8 bars
  const rec = newRecorder(); let report = null;
  const bpm = 120, bar = 2; // seconds per bar
  let t = 0;
  const frame = (gainB, playingB) => {
    const posA = ((((t - 10) / bar) % 16) + 16) % 16, posB = playingB ? ((t - 10) / bar) % 16 : 0; // t = 10: bar 1 of A's phrase
    const s = {
      left: { gain: playingB && gainB > 0.9 ? Math.max(0, 1 - (t - 30) / 6) : 1, playing: true, low: gainB > 0.6 ? -30 : 0, phrasePos: posA },
      right: { gain: gainB, playing: playingB, low: gainB > 0.6 ? 0 : -30, phrasePos: posB },
      offsetMs: playingB ? 3 : null, barOffset: 0, keyScore: 1, bassTool: true, bpm,
    };
    t += dt;
    return feed(rec, s, dt) || null;
  };
  while (t < 10) frame(0, false);                                    // A alone, B waiting on its first beat
  while (t < 26) frame(Math.min(1, (t - 10) / 16), true);           // B starts on A's phrase, fades in over 8 bars
  while (t < 40) report = frame(1, true) || report;                  // A fades out
  for (let i = 0; i < 40; i++) report = frame(1, true) || report;
  assert.ok(report, 'a report comes out');
  const phrase = report.parts.find((p) => p.id === 'phrase');
  assert.equal(phrase.score, 100, JSON.stringify(report.parts));
  assert.ok(!report.tips.some((x) => x.id === 'phrase'));
});
