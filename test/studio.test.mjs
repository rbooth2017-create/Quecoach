import test from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../js/studiomodel.js';
import { renderBar, renderFx, SR } from '../js/studiosynth.js';
import { analyseGrid, GRID_VERSION } from '../js/beatgrid.js';

test('keys and degrees', () => {
  assert.deepEqual(S.parseKey('F#m'), { pc: 6, minor: true });
  assert.deepEqual(S.parseKey('Bb'), { pc: 10, minor: false });
  assert.deepEqual(S.parseKey('nonsense'), { pc: 9, minor: true });
  const base = S.registerBase('Am', 'bass');
  assert.equal(base, 33); // A1
  assert.equal(S.degreeToMidi(2, 'Am', base), 36); // C
  assert.equal(S.degreeToMidi(-1, 'Am', base), 31); // G below
  assert.equal(S.degreeToMidi(7, 'Am', base), 45);
  for (const k of S.KEYS) { const b = S.registerBase(k, 'bass'); assert.ok(b >= 33 && b < 45, k); }
});

test('a new project is laid out the mixable way', () => {
  const p = S.newProject({ style: 'house', key: 'Cm' });
  assert.equal(p.bpm, 124);
  assert.equal(p.sections[0].kind, 'intro');
  assert.equal(p.sections.at(-1).kind, 'outro');
  const checks = S.mixCheck(p);
  assert.ok(checks.every((c) => c.ok === true), JSON.stringify(checks.filter((c) => c.ok !== true)));
  assert.equal(S.totalBars(p), 168);
  for (const s of p.sections) for (const ref of Object.values(p.cells[s.id])) assert.ok(S.resolve(p, ref), ref);
});

test('mix check flags what makes a track hard to mix', () => {
  const p = S.newProject();
  S.setCell(p, p.sections[0].id, 'drums', null);
  S.setCell(p, p.sections[0].id, 'perc', null);
  S.setCell(p, p.sections[0].id, 'vocals', 'b:lead.arp');
  S.resizeSection(p, p.sections[0].id, 8);
  S.removeSection(p, p.sections.at(-1).id);
  const c = Object.fromEntries(S.mixCheck(p).map((x) => [x.id, x.ok]));
  assert.equal(c.intro, false);
  assert.equal(c.outro, false);
  assert.equal(c.beats, false);
  assert.equal(c.clean, 'warn');
});

test('sections stay whole phrases', () => {
  assert.equal(S.snapBars(13), 16);
  assert.equal(S.snapBars(3), 8);
  assert.equal(S.snapBars(200), 64);
  const p = S.newProject();
  const first = p.sections[0];
  const t = S.splitSection(p, first.id);
  assert.equal(first.bars + t.bars, 32);
  assert.deepEqual(p.cells[t.id], p.cells[first.id]);
  assert.equal(S.slotAt(p, 17).section.id, t.id);
  assert.equal(S.slotAt(p, 17).barIn, 1);
  assert.equal(S.slotAt(p, 9999), null);
});

test('library info carries an exact grid and phrases', () => {
  const p = S.newProject({ bpm: 120 });
  const info = S.libraryInfo(p);
  assert.equal(info.grid.bpm, 120);
  assert.equal(info.grid.firstDownbeat, 0);
  assert.equal(info.grid.v, GRID_VERSION);
  assert.equal(info.phrases[0].label, 'Intro');
  assert.equal(info.phrases[0].end, 32 * 2);
  assert.equal(info.phrases.at(-1).label, 'Outro');
  assert.equal(info.phrases.at(-1).end, info.duration);
  assert.ok(info.phrases.some((x) => x.label === 'Chorus'));
});

test('editing a built-in loop copies it into the track', () => {
  const p = S.newProject();
  const ref = p.cells[p.sections[2].id].drums;
  const mine = S.ownPattern(p, ref);
  assert.match(mine, /^p:/);
  assert.ok(Object.values(p.cells).every((c) => c.drums !== ref));
  const pat = S.resolve(p, mine);
  S.toggleStep(p.patterns[mine.slice(2)], 'kick', 1);
  assert.equal(p.patterns[mine.slice(2)].steps.kick[1], 'x');
  assert.equal(S.BUILTINS['drums.house'].steps.kick[1], '-'); // the built-in is untouched
  assert.ok(pat);
});

