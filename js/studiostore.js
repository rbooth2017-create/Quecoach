// Studio storage (tracks and samples in IndexedDB) and Freesound search (public-domain sounds only).
const DB = 'cuecoach-studio';
let dbp = null;
function db() {
  dbp ||= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => { req.result.createObjectStore('projects', { keyPath: 'id' }); req.result.createObjectStore('samples', { keyPath: 'id' }); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}
async function run(store, mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const tx = d.transaction(store, mode), req = fn(tx.objectStore(store));
    tx.oncomplete = () => resolve(req?.result);
    tx.onerror = () => reject(tx.error);
  });
}
export const listProjects = () => run('projects', 'readonly', (s) => s.getAll()).then((a) => (a || []).sort((x, y) => y.updated - x.updated));
export const saveProject = (p) => run('projects', 'readwrite', (s) => s.put(JSON.parse(JSON.stringify(p))));
export const deleteProject = (id) => run('projects', 'readwrite', (s) => s.delete(id));
/** Samples: { id, name, lane, bpm, bars, mode, key, duration, source, author, license, url, blob }. */
export const listSamples = () => run('samples', 'readonly', (s) => s.getAll()).then((a) => (a || []).sort((x, y) => (y.added || 0) - (x.added || 0)));
export const saveSample = (x) => run('samples', 'readwrite', (s) => s.put(x));
export const deleteSample = (id) => run('samples', 'readwrite', (s) => s.delete(id));

// ---------- Freesound ----------
// The producer's own free API key (freesound.org/apiv2/apply). Searches are limited to CC0 (public domain),
// so anything made with them can be released without credits or permission. We still keep who made each one.
const FS_KEY = 'studio.freesoundKey';
export const FREESOUND_APPLY = 'https://freesound.org/apiv2/apply/';
export const freesoundKey = () => { try { return localStorage.getItem(FS_KEY) || ''; } catch { return ''; } };
export function setFreesoundKey(k) {
  k = String(k || '').trim();
  try { if (k) localStorage.setItem(FS_KEY, k); else localStorage.removeItem(FS_KEY); } catch { /* private mode */ }
  return !!k;
}
const CC0 = 'license:"Creative Commons 0"';

export async function freesoundSearch(query, { page = 1, maxSeconds = 60 } = {}) {
  const token = freesoundKey();
  if (!token) throw Object.assign(new Error('Add your free Freesound key first.'), { noKey: true });
  const u = new URL('https://freesound.org/apiv2/search/text/');
  u.searchParams.set('query', query);
  u.searchParams.set('filter', `${CC0} duration:[0.1 TO ${maxSeconds}]`);
  u.searchParams.set('fields', 'id,name,username,duration,previews,tags,license,url');
  u.searchParams.set('page_size', '24');
  u.searchParams.set('page', String(page));
  u.searchParams.set('token', token);
  let r;
  try { r = await fetch(u, { signal: AbortSignal.timeout(20000) }); } catch { throw new Error('Couldn\'t reach Freesound. Check your connection.'); }
  if (r.status === 401) throw Object.assign(new Error('Freesound didn\'t accept that key.'), { noKey: true });
  if (r.status === 429) throw new Error('Freesound says slow down. Try again in a minute.');
  if (!r.ok) throw new Error(`Freesound returned an error (${r.status}).`);
  const data = await r.json();
  return {
    count: data.count || 0, next: !!data.next,
    results: (data.results || []).filter((x) => /Creative Commons 0|publicdomain\/zero/i.test(x.license || '')).map((x) => ({
      fsId: x.id, name: x.name, author: x.username, duration: x.duration, tags: x.tags || [], url: x.url,
      license: 'CC0 (public domain)', preview: x.previews?.['preview-hq-mp3'] || x.previews?.['preview-lq-mp3'],
    })),
  };
}
/** The sound itself (Freesound's high-quality preview, an MP3 anyone with a key may download). */
export async function freesoundDownload(hit) {
  const r = await fetch(hit.preview, { signal: AbortSignal.timeout(60000) });
  if (!r.ok) throw new Error(`Couldn't download "${hit.name}" (${r.status}).`);
  return r.blob();
}
