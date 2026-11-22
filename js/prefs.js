// Preferences for the Settings dialog: one object, saved as learn.prefs. DOM-free.
// audio.js reads `latency` and `limiter` itself at start-up (the audio context is made before the app boots).

export const DEFAULTS = {
  mode: 'learn',          // 'learn' (the game) or 'pro' (just the decks): see js/levels.js MODES
  start: 'ask',           // Learn mode on start-up: 'ask' (the start screen), 'play', 'decks' or 'life' (DJ Life)
  latency: 'interactive', // audio buffer: 'interactive' (lowest delay), 'balanced', 'playback' (safest on slow computers)
  limiter: true,          // the safety limiter on the master out
  jogs: 'auto',           // jog wheels on the full decks: 'auto' (hidden in the pro layout), 'show', 'hide'
  tempoRange: 16,         // Pro: each deck's tempo range to start with (the deck's button changes it)
  upIsFaster: false,      // the speed fader: false = pull down to go faster (like a CDJ), true = push up
  loadLock: true,         // never load over the deck the room is hearing
  mixClips: true,         // keep a clip of every transition for "Listen back"
  young: false,           // Young DJ mode: no links out, no shop, no AI key
  youngPin: '',           // the 4-digit PIN a grown-up set to switch Young DJ mode off
  booth: '',              // a second output for a booth monitor ('' = off)
  boothLevel: 1,
  laneZoom: 1,            // beat lane zoom: 0.5 (wide) … 4 (close)
};

export const LATENCIES = [
  ['interactive', 'Lowest delay', 'Best with a controller. Try Balanced if you hear crackles.'],
  ['balanced', 'Balanced', 'A little more delay, fewer crackles on busy computers.'],
  ['playback', 'Safest', 'The most delay. For older computers.'],
];
export const START_VIEWS = [['ask', 'Ask me each time'], ['play', 'Play view'], ['decks', 'Full decks'], ['life', 'DJ Life']];
export const LANE_ZOOMS = [0.5, 0.75, 1, 1.5, 2, 3, 4];

const oneOf = (v, list, d) => (list.includes(v) ? v : d);
const num = (v, lo, hi, d) => (Number.isFinite(+v) && v !== '' && v != null ? Math.max(lo, Math.min(hi, +v)) : d);

/** A saved prefs object, checked and filled in. */
export function loadPrefs(saved) {
  const s = saved && typeof saved === 'object' ? saved : {};
  return {
    mode: oneOf(s.mode, ['learn', 'pro'], DEFAULTS.mode),
    start: oneOf(s.start, START_VIEWS.map((x) => x[0]), DEFAULTS.start),
    latency: oneOf(s.latency, LATENCIES.map((x) => x[0]), DEFAULTS.latency),
    limiter: s.limiter !== false,
    jogs: oneOf(s.jogs, ['auto', 'show', 'hide'], DEFAULTS.jogs),
    tempoRange: oneOf(+s.tempoRange, [6, 8, 10, 16, 50], DEFAULTS.tempoRange),
    upIsFaster: !!s.upIsFaster,
    loadLock: s.loadLock !== false,
    mixClips: s.mixClips !== false,
    young: !!s.young,
    youngPin: /^\d{4}$/.test(s.youngPin || '') ? s.youngPin : '',
    booth: typeof s.booth === 'string' ? s.booth : '',
    boothLevel: num(s.boothLevel, 0, 1.5, DEFAULTS.boothLevel),
    laneZoom: oneOf(+s.laneZoom, LANE_ZOOMS, DEFAULTS.laneZoom),
  };
}

/** Zoom the beat lane one step in (+1) or out (−1). */
export function stepZoom(z, dir) {
  const i = LANE_ZOOMS.indexOf(z), at = i < 0 ? LANE_ZOOMS.indexOf(1) : i;
  return LANE_ZOOMS[Math.max(0, Math.min(LANE_ZOOMS.length - 1, at + Math.sign(dir)))];
}

/** Young DJ mode can only be switched off with the PIN it was switched on with. */
export function canLeaveYoung(prefs, pin) { return !prefs.young || !prefs.youngPin || String(pin) === prefs.youngPin; }