test('samples: lane, tempo and key from the name and length', () => {
  assert.equal(S.guessLane('Female_Vocal_Chop_01.wav'), 'vocals');
  assert.equal(S.guessLane('deep-bass-loop.wav'), 'bass');
  assert.equal(S.guessLane('Top Loop 124.wav'), 'drums');
  assert.equal(S.bpmFromName('Deep_Bass_124bpm_Am.wav'), 124);
  assert.equal(S.bpmFromName('loop 128 BPM.wav'), 128);
  assert.equal(S.bpmFromName('take 3.wav'), null);
  assert.equal(S.keyFromName('Pad_F#min_120.wav'), 'F#m');
  assert.equal(S.keyFromName('Bass_124bpm_Am.wav'), 'Am');
  assert.equal(S.keyFromName('A drum loop.wav'), null);
  // a 4-bar loop at 124 BPM with no tempo in its name
  assert.deepEqual(S.loopInfo({ name: 'groove.wav', duration: 4 * 240 / 124 }, 124), { bpm: 124, bars: 4, mode: 'loop' });
  assert.deepEqual(S.loopInfo({ name: 'groove_120bpm.wav', duration: 2 * 2 }, 124), { bpm: 120, bars: 2, mode: 'loop' });
  assert.equal(S.loopInfo({ name: 'hit.wav', duration: 0.4 }, 124).mode, 'once');
  assert.ok(Math.abs(S.sampleRate({ mode: 'loop', bpm: 120 }, 126) - 1.05) < 1e-9);
});

test('surprise tracks are repeatable, playable and mixable', () => {
  const a = S.surpriseProject(42, { style: 'techno' }), b = S.surpriseProject(42, { style: 'techno' });
  assert.equal(a.title, b.title);
  assert.equal(a.key, b.key);
  assert.ok(S.mixCheck(a).every((c) => c.ok === true));
  for (const s of a.sections) for (const ref of Object.values(a.cells[s.id])) assert.ok(S.resolve(a, ref), ref);
});

test('AI answers are checked before use', () => {
  const p = S.projectFromAI({
    title: 'Test', about: 'x', bpm: 400, key: 'Dm', progression: [0, 12, -1],
    sections: [
      { kind: 'intro', bars: 30, lanes: { drums: 'd1', perc: '', bass: '', chords: '', lead: '', vocals: '', fx: '' } },
      { kind: 'drop', bars: 32, lanes: { drums: 'd1', perc: 'perc.shaker', bass: 'b1', chords: 'chords.pad', lead: 'nope', vocals: 's:v1', fx: 'drums.house' } },
      { kind: 'nonsense', bars: 8, lanes: {} },
      { kind: 'outro', bars: 16, lanes: { drums: 'd1', perc: '', bass: '', chords: '', lead: '', vocals: '', fx: '' } },
    ],
    patterns: [
      { id: 'd1', name: 'Beat', type: 'drums', bars: 1, tone: 'sub', follow: false, kick: 'x---x---x---x---', clap: '', hat: 'q-o', open: '', perc: '', notes: [], hits: '' },
      { id: 'b1', name: 'Bass', type: 'bass', bars: 3, tone: 'bell', follow: true, kick: '', clap: '', hat: '', open: '', perc: '', notes: [[0, 0, 2], [99, 0, 1], [4, 'a', 1]], hits: '' },
      { id: 'empty', name: 'Nothing', type: 'lead', bars: 1, tone: 'saw', follow: false, kick: '', clap: '', hat: '', open: '', perc: '', notes: [], hits: '' },
    ],
  }, { samples: { v1: { name: 'Vox', lane: 'vocals' } } });
  assert.equal(p.bpm, 180);
  assert.equal(p.key, 'Dm');
  assert.deepEqual(p.prog, [0, 5, 6]);
  assert.deepEqual(p.sections.map((s) => [s.kind, s.bars]), [['intro', 32], ['drop', 32], ['outro', 16]]);
  const drop = p.cells[p.sections[1].id];
  assert.match(drop.drums, /^p:/);
  assert.equal(drop.perc, 'b:perc.shaker');
  assert.equal(drop.lead, undefined);
  assert.equal(drop.vocals, 's:v1');
  assert.equal(drop.fx, undefined); // a drum loop isn't allowed in the FX lane
  const bass = S.resolve(p, drop.bass);
  assert.equal(bass.bars, 1);
  assert.equal(bass.tone, 'sub');
  assert.deepEqual(bass.notes, [[0, 0, 2]]);
  assert.equal(S.resolve(p, drop.drums).steps.hat, '--o-------------');
  assert.ok(S.aiSchema().properties.sections);
});

