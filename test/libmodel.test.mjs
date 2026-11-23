import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const M = createRequire(import.meta.url)('../desktop/libmodel.cjs');

test('safeFileName makes names valid on Windows and macOS', () => {
  assert.equal(M.safeFileName('AC/DC: Live?.mp3'), 'AC-DC- Live-.mp3');
  assert.equal(M.safeFileName('a<b>c"d|e*f\\g.FLAC'), 'a-b-c-d-e-f-g.flac');
  assert.equal(M.safeFileName('CON.mp3'), 'CON_.mp3');
  assert.equal(M.safeFileName('lpt1'), 'lpt1_');
  assert.equal(M.safeFileName('Trailing dots... .wav'), 'Trailing dots.wav');
  assert.equal(M.safeFileName('...hidden.mp3'), 'hidden.mp3');
  assert.equal(M.safeFileName('  .mp3'), 'Track.mp3');
  assert.equal(M.safeFileName('tab\there\n.mp3'), 'tabhere.mp3');
  assert.equal(M.safeFileName('Mr. Brightside'), 'Mr. Brightside');
  const long = M.safeFileName(`${'x'.repeat(300)}.aiff`);
  assert.equal(long.length, 120);
  assert.ok(long.endsWith('.aiff'));
});

test('uniqueFileName adds (2), (3) and ignores case', () => {
  assert.equal(M.uniqueFileName('Song.mp3', []), 'Song.mp3');
  assert.equal(M.uniqueFileName('Song.mp3', ['song.MP3']), 'Song (2).mp3');
  assert.equal(M.uniqueFileName('Song.mp3', ['Song.mp3', 'Song (2).mp3']), 'Song (3).mp3');
});

test('libraryFileName is Artist - Title with the original extension', () => {
  assert.equal(M.libraryFileName({ artist: 'Kora Vale', title: 'Night Drive' }, '03 x.MP3'), 'Kora Vale - Night Drive.mp3');
  assert.equal(M.libraryFileName({ artist: '', title: 'Loop' }, 'loop.wav'), 'Loop.wav');
});

test('isAudioName', () => {
  assert.ok(M.isAudioName('/a/b/song.flac'));
  assert.ok(!M.isAudioName('/a/b/._song.mp3'));
  assert.ok(!M.isAudioName('cover.jpg'));
});

test('recordFrom: what the source knew wins over tags, tags over the file name', () => {
  const base = { id: 'x', file: 'f.mp3', size: 10, sha1: 'h', originalName: '01 - Name Artist - Name Title.mp3', addedAt: 't' };
  const fromName = M.recordFrom(base, {}, {});
  assert.equal(fromName.artist, 'Name Artist');
  assert.equal(fromName.title, 'Name Title');
  assert.equal(fromName.grid, null);
  assert.deepEqual(fromName.cues, []);
  const fromTags = M.recordFrom(base, { title: 'Tag Title', artist: 'Tag Artist', bpm: 124, key: 'Am' }, {});
  assert.deepEqual([fromTags.title, fromTags.artist, fromTags.bpm, fromTags.key], ['Tag Title', 'Tag Artist', 124, 'Am']);
  const grid = { bpm: 125.5, firstDownbeat: 0.2, v: 3 };
  const cues = [{ name: 'Drop', time: 64, num: 1 }];
  const fromMeta = M.recordFrom(base, { title: 'Tag Title', bpm: 124 }, { title: 'Meta Title', bpm: 125.5, grid, phrases: [{ kind: 'intro' }], cues, duration: 300 });
  assert.equal(fromMeta.title, 'Meta Title');
  assert.equal(fromMeta.bpm, 125.5);
  assert.deepEqual(fromMeta.grid, grid);
  assert.deepEqual(fromMeta.cues, cues);
  assert.equal(fromMeta.phrases.length, 1);
  assert.equal(fromMeta.duration, 300);
  assert.equal(M.recordFrom(base, {}, { grid: { bpm: 0 } }).grid, null, 'a grid without a tempo is ignored');
});

const lib3 = () => ({ version: 1, crates: [], tracks: ['a', 'b', 'c'].map((id) => ({ id, file: `${id}.mp3`, sha1: `h${id}`, size: 1 })) });

