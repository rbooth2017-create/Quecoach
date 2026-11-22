// Skill levels and modes: the app grows with the DJ. Each level switches help off and pro tools on. DOM-free.
// One table decides what is on screen, so the UI never has to guess.
//
// Two modes sit above the levels:
//   learn  the game: Play view, career, lessons and coaching. The level decides how much help you get.
//   pro    no game at all: the full decks with every tool, no career, lessons, tour or scores in your face.
//          The level is ignored (and kept, so switching back to Learn brings it back).

export const LEVELS = [
  { id: 'starter', name: 'Starter', blurb: 'Step-by-step coaching, beat lane and plain-word tips.' },
  { id: 'improver', name: 'Improver', blurb: 'Shorter tips. Adds the bass dial, volume and a bar counter for smoother blends.' },
  { id: 'confident', name: 'Confident', blurb: 'No speed tips: match by ear and by the waveforms. Adds the treble dial and Beat FX.' },
  { id: 'pro', name: 'Pro', blurb: 'No coaching. Full three-band EQ, ±16% tempo, keys and numbers.' },
];

export const MODES = [
  { id: 'learn', name: 'Learn', blurb: 'The game: Play view, your DJ career, lessons and a coach that fades out as you improve.' },
  { id: 'pro', name: 'Pro', blurb: 'Just the decks. Every tool, no coaching, career, scores or tour.' },
];
export const modeId = (m) => (m === 'pro' ? 'pro' : 'learn');

// Feature → levels where it is on. Coaching fades out left to right; tools fade in.
const ON = {
  // coaching
  lesson:        ['starter', 'improver', 'confident'], // the step card at the top
  lessonDetail:  ['starter'],                          // full sentences, not just the step title
  keyHints:      ['starter', 'improver'],              // keyboard chips next to controls
  beatLane:      ['starter', 'improver', 'confident', 'pro'], // zoomed waveforms with the beat grid (from Confident, no dots or tips on it)
  beatDots:      ['starter', 'improver'],              // big "1" dots over the grid lines, to learn counting
  beatLaneCheck: [],                                   // hidden; "Check" shows it for a few seconds (by-ear lessons only now)
  offsetHint:    ['starter', 'improver'],              // "Right is 40 ms late: nudge it forward" (and the Play view's speed tips)
  matchLabels:   ['starter', 'improver', 'confident'], // "Great match" instead of raw key/BPM numbers
  matchReasons:  ['starter', 'improver'],              // "Neighbouring key, blends well · Close in speed"
  friendlyRoles: ['starter', 'improver'],              // "In the room" / "Listening" instead of A / B
  upNext:        ['starter', 'improver', 'confident', 'pro'],
  playView:      ['starter', 'improver', 'confident', 'pro'], // the game skin: try it at any level; Full decks is a click away
  setFirst:      ['confident', 'pro'],                 // the side panel opens on the set list, not the lessons
  keyCodes:      ['improver', 'confident', 'pro'],     // Camelot codes ("8A") on key badges; Starter sees the colour only
  // the game around the decks (all off in Pro mode)
  career:        ['starter', 'improver', 'confident', 'pro'], // venues, gig progress, streak and stars
  mixReport:     ['starter', 'improver', 'confident', 'pro'], // the score card after each transition
  tour:          ['starter', 'improver', 'confident', 'pro'], // the first-run tour
  // tools
  volume:        ['improver', 'confident', 'pro'],     // channel volume dial (Starter mixes with the crossfader only)
  bassEQ:        ['improver', 'confident', 'pro'],     // the bass swap is the next skill after beatmatching
  highEQ:        ['confident', 'pro'],                 // treble, for cleaner blends
  fullEQ:        ['pro'],                              // adds the mid band
  hotCues:       ['improver', 'confident', 'pro'],     // hot cues
  perfPads:      ['improver', 'confident', 'pro'],     // 8 performance pads: cues, loops, beat jump, pad FX, sampler
  beatFx:        ['confident', 'pro'],                 // Beat FX section in the mixer
  mixGuide:      ['starter', 'improver', 'confident'], // when to start the next track: countdown, timeline, part tips
  mixDetail:     ['starter', 'improver'],              // the mix guide one move at a time: pick, load, match, cue, levels, swaps
  gridEdit:      ['improver', 'confident', 'pro'],     // fine-tune a beat grid Cue Coach worked out itself
  barCounter:    ['improver', 'confident', 'pro'],     // "Bar 17 · phrase 2"
  phraseMarks:   ['improver', 'confident', 'pro'],     // phrase lines on the waveform
  pitchPercent:  ['confident', 'pro'],                 // speed shown as ±% rather than BPM only
  wideTempo:     ['pro'],                              // ±16 % instead of ±8 %
  keyLock:       ['improver', 'confident', 'pro'],     // key lock button (Starter: the pitch follows the speed, like a record)
  quantise:      ['improver', 'confident', 'pro'],     // hot cues and play wait for the next beat (Starter learns timing by hand)
  proTools:      ['pro'],                              // tempo range per deck, key shift, slip, reverse, censor
};

