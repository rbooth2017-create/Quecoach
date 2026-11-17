// Beat view capture: watch rekordbox's window and measure beat match ~15 times a second.
// Desktop app: captures only the rekordbox window (Screen Recording permission on macOS).
// In a browser: the user shares the rekordbox window once.
import { analyzeFrame, playheadScores, lineCentre, deckHeaderRegions } from './beatvision.js';

const desktop = window.cueDesktop || null;

/**
 * onUpdate(cam): beat match changed. onDeckText(deck, text): OCR of a deck's header (desktop app only).
 * cam.moving = { 1: bool, 2: bool } — whose waveform is scrolling (i.e. playing).
 */
export function createBeatCam(onUpdate, onDeckText = () => {}) {
  const cam = { moving: { 1: false, 2: false }, motion: { 1: 0, 2: 0 }, lastBar: {}, lastRead: 0, reading: false, state: 'off', message: '', result: null, smooth: null, stream: null, timer: null, layout: null, lastOk: 0, lastFull: 0, ph: null };
  const video = document.createElement('video');
  video.muted = true; video.playsInline = true;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const set = (state, message = '') => { cam.state = state; cam.message = message; onUpdate(cam); };

  async function start() {
    stop();
    try {
      let stream;
      if (desktop) {
        const access = await desktop.screenAccess();
        if (access === 'denied' || access === 'restricted') return set('need-permission');
        const src = await desktop.findRekordbox();
        if (!src) {
          // macOS lists no other app's windows until Screen Recording is allowed
          if (access !== 'granted') return set('need-permission');
          return set('no-window', 'Open rekordbox first.');
        }
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: src.id, maxFrameRate: 20, maxWidth: 3840, maxHeight: 2400 } },
        });
      } else {
        stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 20 }, audio: false });
      }
      cam.stream = stream;
      stream.getVideoTracks()[0].addEventListener('ended', () => set('off', 'Stopped watching rekordbox.'));
      video.srcObject = stream;
      await video.play();
      set('searching');
      cam.timer = setInterval(tick, 66);
    } catch (err) {
      set('error', err?.message || String(err));
    }
  }

  function stop() {
    clearInterval(cam.timer); cam.timer = null;
    cam.stream?.getTracks().forEach((t) => t.stop()); cam.stream = null;
    cam.layout = null; cam.smooth = null; cam.result = null; cam.ph = null;
    cam.moving = { 1: false, 2: false }; cam.motion = { 1: 0, 2: 0 }; cam.lastBar = {}; cam.lastRead = 0;
    if (cam.state !== 'off') set('off');
  }

  function tick() {
    const w = video.videoWidth, h = video.videoHeight;
    if (!w || !h) return;
    let r;
    const now = performance.now();
    if (cam.layout) {
      // only the waveform strip: much cheaper than the whole window
      const pad = 10, y0 = Math.max(0, cam.layout.topY - pad), sh = Math.min(h - y0, cam.layout.bottomY - cam.layout.topY + pad * 2);
      if (canvas.width !== w || canvas.height !== sh) { canvas.width = w; canvas.height = sh; }
      ctx.drawImage(video, 0, y0, w, sh, 0, 0, w, sh);
      const img = ctx.getImageData(0, 0, w, sh);
      const local = { ...cam.layout, topY: cam.layout.topY - y0, bottomY: cam.layout.bottomY - y0 };
      r = analyzeFrame(img, { ...local, playheadX: steadyPlayhead(img, local) });
      if (r.layout) r.layout = { ...r.layout, topY: r.layout.topY + y0, bottomY: r.layout.bottomY + y0 };
      if (!r.ok) { cam.layout = null; cam.ph = null; }
    } else {
      if (now - cam.lastFull < 700) return; // full-window search at most ~1.5×/s
      cam.lastFull = now;
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
      ctx.drawImage(video, 0, 0, w, h);
      r = analyzeFrame(ctx.getImageData(0, 0, w, h));
      if (r.ok) cam.layout = r.layout;
    }
    if (r.ok) {
      cam.lastOk = now;
      trackMotion(r);
      if (now - cam.lastRead > 3000) readDecks(r.layout);
      cam.smooth = smooth(cam.smooth, r);
      cam.result = { ...r, phase: cam.smooth.phase, tempoRatio: cam.smooth.tempoRatio };
      if (cam.state !== 'live') cam.state = 'live';
      onUpdate(cam);
    } else if (now - cam.lastOk > 1200 && cam.state !== 'searching') {
      cam.result = null; cam.smooth = null;
      set('searching', r.reason);
    }
  }

  /**
   * The playhead never moves, but beat lines scroll past it: average each column's "line through
   * both decks" score over recent frames and take the steadiest one.
   */
  function steadyPlayhead(img, layout) {
    const p = playheadScores(img, layout);
    if (!cam.ph || cam.ph.x0 !== p.x0 || cam.ph.scores.length !== p.scores.length) cam.ph = { x0: p.x0, scores: p.scores.slice(), n: 1 };
    else {
      const a = 0.15;
      for (let i = 0; i < p.scores.length; i++) cam.ph.scores[i] += a * (p.scores[i] - cam.ph.scores[i]);
      cam.ph.n++;
    }
    const s = cam.ph.n >= 6 ? cam.ph.scores : p.scores;
    let bi = 0;
    for (let i = 1; i < s.length; i++) if (s[i] > s[bi]) bi = i;
    return s[bi] >= 0.35 ? lineCentre(s, cam.ph.x0, bi + cam.ph.x0) : undefined;
  }

  /** Light smoothing: phase is circular (−0.5..0.5 beats). */
  function smooth(prev, r) {
    if (!prev) return { phase: r.phase, tempoRatio: r.tempoRatio };
    const a = 0.45;
    const d = r.phase - prev.phase, dw = d - Math.round(d);
    let phase = prev.phase + a * dw; phase -= Math.round(phase);
    return { phase, tempoRatio: prev.tempoRatio + a * (r.tempoRatio - prev.tempoRatio) };
  }

  /** A playing deck's waveform scrolls: its bar position keeps changing. */
  function trackMotion(r) {
    for (const no of [1, 2]) {
      const bar = r.decks[no].bar, last = cam.lastBar[no];
      if (last != null) {
        const d = Math.abs(((bar - last + 1.5) % 1) - 0.5);
        cam.motion[no] += 0.3 * ((d > 0.002 ? 1 : 0) - cam.motion[no]);
        cam.moving[no] = cam.motion[no] > 0.5;
      }
      cam.lastBar[no] = bar;
    }
  }

  /** OCR both deck headers (one at a time) and report the text. */
  async function readDecks(layout) {
    if (!desktop?.ocr || cam.reading) return;
    cam.reading = true; cam.lastRead = performance.now();
    try {
      const w = video.videoWidth, h = video.videoHeight;
      const regions = deckHeaderRegions(layout, w, h);
      for (const no of [1, 2]) {
        const g = regions[no];
        if (!g.w || !g.h) continue;
        const c = document.createElement('canvas');
        c.width = g.w; c.height = g.h;
        c.getContext('2d').drawImage(video, g.x, g.y, g.w, g.h, 0, 0, g.w, g.h);
        const blob = await new Promise((res) => c.toBlob(res, 'image/png'));
        const text = await desktop.ocr(new Uint8Array(await blob.arrayBuffer()));
        if (text != null && cam.stream) onDeckText(no, text);
      }
    } catch (err) {
      console.warn('deck reader:', err);
    } finally {
      cam.reading = false;
    }
  }

  /** Read both decks right now (waits for a read in progress). Resolves false if not watching. */
  async function refresh() {
    if (!cam.stream || !cam.layout) return false;
    for (let i = 0; i < 40 && cam.reading; i++) await new Promise((r) => setTimeout(r, 100));
    await readDecks(cam.layout);
    return true;
  }

  return { start, stop, cam, refresh, openSettings: () => desktop?.openScreenSettings() };
}
