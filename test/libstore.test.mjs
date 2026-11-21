import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const { createStore, walkAudio } = createRequire(import.meta.url)('../desktop/libstore.cjs');

const tmpdir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'cuecoach-lib-'));
const write = (dir, rel, data) => { const p = path.join(dir, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, data); return p; };

test('walkAudio finds audio files in subfolders and skips hidden and ._ files', async () => {
  const src = tmpdir();
  write(src, 'b.mp3', 'b'); write(src, 'sub/a.flac', 'a'); write(src, 'sub/._a.flac', 'x');
  write(src, '.hidden/c.mp3', 'c'); write(src, 'cover.jpg', 'j');
  const found = (await walkAudio(src)).map((p) => path.relative(src, p).split(path.sep).join('/'));
  assert.deepEqual(found.sort(), ['b.mp3', 'sub/a.flac']);
});

test('importItems copies files, keeps metadata, skips duplicates and renames clashes', async () => {
  const src = tmpdir(), root = tmpdir();
  const one = write(src, 'Kora Vale - Night Drive.mp3', 'AUDIO-ONE');
  const sameBytes = write(src, 'copy/other name.mp3', 'AUDIO-ONE');
  const clash = write(src, 'x/Kora Vale - Night Drive.mp3', 'AUDIO-TWO');
  const store = createStore(root);
  const progress = [];
  const grid = { bpm: 124, firstDownbeat: 0.5, v: 3 };
  const cues = [{ name: 'Mix in', time: 32, num: 1 }];
  const readTags = (ab) => (new TextDecoder().decode(ab) === 'AUDIO-TWO' ? { title: 'Night Drive', artist: 'Kora Vale', bpm: 126 } : {});
  const res = await store.importItems([
    { path: one, meta: { grid, cues, phrases: [{ kind: 'intro' }], key: 'Am', bpm: 124 } },
    { path: sameBytes },
    { path: clash },
    { bytes: new TextEncoder().encode('AUDIO-THREE'), name: 'dropped.wav' },
    { path: write(src, 'notes.txt', 'nope') },
  ], { readTags, onProgress: (p) => progress.push(p) });

  assert.equal(res.added, 3);
  assert.equal(res.skipped, 1);
  assert.equal(res.failed, 1);
  assert.equal(res.ids[1], res.ids[0], 'the duplicate maps to the track already there');
  assert.equal(res.ids[4], null);
  const files = fs.readdirSync(store.musicDir).sort();
  assert.deepEqual(files, ['Kora Vale - Night Drive (2).mp3', 'Kora Vale - Night Drive.mp3', 'dropped.wav']);
  assert.equal(fs.readFileSync(path.join(store.musicDir, 'Kora Vale - Night Drive (2).mp3'), 'utf8'), 'AUDIO-TWO');

  const saved = JSON.parse(fs.readFileSync(store.indexPath, 'utf8'));
  assert.equal(saved.tracks.length, 3);
  const first = saved.tracks.find((t) => t.id === res.ids[0]);
  assert.deepEqual(first.grid, grid);
  assert.deepEqual(first.cues, cues);
  assert.equal(first.key, 'Am');
  assert.equal(saved.tracks.find((t) => t.id === res.ids[2]).bpm, 126, 'tags are read');
  assert.ok(!fs.readdirSync(root).some((n) => n.endsWith('.tmp')), 'no temp files left');
  assert.ok(!files.some((n) => n.startsWith('.incoming-')));
  assert.equal(progress.at(-1).done, 5);
  assert.ok(progress.some((p) => p.current === 'Kora Vale - Night Drive.mp3'));

  // a second import of the same files adds nothing, and the store survives a reload
  const again = await createStore(root).importItems([{ path: one }, { path: clash }]);
  assert.equal(again.added, 0);
  assert.equal(again.skipped, 2);
});

test('importItems stops when cancelled', async () => {
  const src = tmpdir(), root = tmpdir();
  const ac = new AbortController();
  const items = [1, 2, 3].map((n) => ({ path: write(src, `t${n}.mp3`, `T${n}`) }));
  const res = await createStore(root).importItems(items, { signal: ac.signal, onProgress: (p) => { if (p.done === 1) ac.abort(); } });
  assert.equal(res.cancelled, true);
  assert.equal(res.added, 1);
  assert.equal(fs.readdirSync(path.join(root, 'Music')).length, 1);
});

test('remove trashes the file and the record; crates are updated', async () => {
  const src = tmpdir(), root = tmpdir();
  const store = createStore(root);
  const { ids } = await store.importItems([{ path: write(src, 'a.mp3', 'A') }, { path: write(src, 'b.mp3', 'B') }]);
  const M = createRequire(import.meta.url)('../desktop/libmodel.cjs');
  await store.update((l) => M.addToCrate(M.createCrate(l, 'c').lib, 'c', ids));
  const trashed = [];
  const lib = await store.remove([ids[0]], async (p) => { trashed.push(path.basename(p)); fs.unlinkSync(p); });
  await store.flush();
  assert.deepEqual(trashed, ['a.mp3']);
  assert.deepEqual(lib.tracks.map((t) => t.id), [ids[1]]);
  assert.deepEqual(lib.crates[0].trackIds, [ids[1]]);
  assert.equal(JSON.parse(fs.readFileSync(store.indexPath, 'utf8')).tracks.length, 1);
});
