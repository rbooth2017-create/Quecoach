import test from 'node:test';
import assert from 'node:assert/strict';
import { planMix, mixCue, partInfo, PART_INFO, mixControls, mixSteps, prepSteps, shiftPlan, stepState } from '../js/mixplan.js';
import { featuresFor } from '../js/levels.js';
import { demoLibrary } from '../js/library.js';

const [A, B] = demoLibrary(2); // Intro 32 · Build 16 · Drop 32 · Breakdown 16 · Drop 32 · Outro 32 bars

test('every song part is explained in plain words', () => {
  for (const k of ['Intro', 'Up', 'Chorus', 'Down', 'Outro']) {
    const p = PART_INFO[k];
    assert.ok(p.name && p.what && p.mix, k);
  }
  assert.equal(partInfo('Up').name, 'Build');
  assert.equal(partInfo('Chorus').name, 'Drop');
  assert.equal(partInfo('Verse2').name, 'Verse');
  assert.equal(partInfo('').what, '');
});

// The cue and step tests below use a 32-bar blend from A's outro: start 129, swap 145, end 161.
const plan32 = shiftPlan(planMix(A, B), 129);

test('a dance mix plays B\'s whole intro and build under A, so B\'s drop lands as A ends', () => {
  const plan = planMix(A, B);
  assert.equal(plan.aOutroStart, 129); // 32+16+32+16+32 bars, then the outro
  assert.equal(plan.bIntroBars, 32);
  assert.equal(plan.blendBars, 48); // B's 32-bar intro + 16-bar build, not a quick 32
  assert.equal(plan.startBar, 113); // a phrase before A's outro, so it all fits
  assert.equal(plan.swapBar, 137); // halfway, on a 4-bar line
  assert.equal(plan.endBar, 161); // A's last bar
  assert.equal(plan.bDropAtBarA, 161); // B's drop lands as A ends
  assert.ok(Math.abs(plan.bStart - B.grid.firstDownbeat) < 1e-9);
  assert.match(plan.why, /drop lands as A ends/);
});

test('B\'s intro that fits inside A\'s outro starts on the outro', () => {
  // B with a 16-bar intro and no build: a 16-bar blend from A's outro
  const bb = 240 / B.grid.bpm, d = B.grid.firstDownbeat;
  const short = { ...B, phrases: [{ label: 'Intro', start: d, end: d + 16 * bb }, ...B.phrases.slice(2).map((p) => ({ ...p, start: p.start - 32 * bb, end: p.end - 32 * bb }))] };
  const plan = planMix(A, short);
  assert.equal(plan.startBar, 129); assert.equal(plan.blendBars, 16); assert.equal(plan.swapBar, 137);
  assert.match(plan.why, /fits inside/);
});

test('a long intro starts B earlier, by whole phrases', () => {
  // B with a 64-bar intro: needs to start 32 bars before A's outro
  const longIntro = { ...B, phrases: B.phrases.map((p, i) => (i === 0 ? { ...p, end: p.end + 32 * 240 / B.bpm } : p)).filter((p) => p.label !== 'Up').map((p) => (p.label === 'Chorus' && p === B.phrases[2] ? { ...p, start: B.grid.firstDownbeat + 64 * 240 / B.bpm } : p)) };
  const plan = planMix(A, longIntro);
  assert.equal(plan.bIntroBars, 64);
  assert.equal(plan.startBar, 129 - 32);
  assert.match(plan.why, /starts 32 bars earlier/);
  assert.equal(planMix(A, { ...B, grid: null }), null);
});

test('a short outro and a short intro still get a long blend', () => {
  const bar = 240 / A.grid.bpm;
  // A's last 8 bars are the outro (the rest of its outro counts as drop); B has an 8-bar intro then an 8-bar build
  const shortOutro = { ...A, phrases: A.phrases.map((p) => (p.label === 'Outro' ? { ...p, start: p.start + 24 * bar } : p)) };
  const bb = 240 / B.grid.bpm, d = B.grid.firstDownbeat;
  const shortIntro = { ...B, phrases: [{ label: 'Intro', start: d, end: d + 8 * bb }, { label: 'Up', start: d + 8 * bb, end: d + 16 * bb }, ...B.phrases.slice(2).map((p) => ({ ...p, start: p.start - 32 * bb, end: p.end - 32 * bb }))] };
  const plan = planMix(shortOutro, shortIntro);
  assert.equal(plan.aOutroBars, 9); // 8 bars plus the last part-bar
  assert.equal(plan.bIntroBars, 8);
  assert.equal(plan.blendBars, 16); // B's intro + build, not a quick 8-bar fade
  assert.equal(plan.startBar, 153 - 16); // a phrase before A's outro so the blend fits
  assert.equal(plan.endBar, 153);
  assert.match(plan.why, /16-bar blend/);
});