test('synths make sound where the pattern says', () => {
  const bar = renderBar(S.BUILTINS['drums.kick'], { bpm: 120, key: 'Am' });
  const beat = 0.5 * SR;
  const energy = (from, len) => { let e = 0; for (let i = from; i < from + len; i++) e += bar[i] * bar[i]; return e; };
  assert.ok(energy(0, 2000) > 10 * energy(beat - 2500, 2000)); // a kick on the beat, quiet just before the next
  for (const id of Object.keys(S.BUILTINS)) {
    const b = S.BUILTINS[id];
    const x = b.type === 'fx' ? renderFx(b.fx, 4) : renderBar(b, { bpm: 124, key: 'Em', chord: 5, pump: true });
    let peak = 0; for (const v of x) { assert.ok(Number.isFinite(v), id); peak = Math.max(peak, Math.abs(v)); }
    assert.ok(peak > 0.02 && peak < 2, `${id} peak ${peak}`);
  }
});

test('a rendered track is found at its own tempo by the beat grid analyser', () => {
  const bpm = 126, bars = 24, bl = 240 / bpm;
  const x = new Float32Array(Math.ceil(bars * bl * SR) + SR);
  const pats = [S.BUILTINS['drums.house'], S.BUILTINS['bass.offbeat']];
  for (let b = 0; b < bars; b++) for (const pat of pats) {
    const y = renderBar(pat, { bpm, key: 'Am', chord: [0, 5, 6, 4][b % 4], barIn: b });
    const o = Math.round(b * bl * SR);
    for (let i = 0; i < y.length && o + i < x.length; i++) x[o + i] += y[i];
  }
  const g = analyseGrid(x, SR);
  assert.ok(Math.abs(g.bpm - bpm) < 0.05, `bpm ${g.bpm}`);
  const off = ((g.firstDownbeat % (60 / bpm)) + 60 / bpm) % (60 / bpm);
  assert.ok(Math.min(off, 60 / bpm - off) < 0.02, `first beat ${g.firstDownbeat}`);
});

test('WAV encoding', () => {
  const buf = S.encodeWav([new Float32Array([0, 1, -1]), new Float32Array([0.5, 0, 0])], 44100);
  const v = new DataView(buf);
  assert.equal(buf.byteLength, 44 + 12);
  assert.equal(String.fromCharCode(v.getUint8(0), v.getUint8(1), v.getUint8(2), v.getUint8(3)), 'RIFF');
  assert.equal(v.getUint16(22, true), 2);
  assert.equal(v.getInt16(44 + 4, true), 0x7fff);
  assert.equal(v.getInt16(44 + 8, true), -0x8000);
});

test('pattern text: every built-in loop survives a round trip', () => {
  for (const [id, b] of Object.entries(S.BUILTINS)) {
    if (b.type === 'fx') continue;
    const r = S.parsePatternText(S.patternToText(b), { lane: b.lane, name: b.name });
    assert.ok(r.pattern, `${id}: ${r.error}`);
    const { kind, ...want } = { ...b, kind: 0 };
    for (const k of ['type', 'bars', 'tone', 'steps', 'notes', 'hits', 'swing', 'lane']) {
      if (want[k] === undefined) continue;
      const w = k === 'steps' ? Object.fromEntries(Object.entries(want.steps).filter(([, v]) => /[xo]/.test(v))) : want[k];
      assert.deepEqual(r.pattern[k], w, `${id}.${k}`);
    }
    assert.equal(!!r.pattern.follow, !!b.follow, `${id}.follow`);
  }
});