/** Features that only exist in Learn mode: Pro mode is the decks with nothing of the game around them. */
const LEARN_ONLY = ['lesson', 'lessonDetail', 'keyHints', 'beatDots', 'beatLaneCheck', 'offsetHint', 'matchLabels', 'matchReasons',
  'friendlyRoles', 'playView', 'career', 'mixReport', 'tour', 'mixGuide', 'mixDetail'];

export const FEATURES = Object.keys(ON);

export function levelIndex(id) { const i = LEVELS.findIndex((l) => l.id === id); return i < 0 ? 0 : i; }

/** { lesson: true, beatLane: true, … } for one level, in Learn mode (the default) or Pro mode. */
export function featuresFor(level, mode = 'learn') {
  const pro = modeId(mode) === 'pro';
  const id = pro ? 'pro' : LEVELS[levelIndex(level)].id;
  const f = Object.fromEntries(FEATURES.map((k) => [k, ON[k].includes(id)]));
  if (pro) for (const k of LEARN_ONLY) f[k] = false;
  return f;
}

/** EQ dials shown on each deck, top to bottom like a mixer. */
export function eqBands(level, mode = 'learn') {
  const f = featuresFor(level, mode);
  return [f.highEQ && 'high', f.fullEQ && 'mid', f.bassEQ && 'low'].filter(Boolean);
}

/** Tempo fader range in ± % for a level (Pro tools let each deck pick its own from TEMPO_RANGES). */
export const tempoRange = (level, mode = 'learn') => (featuresFor(level, mode).wideTempo ? 16 : 8);
/** The ranges a pro can switch a deck between, like a CDJ's tempo range button. */
export const TEMPO_RANGES = [6, 8, 10, 16, 50];
export const nextTempoRange = (r) => TEMPO_RANGES[(TEMPO_RANGES.indexOf(r) + 1) % TEMPO_RANGES.length];

/** Clean mixes in a row at a level before we suggest moving up. */
export const MIXES_TO_LEVEL_UP = 3;

/** The level to suggest next, or null if it's too early (or already Pro). */
export function suggestLevelUp(level, cleanMixes) {
  const i = levelIndex(level);
  return cleanMixes >= MIXES_TO_LEVEL_UP && i < LEVELS.length - 1 ? LEVELS[i + 1] : null;
}

/**
 * In Learn mode a level is earned: you can pick your level or any below it, never one above (cap: the level of the
 * venue your career has reached). Returns the level to use: the one asked for if allowed, else the cap.
 */
export function allowedLevel(want, cap) {
  return levelIndex(want) <= levelIndex(cap) ? LEVELS[levelIndex(want)].id : LEVELS[levelIndex(cap)].id;
}
export const levelLocked = (id, cap) => levelIndex(id) > levelIndex(cap);