test('cues count down to the mix point, then guide the blend', () => {
  const plan = plan32;
  assert.equal(mixCue(plan, 100, false).phase, 'prep');
  assert.match(mixCue(plan, 100, false).title, /Mix point in 29 bars/);
  assert.equal(mixCue(plan, 121, false).title, 'Start deck B in 8 bars');
  const c = mixCue(plan, 128.25, false); // three beats to go
  assert.equal(c.phase, 'count'); assert.equal(c.big, '3'); assert.equal(c.unit, 'beats');
  assert.equal(mixCue(plan, 129.1, false).phase, 'go');
  assert.equal(mixCue(plan, 133, true).title, 'Blending: bar 5 of 32');
  assert.match(mixCue(plan, 133, true).detail, /Swap the bass in 12 bars/);
  assert.equal(mixCue(plan, 170, true).phase, 'done');
  assert.equal(mixCue(plan, 110, true).phase, 'early');
  const late = mixCue(plan, 131, false);
  assert.equal(late.phase, 'late'); assert.match(late.detail, /bar 145/);
});

// ---------- the step-by-step transition guide ----------
const plan = plan32; // start 129, swap 145, end 161
const ctl = (level, controller = false) => mixControls(featuresFor(level), controller);
const ids = (steps) => steps.map((s) => s.id);
const at = (steps) => Object.fromEntries(steps.map((s) => [s.id, s.bar]));

test('the guide only asks for moves the DJ has controls for', () => {
  assert.deepEqual(ctl('starter'), { volume: false, low: false, mid: false, high: false });
  assert.deepEqual(ctl('improver'), { volume: true, low: true, mid: false, high: false });
  assert.deepEqual(ctl('confident'), { volume: true, low: true, mid: false, high: true });
  assert.deepEqual(ctl('starter', true), { volume: true, low: true, mid: true, high: true }); // a controller has it all
});