test('pattern text: reading what people (and the AI) write', () => {
  const d = S.parsePatternText('drums swing=0.15\nbd x... x... x... x...\nsd .... x... .... x...\nhh ..x. # offbeat\n', { lane: 'perc' });
  assert.ok(d.error); // the hat row is too short
  const ok = S.parsePatternText('drums swing=0.15\nbd x... x... x... x...\ncp .... x... .... x... | .... x... .... xxxx', { lane: 'perc' }).pattern;
  assert.equal(ok.bars, 2);
  assert.equal(ok.lane, 'perc');
  assert.equal(ok.swing, 0.15);
  assert.equal(ok.steps.kick, 'x---x---x---x---'.repeat(2)); // a shorter row repeats
  const b = S.parsePatternText('bass reese follow\nnotes 0 _ _ . 7 . -2 _ . . 3 . . . 0 _').pattern;
  assert.deepEqual(b.notes, [[0, 0, 3], [4, 7, 1], [6, -2, 2], [10, 3, 1], [14, 0, 2]]);
  assert.equal(b.tone, 'reese');
  assert.equal(b.follow, true);
  assert.match(S.parsePatternText('bass\nnotes 0 x . .').error, /"x" isn't a note/);
  assert.match(S.parsePatternText('piano\nnotes 0').error, /drums, bass, lead or chords/);
  assert.match(S.parsePatternText('drums\ncowbell x...').error, /isn't a drum/);
  assert.equal(S.parsePatternText('chords pad').pattern.hits, 'x');
});

test('AI tracks written as pattern text', () => {
  const lanes = (o) => ({ drums: '', perc: '', bass: '', chords: '', lead: '', vocals: '', fx: '', ...o });
  const p = S.projectFromAI({
    title: 'T', about: '', bpm: 126, key: 'Am', progression: [0],
    sections: [{ kind: 'intro', bars: 16, lanes: lanes({ drums: 'd' }) }, { kind: 'drop', bars: 16, lanes: lanes({ drums: 'd', bass: 'b', perc: 'bad' }) }],
    patterns: [
      { id: 'd', name: 'Beat', lane: 'drums', text: 'drums\nkick x... x... x... x...' },
      { id: 'b', name: 'Bass', lane: 'bass', text: 'bass sub follow\nnotes . . 0 _ . . 0 _ . . 0 _ . . 0 _' },
      { id: 'bad', name: 'Broken', lane: 'perc', text: 'drums\nperc x' },
    ],
  });
  const drop = p.cells[p.sections[1].id];
  assert.equal(S.resolve(p, drop.bass).notes.length, 4);
  assert.equal(S.resolve(p, drop.drums).name, 'Beat');
  assert.equal(drop.perc, undefined);
});

test('samples are fitted to the track tempo and key', () => {
  assert.equal(S.keyShift('Am', 'Am'), 0);
  assert.equal(S.keyShift('Am', 'C'), 0); // relative keys fit as they are
  assert.equal(S.keyShift('Am', 'Cm'), 3);
  assert.equal(S.keyShift('Am', 'Gm'), -2);
  assert.equal(S.keyShift('F#m', 'Am'), 3);
  for (const a of S.KEYS) for (const b of S.KEYS) { const k = S.keyShift(a, b); assert.ok(k >= -6 && k <= 5); }
  const loop = { mode: 'loop', bpm: 120, key: 'Gm' };
  assert.deepEqual(S.stretchPlan(loop, 124, 'Am'), { needed: true, rate: 124 / 120, semitones: 2, shift: 2, id: `${(124 / 120).toFixed(5)}|2.000` });
  assert.equal(S.stretchPlan({ ...loop, matchKey: false }, 124, 'Am').semitones, 0);
  assert.equal(S.stretchPlan({ ...loop, key: '' }, 120, 'Am').needed, false); // same tempo, no key: play as it is
  const tape = S.stretchPlan({ ...loop, keepPitch: false, matchKey: false }, 124, 'Am');
  assert.equal(tape.needed, false); // no stretch: just play faster, pitch and all
  assert.ok(Math.abs(S.stretchPlan({ ...loop, keepPitch: false }, 124, 'Am').semitones - (2 + 12 * Math.log2(124 / 120))) < 0.001);
  assert.equal(S.stretchPlan({ mode: 'once', bpm: 90, key: 'Dm' }, 124, 'Am').rate, 1); // one-shots keep their timing
});