test('findDuplicate matches content and size', () => {
  const l = lib3();
  assert.equal(M.findDuplicate(l, 'hb', 1).id, 'b');
  assert.equal(M.findDuplicate(l, 'hb', 2), null);
  assert.equal(M.findDuplicate(l, 'zz', 1), null);
});

test('crates: create with unique names, rename, add once, remove, delete', () => {
  let l = lib3();
  let r = M.createCrate(l, 'c1'); l = r.lib;
  assert.equal(r.crate.name, 'New crate');
  r = M.createCrate(l, 'c2'); l = r.lib;
  assert.equal(r.crate.name, 'New crate 2');
  r = M.createCrate(l, 'c3', '   '); l = r.lib;
  assert.equal(r.crate.name, 'New crate 3');
  const before = l;
  l = M.renameCrate(l, 'c1', '  Warm   up  ');
  assert.equal(l.crates[0].name, 'Warm up');
  assert.equal(before.crates[0].name, 'New crate', 'does not change the library passed in');
  assert.equal(M.renameCrate(l, 'c1', '  '), l, 'an empty name is refused');
  l = M.renameCrate(l, 'c2', 'warm UP');
  assert.equal(l.crates[1].name, 'warm UP 2', 'names stay unique');
  l = M.renameCrate(l, 'c1', 'Warm up');
  assert.equal(l.crates[0].name, 'Warm up', 'renaming to its own name is fine');
  l = M.addToCrate(l, 'c1', ['b', 'a', 'b', 'nope']);
  l = M.addToCrate(l, 'c1', ['a', 'c']);
  assert.deepEqual(l.crates[0].trackIds, ['b', 'a', 'c']);
  l = M.addToCrate(l, 'c2', ['a']);
  l = M.removeFromCrate(l, 'c1', ['a']);
  assert.deepEqual(l.crates[0].trackIds, ['b', 'c']);
  assert.deepEqual(l.crates[1].trackIds, ['a'], 'other crates untouched');
  l = M.deleteCrate(l, 'c1');
  assert.deepEqual(l.crates.map((c) => c.id), ['c2', 'c3']);
  assert.equal(l.tracks.length, 3, 'deleting a crate keeps the music');
});

test('removeTracks also takes them out of every crate', () => {
  let l = M.createCrate(lib3(), 'c1').lib;
  l = M.addToCrate(l, 'c1', ['a', 'b', 'c']);
  l = M.removeTracks(l, ['b']);
  assert.deepEqual(l.tracks.map((t) => t.id), ['a', 'c']);
  assert.deepEqual(l.crates[0].trackIds, ['a', 'c']);
});

test('updateAnalysis stores grid, length and phrases', () => {
  const l = M.updateAnalysis(lib3(), 'a', { grid: { bpm: 128, firstDownbeat: 0.1 }, duration: 240, phrases: [{ kind: 'drop' }] });
  const a = l.tracks.find((t) => t.id === 'a');
  assert.equal(a.bpm, 128);
  assert.equal(a.duration, 240);
  assert.equal(a.phrases.length, 1);
  assert.equal(l.tracks.find((t) => t.id === 'b').grid, undefined);
});

test('normalise repairs a damaged library file', () => {
  assert.deepEqual(M.normalise(null), M.emptyLibrary());
  const l = M.normalise({ tracks: [{ id: 'a', file: 'a.mp3' }, { id: 'b' }, null], crates: [{ id: 'c', name: 'X' }, {}] });
  assert.equal(l.tracks.length, 1);
  assert.deepEqual(l.crates, [{ id: 'c', name: 'X', trackIds: [] }]);
});

test('updateMeta edits details from the library manager, within limits', () => {
  let l = M.updateMeta(lib3(), 'a', { title: '  New name ', artist: 'X', energy: 14, rating: 3, bogus: 1, file: 'evil.mp3' });
  const a = l.tracks.find((t) => t.id === 'a');
  assert.equal(a.title, 'New name'); assert.equal(a.artist, 'X'); assert.equal(a.energy, 10); assert.equal(a.rating, 3);
  assert.equal(a.bogus, undefined); assert.notEqual(a.file, 'evil.mp3');
  l = M.updateMeta(l, 'a', { title: '   ', energy: '' });
  assert.equal(l.tracks.find((t) => t.id === 'a').title, 'New name'); // empty title refused
  assert.equal(l.tracks.find((t) => t.id === 'a').energy, null);
});
