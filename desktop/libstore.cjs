// My library on disk: copies audio into Cue Coach's own music folder and keeps library.json.
// Plain Node (no Electron) so it can be tested against a temp folder. The main process owns the one store.
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { pipeline } = require('node:stream/promises');
const { Transform } = require('node:stream');
const M = require('./libmodel.cjs');

const TAG_BYTES = 256 * 1024;

/** Every audio file under `folder` (recursively), skipping hidden files and macOS "._" files. */
async function walkAudio(folder) {
  const out = [];
  async function go(dir) {
    let entries;
    try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) await go(p);
      else if (e.isFile() && M.isAudioName(e.name)) out.push(p);
    }
  }
  await go(folder);
  return out;
}

async function readHead(file) {
  const fh = await fsp.open(file, 'r');
  try {
    const buf = Buffer.alloc(TAG_BYTES);
    const { bytesRead } = await fh.read(buf, 0, TAG_BYTES, 0);
    return buf.subarray(0, bytesRead);
  } finally { await fh.close(); }
}
const toArrayBuffer = (b) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);

/**
 * @param {string} root  the app's data folder; music goes in root/Music, the index in root/library.json
 */
function createStore(root) {
  const musicDir = path.join(root, 'Music');
  const indexPath = path.join(root, 'library.json');
  let lib = null;
  let saving = Promise.resolve();
  let dirty = false;

  async function load() {
    if (lib) return lib;
    await fsp.mkdir(musicDir, { recursive: true });
    try { lib = M.normalise(JSON.parse(await fsp.readFile(indexPath, 'utf8'))); } catch { lib = M.emptyLibrary(); }
    // tidy up copies interrupted by a crash or quit
    for (const n of await fsp.readdir(musicDir).catch(() => [])) if (n.startsWith('.incoming-')) fsp.unlink(path.join(musicDir, n)).catch(() => {});
    return lib;
  }

  /** Write library.json atomically (temp file, then rename), one write at a time. */
  function save() {
    dirty = true;
    saving = saving.then(async () => {
      if (!dirty) return;
      dirty = false;
      const tmp = `${indexPath}.${process.pid}.tmp`;
      await fsp.writeFile(tmp, JSON.stringify(lib));
      await fsp.rename(tmp, indexPath);
    }).catch((err) => { console.error('library.json not saved:', err); });
    return saving;
  }

  /** Change the library with a pure function from libmodel.cjs and save it. */
  async function update(fn) {
    await load();
    lib = fn(lib);
    save();
    return lib;
  }

  const filePath = (rec) => path.join(musicDir, rec.file);

  /**
   * Copy tracks into the library. Each item is { path, meta } (a file on disk) or { bytes, name, meta }.
   * Files already in the library (same content) are skipped. Returns, for every item, the library id it
   * ended up as (new or existing), or null if it failed.
   */
  async function importItems(items, { readTags = () => ({}), onProgress = () => {}, signal } = {}) {
    await load();
    const taken = new Set(await fsp.readdir(musicDir).catch(() => []));
    const res = { ids: [], added: 0, skipped: 0, failed: 0, errors: [], cancelled: false, total: items.length };
    let sinceSave = 0;
    for (let i = 0; i < items.length; i++) {
      if (signal?.aborted) { res.cancelled = true; break; }
      const it = items[i];
      const originalName = it.path ? path.basename(it.path) : String(it.name || 'Track.mp3');
      onProgress({ done: i, total: items.length, added: res.added, skipped: res.skipped, failed: res.failed, current: it.meta?.title || originalName });
      const tmp = path.join(musicDir, `.incoming-${crypto.randomUUID()}`);
      try {
        if (it.error) throw new Error(it.error);
        if (!M.isAudioName(originalName)) throw new Error('not an audio file Cue Coach can play');
        const hash = crypto.createHash('sha1');
        let size = 0, head;
        if (it.path) {
          head = await readHead(it.path);
          const tap = new Transform({ transform(chunk, _enc, cb) { hash.update(chunk); size += chunk.length; cb(null, chunk); } });
          await pipeline(fs.createReadStream(it.path), tap, fs.createWriteStream(tmp), { signal });
        } else {
          const buf = Buffer.isBuffer(it.bytes) ? it.bytes : Buffer.from(it.bytes);
          head = buf.subarray(0, TAG_BYTES);
          hash.update(buf); size = buf.length;
          await fsp.writeFile(tmp, buf, { signal });
        }
        const sha1 = hash.digest('hex');
        const dup = M.findDuplicate(lib, sha1, size);
        if (dup) {
          await fsp.unlink(tmp).catch(() => {});
          res.skipped++; res.ids.push(dup.id); continue;
        }
        let tags = {};
        try { tags = readTags(toArrayBuffer(head)) || {}; } catch { /* unreadable tags: use the file name */ }
        const id = crypto.randomUUID();
        let rec = M.recordFrom({ id, file: '', size, sha1, originalName, origin: it.path || '' }, tags, it.meta);
        const file = M.uniqueFileName(M.libraryFileName(rec, originalName), taken);
        taken.add(file);
        await fsp.rename(tmp, path.join(musicDir, file));
        rec = { ...rec, file };
        lib = M.addTrack(lib, rec);
        res.added++; res.ids.push(id);
        if (++sinceSave >= 20) { sinceSave = 0; save(); }
      } catch (err) {
        await fsp.unlink(tmp).catch(() => {});
        if (signal?.aborted) { res.cancelled = true; break; }
        res.failed++; res.ids.push(null); res.errors.push(`${originalName}: ${err.message}`);
      }
    }
    await save();
    onProgress({ done: res.ids.length, total: items.length, added: res.added, skipped: res.skipped, failed: res.failed, current: '' });
    return res;
  }

  /** Remove tracks: files go to the Trash / Recycle Bin via `trashItem` (so it can be undone). */
  async function remove(ids, trashItem) {
    await load();
    const want = new Set(ids);
    for (const rec of lib.tracks.filter((t) => want.has(t.id))) {
      try { await trashItem(filePath(rec)); } catch (err) {
        if (fs.existsSync(filePath(rec))) throw err; // still there: keep its record
      }
    }
    return update((l) => M.removeTracks(l, ids));
  }

  return {
    load, save, update, importItems, remove, filePath, musicDir, indexPath,
    get: (id) => lib?.tracks.find((t) => t.id === id) || null,
    flush: () => saving,
  };
}

module.exports = { createStore, walkAudio, TAG_BYTES };
