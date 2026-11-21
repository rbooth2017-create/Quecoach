// Recording what the room hears: whole sets on request, and a short clip of every transition so the mix
// report can play it back. Browser-only (MediaRecorder), with the pure bits exported for tests.

/** The best audio format this browser can record. */
export function pickMime(isSupported = (t) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t)) {
  return ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'].find((t) => isSupported(t)) || '';
}
export const extFor = (mime = '') => (mime.includes('ogg') ? 'ogg' : mime.includes('mp4') ? 'm4a' : 'webm');

/** "Cue Coach set 2026-11-21 18.30.webm" */
export function fileName(kind, date = new Date(), mime = 'audio/webm') {
  const p = (n) => String(n).padStart(2, '0');
  return `Cue Coach ${kind} ${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())} ${p(date.getHours())}.${p(date.getMinutes())}.${extFor(mime)}`;
}

/** 1:05 / 1:02:03 */
export function elapsed(sec) {
  const s = Math.max(0, Math.floor(sec)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`;
}

/** One recording of a MediaStream. stop() resolves with the Blob (or null if nothing was captured). */
export class Take {
  constructor(stream, mime = pickMime()) {
    this.mime = mime; this.chunks = []; this.startedAt = Date.now();
    this.rec = new MediaRecorder(stream, mime ? { mimeType: mime, audioBitsPerSecond: 192000 } : undefined);
    this.rec.ondataavailable = (e) => { if (e.data?.size) this.chunks.push(e.data); };
    this.rec.start(1000);
  }
  get seconds() { return (Date.now() - this.startedAt) / 1000; }
  stop() {
    return new Promise((resolve) => {
      if (this.rec.state === 'inactive') return resolve(this.chunks.length ? new Blob(this.chunks, { type: this.mime }) : null);
      this.rec.onstop = () => resolve(this.chunks.length ? new Blob(this.chunks, { type: this.mime || 'audio/webm' }) : null);
      this.rec.stop();
    });
  }
}