test('steps per level, timed in A\'s bars', () => {
  const s = mixSteps(plan, ctl('starter'));
  assert.deepEqual(ids(s), ['ready', 'start', 'fade', 'out']);
  assert.deepEqual(at(s), { ready: 113, start: 129, fade: 129, out: 145 });
  assert.equal(s.find((x) => x.id === 'fade').by, 145);
  assert.equal(s.find((x) => x.id === 'out').by, 161);
  assert.match(s.find((x) => x.id === 'fade').title, /crossfader to the middle by bar 145/);
  assert.doesNotMatch(s[0].detail, /bass/);
  const imp = mixSteps(plan, ctl('improver'));
  assert.deepEqual(ids(imp), ['ready', 'start', 'fade', 'swap', 'out']);
  assert.equal(at(imp).swap, 145);
  assert.match(imp[0].detail, /bass all the way down/);
  assert.match(imp.find((x) => x.id === 'fade').title, /volume: all the way up by bar 145/);
  assert.deepEqual(ids(mixSteps(plan, ctl('confident'))), ['ready', 'start', 'fade', 'highs', 'swap', 'out']);
  assert.equal(at(mixSteps(plan, ctl('confident'))).highs, 137);
  const full = mixSteps(plan, ctl('starter', true), { a: 'B', b: 'A' }); // mixing back the other way
  assert.equal(at(full).mids, 141);
  assert.match(full.find((x) => x.id === 'out').title, /Lower B's volume/);
  assert.deepEqual(mixSteps(null, {}), []);
});

test('Starter and Improver get one move per step: pick, load, match, cue, levels, then the swaps', () => {
  const s = mixSteps(plan, ctl('starter'), undefined, true);
  assert.deepEqual(ids(s), ['pick', 'load', 'match', 'cue', 'levels', 'start', 'fade', 'out']);
  assert.match(s.find((x) => x.id === 'levels').detail, /crossfader all the way over on A/);
  const imp = mixSteps(plan, ctl('improver'), undefined, true);
  assert.deepEqual(ids(imp), ['pick', 'load', 'match', 'cue', 'levels', 'start', 'fade', 'swap', 'out']);
  assert.match(imp.find((x) => x.id === 'levels').detail, /bass all the way down.*volume all the way down/);
  const pad = mixSteps(plan, ctl('improver', true), undefined, true); // a controller adds highs and mids
  assert.deepEqual(ids(pad).slice(5), ['start', 'fade', 'highs', 'mids', 'swap', 'out']);
  assert.match(pad.find((x) => x.id === 'mids').title, /Swap the mids/);
  assert.equal(prepSteps(ctl('starter'), { a: 'B', b: 'A' })[1].title, 'Load it onto deck A');
});

test('the detailed steps tick off one at a time', () => {
  const c = ctl('improver'), steps = mixSteps(plan, c, undefined, true);
  const base = { bLoaded: true, bMatched: false, bCued: false, bPlaying: false, aPlaying: true, xf: 0.5, volA: 1, volB: 1, eqA: { low: 0 }, eqB: { low: 0 } };
  let g = stepState(steps, plan, 115, base, c);
  assert.deepEqual(g.doneIds, ['pick', 'load']);
  assert.equal(g.current.id, 'match');
  g = stepState(steps, plan, 116, { ...base, bMatched: true, bCued: true }, c, new Set(g.doneIds));
  assert.equal(g.current.id, 'levels');
  g = stepState(steps, plan, 117, { ...base, bMatched: true, bCued: true, volB: 0, eqB: { low: -30 } }, c, new Set(g.doneIds));
  assert.equal(g.current.id, 'start'); // all ready: start is up next, even before the bar
  // the mids swap needs A's mids down too
  const cc = ctl('improver', true), st = mixSteps(plan, cc, undefined, true), prep = ['pick', 'load', 'match', 'cue', 'levels', 'start'];
  const blend = { bPlaying: true, aPlaying: true, volA: 1, volB: 1, eqA: { low: 0, mid: 0 }, eqB: { low: -30, mid: 0, high: 0 } };
  assert.ok(!stepState(st, plan, 143, blend, cc, new Set(prep)).doneIds.includes('mids'));
  assert.ok(stepState(st, plan, 143, { ...blend, eqA: { low: 0, mid: -15 } }, cc, new Set(prep)).doneIds.includes('mids'));
});

test('a late start moves the steps with it, and squeezes the blend near the end', () => {
  const late = shiftPlan(plan, 137.1);
  assert.equal(late.startBar, 137); assert.equal(late.blendBars, 24); assert.equal(late.swapBar, 149); assert.equal(late.endBar, 161); // A ends at bar 160
  const veryLate = shiftPlan(plan, 155);
  assert.equal(veryLate.blendBars, 4); // A has 6 bars left
  assert.equal(veryLate.endBar, 159);
  assert.equal(shiftPlan(plan, 129), plan);
});

test('steps tick off from the controls, with a countdown to the next one', () => {
  const c = ctl('improver'), steps = mixSteps(plan, c);
  const ready = { bReady: true, bPlaying: false, aPlaying: true, xf: 0.5, volA: 1, volB: 0, eqA: { low: 0 }, eqB: { low: -30 } };
  let g = stepState(steps, plan, 120, { ...ready, eqB: { low: 0 } }, c);
  assert.equal(g.current.id, 'ready'); // bass not cut yet
  g = stepState(steps, plan, 120, ready, c);
  assert.deepEqual(g.doneIds, ['ready']);
  assert.equal(g.current.id, 'start'); assert.equal(g.toDeadline, 9);
  // B started on time, volume a quarter up 4 bars in
  const blend = { ...ready, bReady: false, bPlaying: true, volB: 0.25 };
  g = stepState(steps, plan, 133, blend, c, new Set(['ready']));
  assert.equal(g.current.id, 'fade'); assert.equal(g.next.id, 'swap'); assert.equal(g.toNext, 12);
  assert.equal(g.note, null);
  assert.deepEqual(g.items.map((i) => i.status), ['done', 'done', 'now', 'todo', 'todo']);
  // the swap, then A out
  g = stepState(steps, plan, 146, { ...blend, volB: 1, eqA: { low: -30 }, eqB: { low: 0 } }, c, new Set(g.doneIds));
  assert.equal(g.current.id, 'out');
  assert.ok(g.doneIds.includes('swap'));
  g = stepState(steps, plan, 160, { ...blend, volB: 1, volA: 0, eqA: { low: -30 }, eqB: { low: 0 } }, c, new Set(g.doneIds));
  assert.equal(g.current, null);
  // ticks stay: a dial nudged back doesn't untick the swap
  g = stepState(steps, plan, 150, { ...blend, volB: 1, eqA: { low: 0 }, eqB: { low: 0 } }, c, new Set(['ready', 'start', 'fade', 'swap']));
  assert.equal(g.items.find((i) => i.id === 'swap').status, 'done');
  // skipping the get-ready step shows it as missed
  g = stepState(steps, plan, 131, { ...blend, eqB: { low: -30 } }, c);
  assert.equal(g.items[0].status, 'missed');
});

test('early and late moves get a gentle note', () => {
  const c = ctl('improver'), steps = mixSteps(plan, c);
  const blend = { bPlaying: true, aPlaying: true, xf: 0.5, volA: 1, volB: 0.3, eqA: { low: 0 }, eqB: { low: -30 } };
  const note = (bar, snap) => stepState(steps, plan, bar, { ...blend, ...snap }, c, new Set(['ready', 'start'])).note;
  assert.match(note(135, { eqB: { low: 0 } }).text, /two basslines.*until bar 145/);
  assert.equal(note(135, { eqB: { low: 0 } }).tone, 'early');
  assert.match(note(149, { volB: 1 }).text, /Swap the bass now/);
  assert.equal(note(133, { volB: 1 }).tone, 'early'); // full volume 4 bars in
  const behind = note(141, { volB: 0.1 }); // should be about three quarters up
  assert.equal(behind.tone, 'late'); assert.match(behind.text, /volume should be about three quarters up/);
  assert.match(note(140, { volB: 0.8, volA: 0 }).text, /went out early/);
  // starter: crossfader only
  const s = ctl('starter'), st = mixSteps(plan, s);
  const xf = (bar, x) => stepState(st, plan, bar, { bPlaying: true, aPlaying: true, xf: x }, s, new Set(['ready', 'start'])).note;
  assert.equal(xf(137, 0.25), null); // a quarter of the way at the quarter mark: on track
  assert.match(xf(141, 0.05).text, /crossfader should be about three quarters to the middle/);
  assert.match(xf(165, 0.6).text, /should be gone by now/);
});

test('during the blend the cue follows the steps', () => {
  const c = ctl('improver'), steps = mixSteps(plan, c);
  const g = stepState(steps, plan, 133, { bPlaying: true, aPlaying: true, xf: 0.5, volA: 1, volB: 0.25, eqA: { low: 0 }, eqB: { low: -30 } }, c, new Set(['ready', 'start']));
  const cue = mixCue(plan, 133, true, 16, g);
  assert.equal(cue.phase, 'blend'); assert.equal(cue.big, '12'); assert.equal(cue.step, 'Step 3 of 5');
  assert.match(cue.title, /Raise B's volume/);
  assert.equal(cue.nextText, 'Next: swap bass in 12 bars.');
  const done = stepState(steps, plan, 162, { bPlaying: true, aPlaying: false }, c, new Set(['ready', 'start', 'fade', 'swap']));
  assert.equal(mixCue(plan, 162, true, 16, done).phase, 'done');
});

test('no notes once every step is done', () => {
  const c = ctl('improver'), steps = mixSteps(plan, c);
  const g = stepState(steps, plan, 150, { bPlaying: true, aPlaying: true, volA: 0, volB: 1, eqA: { low: -30 }, eqB: { low: 0 } }, c, new Set(steps.map((s) => s.id)));
  assert.equal(g.current, null); assert.equal(g.note, null);
});

test('ahead of the plan, the cue counts down to the next step instead of saying done', () => {
  const c = ctl('improver'), steps = mixSteps(plan, c);
  const g = stepState(steps, plan, 135, { bPlaying: true, aPlaying: true, volA: 1, volB: 1, eqA: { low: 0 }, eqB: { low: -30 } }, c, new Set(['ready', 'start']));
  const cue = mixCue(plan, 135, true, 16, g);
  assert.notEqual(cue.phase, 'done');
  assert.match(cue.title, /^Next: Swap the bass on bar 145/);
  assert.equal(cue.big, '10');
});
