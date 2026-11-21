import test from 'node:test';
import assert from 'node:assert/strict';
import { readTags } from '../js/tags.js';
import { parseFileName, trackFromFile, searchTracks, friendlyMatch, rankNext, keyHue, reconcileBpm, isAudioFile, practiceLibrary } from '../js/musiclib.js';
import { STEPS, currentStep, beatHint, updateAligned } from '../js/lesson.js';

// ---------- tag fixtures ----------
const enc = new TextEncoder();
const bytes = (...parts) => {
  const arrs = parts.map((p) => (typeof p === 'string' ? enc.encode(p) : p instanceof Uint8Array ? p : Uint8Array.from(p)));
  const out = new Uint8Array(arrs.reduce((n, a) => n + a.length, 0));
  let o = 0; for (const a of arrs) { out.set(a, o); o += a.length; }
  return out;
};
const ss = (n) => [(n >> 21) & 0x7f, (n >> 14) & 0x7f, (n >> 7) & 0x7f, n & 0x7f];
const b32 = (n) => [(n >>> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
const le = (n) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff];
const utf16 = (s) => { const a = [0xff, 0xfe]; for (const c of s) { const k = c.charCodeAt(0); a.push(k & 0xff, k >> 8); } return Uint8Array.from(a); };

function id3(ver, frames) {
  const body = bytes(...frames.map(([id, payload]) => bytes(id, ver === 4 ? ss(payload.length) : b32(payload.length), [0, 0], payload)), new Uint8Array(20));
  return bytes('ID3', [ver, 0, 0], ss(body.length), body).buffer;
}

test('reads ID3v2.4 UTF-8 and ID3v2.3 UTF-16 text frames', () => {
  const v4 = readTags(id3(4, [
    ['TIT2', bytes([3], 'Night Drive')], ['TPE1', bytes([3], 'Kora Vale')], ['TBPM', bytes([0], '124')],
    ['TKEY', bytes([0], 'Am')], ['TCON', bytes([0], '(13)House')], ['COMM', bytes([3], 'eng', [0], '8A - Energy 7')],
  ]));
  assert.deepEqual(v4, { title: 'Night Drive', artist: 'Kora Vale', bpm: 124, key: 'Am', genre: 'House', comment: '8A - Energy 7', energy: 7 });
  const v3 = readTags(id3(3, [['TIT2', bytes([1], utf16('Café'), [0, 0])], ['TBPM', bytes([0], '0')]]));
  assert.deepEqual(v3, { title: 'Café' }); // a BPM of 0 is dropped
});

test('reads FLAC Vorbis comments', () => {
  const comments = ['TITLE=Glasshouse', 'ARTIST=Mono Atlas', 'BPM=122.5', 'INITIALKEY=10A'];
  const block = bytes(le(6), 'vendor', le(comments.length), ...comments.map((c) => bytes(le(enc.encode(c).length), c)));
  const flac = bytes('fLaC', [0x84, (block.length >> 16) & 0xff, (block.length >> 8) & 0xff, block.length & 0xff], block).buffer;
  assert.deepEqual(readTags(flac), { title: 'Glasshouse', artist: 'Mono Atlas', bpm: 122.5, key: '10A' });
});

test('untagged files give nothing', () => assert.deepEqual(readTags(new Uint8Array(64).buffer), {}));

// ---------- library helpers ----------
test('file names become artist and title', () => {
  assert.deepEqual(parseFileName('03 - Kora Vale - Night Drive (Extended Mix).mp3'), { artist: 'Kora Vale', title: 'Night Drive (Extended Mix)' });
  assert.deepEqual(parseFileName('Kora_Vale_-_Night_Drive.flac'), { artist: 'Kora Vale', title: 'Night Drive' });
  assert.deepEqual(parseFileName('just a title.wav'), { artist: '', title: 'just a title' });
  assert.ok(isAudioFile('a.MP3') && !isAudioFile('._a.mp3') && !isAudioFile('cover.jpg'));
});

test('tracks from files prefer tags, then cached analysis', () => {
  const meta = { name: 'A - B.mp3', relPath: 'House/A - B.mp3', size: 10, lastModified: 1 };
  const t = trackFromFile(meta, { bpm: 124, key: 'Am' });
  assert.equal(t.title, 'B'); assert.equal(t.camelot, '8A'); assert.equal(t.bpm, 124);
  assert.equal(t.grid.approx, true); assert.equal(t.analysed, false);
  const a = trackFromFile(meta, { bpm: 124 }, { grid: { bpm: 123.98, firstDownbeat: 0.2, v: 2 }, duration: 300, phrases: [{ label: 'Intro', start: 0.2, end: 31.2 }] });
  assert.equal(a.bpm, 123.98); assert.equal(a.analysed, true); assert.equal(a.duration, 300); assert.equal(a.phrases.length, 1);
  // a grid from the old, drift-prone estimator is ignored so the track gets analysed again
  const old = trackFromFile(meta, { bpm: 124 }, { grid: { bpm: 123.9, firstDownbeat: 0.2 }, duration: 300 });
  assert.equal(old.analysed, false); assert.equal(old.bpm, 124);
});

test('tag BPM fixes half/double time from the audio estimate', () => {
  assert.equal(reconcileBpm({ bpm: 62.01, firstDownbeat: 0.1 }, 124).bpm, 124.02);
  assert.equal(reconcileBpm({ bpm: 124.4, firstDownbeat: 0.1 }, 124).bpm, 124.4);
  assert.equal(reconcileBpm({ bpm: 140, firstDownbeat: 0 }, 124).bpm, 140); // disagree: trust the audio
});

test('search, matching and ranking in plain words', () => {
  const lib = practiceLibrary();
  assert.ok(searchTracks(lib, 'house').every((t) => t.genre.toLowerCase().includes('house')));
  assert.equal(searchTracks(lib, '').length, lib.length);
  const cur = { id: 'x', bpm: 124, camelot: '8A', genre: 'House', energy: 5 };
  const great = friendlyMatch(cur, { id: 'y', bpm: 124.5, camelot: '9A', genre: 'House', energy: 6, rating: 3 });
  assert.equal(great.level, 'great');
  assert.deepEqual(great.why, ['Neighbouring key, blends well', 'Close in speed']);
  const tricky = friendlyMatch(cur, { id: 'z', bpm: 140, camelot: '3B', genre: 'Techno' });
  assert.equal(tricky.level, 'tricky');
  assert.ok(tricky.why.includes('Keys may clash'));
  const ranked = rankNext(lib[0], lib, { limit: 5 });
  assert.equal(ranked.length, 5);
  assert.ok(ranked[0].match.score >= ranked[4].match.score);
  assert.ok(!ranked.some((r) => r.track.id === lib[0].id));
  assert.equal(keyHue('1A'), 200); assert.equal(keyHue(null), null);
});

// ---------- lesson ----------
const mix = (o = {}) => ({
  left: { loaded: false, playing: false, bpm: null }, right: { loaded: false, playing: false, bpm: null },
  offsetMs: null, bpmDiff: null, barOffset: null, alignedFor: 0, xfader: 0, ...o,
});

test('lesson walks through the steps in order', () => {
  assert.equal(STEPS[currentStep(mix())].id, 'load-left');
  const s = mix({ left: { loaded: true, playing: true, bpm: 124 }, right: { loaded: true, playing: false, bpm: 122 }, bpmDiff: -2 });
  assert.equal(STEPS[currentStep(s)].id, 'match-speed');
  s.bpmDiff = 0.02; s.right.playing = true;
  assert.equal(STEPS[currentStep(s)].id, 'line-up');
  s.alignedFor = 2.5; s.xfader = 1;
  assert.equal(currentStep(s), STEPS.length);
});

test('beat hints and the alignment timer', () => {
  const s = mix({ left: { loaded: true, playing: true, bpm: 124 }, right: { loaded: true, playing: true, bpm: 124 }, bpmDiff: 0, offsetMs: -40, barOffset: 0 });
  assert.equal(beatHint(s).text, 'B is 40 ms late: nudge it forward');
  assert.equal(beatHint({ ...s, offsetMs: 8 }).tone, 'ok');
  assert.equal(beatHint({ ...s, bpmDiff: 1.5 }).text, 'B is 1.50 BPM faster: slow it down');
  assert.equal(beatHint({ ...s, bpmDiff: -0.2 }).text, 'B is 0.20 BPM slower: speed it up a touch');
  // speed advice comes before the right deck is even playing
  assert.equal(beatHint({ ...s, right: { loaded: true, playing: false }, bpmDiff: 0.3 }).tone, 'close');
  assert.equal(beatHint({ ...s, right: { loaded: true, playing: false }, bpmDiff: 0.02 }).text, 'Speeds match. Now start deck B');
  assert.equal(updateAligned(1, s, 0.1), 0);
  assert.ok(Math.abs(updateAligned(1, { ...s, offsetMs: 5 }, 0.1) - 1.1) < 1e-9);
});

// ---------- levels ----------
import { LEVELS, featuresFor, tempoRange, suggestLevelUp, FEATURES, eqBands } from '../js/levels.js';

test('coaching fades out and tools fade in as the level goes up', () => {
  const starter = featuresFor('starter'), pro = featuresFor('pro');
  assert.equal(starter.lesson, true); assert.equal(pro.lesson, false);
  assert.equal(starter.beatLane, true); assert.equal(pro.beatLane, true); // Pro keeps the waveforms, like rekordbox
  assert.equal(starter.beatDots, true); assert.equal(pro.beatDots, false); // …but the counting dots go
  assert.equal(featuresFor('confident').beatLane, false); // Confident beatmatches by ear
  assert.equal(starter.hotCues, false); assert.equal(featuresFor('improver').hotCues, true);
  assert.equal(featuresFor('confident').beatLaneCheck, true);
  assert.equal(starter.bassEQ, false); assert.equal(pro.fullEQ, true);
  assert.deepEqual(Object.keys(featuresFor('nonsense')), FEATURES); // unknown → starter
  assert.equal(featuresFor('nonsense').lessonDetail, true);
  // every coaching aid that is off at one level stays off at the levels above it
  for (const f of ['lesson', 'lessonDetail', 'keyHints', 'offsetHint', 'matchLabels', 'matchReasons', 'friendlyRoles', 'beatDots']) {
    const on = LEVELS.map((l) => featuresFor(l.id)[f]);
    assert.ok(on.every((v, i) => i === 0 || !v || on[i - 1]), `${f} comes back after switching off`);
  }
  assert.equal(tempoRange('starter'), 8); assert.equal(tempoRange('pro'), 16);
  // deck controls only grow as the level goes up
  assert.deepEqual(LEVELS.map((l) => eqBands(l.id)), [[], ['low'], ['high', 'low'], ['high', 'mid', 'low']]);
  assert.equal(featuresFor('starter').volume, false); assert.equal(featuresFor('improver').volume, true);
  for (const f of ['volume', 'bassEQ', 'highEQ', 'fullEQ', 'barCounter', 'phraseMarks', 'pitchPercent', 'wideTempo']) {
    const on = LEVELS.map((l) => featuresFor(l.id)[f]);
    assert.ok(on.every((v, i) => i === 0 || v || !on[i - 1]), `${f} disappears at a higher level`);
  }
});

test('level up is suggested after enough clean mixes', () => {
  assert.equal(suggestLevelUp('starter', 2), null);
  assert.equal(suggestLevelUp('starter', 3).id, 'improver');
  assert.equal(suggestLevelUp('pro', 10), null);
});

// ---------- My library ----------
import { managedTrack, tracksInCrate, importPayload, canImport } from '../js/musiclib.js';
import { GRID_VERSION } from '../js/beatgrid.js';

test('managedTrack turns a library record into a playable library track', () => {
  const rec = { id: 'u1', file: 'A - B.mp3', size: 9, title: 'B', artist: 'A', key: 'Am', bpm: 124, grid: { bpm: 124.004, firstDownbeat: 0.1, estimated: true, v: GRID_VERSION }, phrases: [{ kind: 'intro' }], cues: [{ num: 0, time: 1 }], duration: 200, path: '/m/A - B.mp3' };
  const t = managedTrack(rec);
  assert.equal(t.id, 'lib:u1');
  assert.equal(t.libId, 'u1');
  assert.equal(t.source, 'managed');
  assert.equal(t.camelot, '8A');
  assert.equal(t.bpm, 124);
  assert.equal(t.analysed, true);
  assert.deepEqual(t.cues, rec.cues);
  assert.equal(t.path, '/m/A - B.mp3');
  // an old estimate is thrown away; the tag BPM stays as an approximate grid
  const old = managedTrack({ ...rec, grid: { bpm: 120, firstDownbeat: 0, estimated: true, v: 0 } });
  assert.equal(old.analysed, false);
  assert.deepEqual(old.grid, { bpm: 124, firstDownbeat: 0, approx: true });
  // rekordbox grids have no version and are kept
  assert.equal(managedTrack({ ...rec, grid: { bpm: 126, firstDownbeat: 0.3 } }).analysed, true);
  assert.equal(managedTrack({ id: 'x', file: 'x.mp3' }).grid, null);
});

test('tracksInCrate keeps the crate order and skips missing tracks', () => {
  const tracks = ['a', 'b', 'c'].map((id) => managedTrack({ id, file: `${id}.mp3`, title: id }));
  assert.equal(tracksInCrate(tracks, null), tracks);
  assert.deepEqual(tracksInCrate(tracks, { trackIds: ['c', 'gone', 'a'] }).map((t) => t.libId), ['c', 'a']);
});

test('importPayload keeps tags, analysis and cues', () => {
  const grid = { bpm: 125, firstDownbeat: 0.2, estimated: true, v: GRID_VERSION };
  const p = importPayload({ source: 'folder', title: 'T', artist: '', key: 'Am', bpm: 125, grid, analysed: true, phrases: [{ kind: 'drop' }], cues: [], duration: 180, energy: null });
  assert.deepEqual(p, { title: 'T', key: 'Am', bpm: 125, duration: 180, cues: [], phrases: [{ kind: 'drop' }], grid });
  assert.equal(importPayload({ source: 'folder', title: 'T', grid: { bpm: 125, approx: true } }).grid, undefined, 'a guess from the tag BPM is not kept');
  assert.ok(importPayload({ source: 'rekordbox', title: 'T', grid: { bpm: 125, firstDownbeat: 0.1 }, analysed: false }).grid);
});

test('canImport: only tracks with a real file, not already in My library', () => {
  assert.equal(canImport({ source: 'practice' }), false);
  assert.equal(canImport({ source: 'managed', path: '/x.mp3' }), false);
  assert.equal(canImport({ source: 'rekordbox', path: '/x.mp3' }), true);
  assert.equal(canImport({ source: 'rekordbox', path: '' }), false);
  const t = { source: 'folder' }; Object.defineProperty(t, 'file', { value: async () => null });
  assert.equal(canImport(t), true);
});

test('importSummary says what happened', async () => {
  const { importSummary } = await import('../js/musiclib.js');
  assert.equal(importSummary({ added: 18, skipped: 2, failed: 0 }), 'Added 18 tracks · 2 were already in My library');
  assert.equal(importSummary({ added: 0, skipped: 1, failed: 0 }), '1 was already in My library');
  assert.equal(importSummary({ added: 1, skipped: 0, failed: 1, cancelled: true }), "Added 1 track · 1 couldn't be copied · stopped");
  assert.equal(importSummary({ added: 0, skipped: 0, failed: 0 }), 'Added 0 tracks');
});
