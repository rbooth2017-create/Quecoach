// Skill levels: the app grows with the DJ. Each level switches help off and pro tools on. DOM-free.
// One table decides what is on screen, so the UI never has to guess.

export const LEVELS = [
  { id: 'starter', name: 'Starter', blurb: 'Step-by-step coaching, beat lane and plain-word tips.' },
  { id: 'improver', name: 'Improver', blurb: 'Shorter tips. Adds the bass dial, volume and a bar counter for smoother blends.' },
  { id: 'confident', name: 'Confident', blurb: 'Beatmatch by ear: the beat lane hides until you ask to check. Adds the treble dial.' },
  { id: 'pro', name: 'Pro', blurb: 'No coaching. Full three-band EQ, ±16% tempo, keys and numbers.' },
];

// Feature → levels where it is on. Coaching fades out left to right; tools fade in.
const ON = {
  // coaching
  lesson:        ['starter', 'improver', 'confident'], // the step card at the top
  lessonDetail:  ['starter'],                          // full sentences, not just the step title
  keyHints:      ['starter', 'improver'],              // keyboard chips next to controls
  beatLane:      ['starter', 'improver', 'pro'],       // zoomed waveforms with the beat grid (Confident trains by ear)
  beatDots:      ['starter', 'improver'],              // big "1" dots over the grid lines, to learn counting
  beatLaneCheck: ['confident'],                        // hidden; "Check" shows it for a few seconds
  offsetHint:    ['starter', 'improver'],              // "Right is 40 ms late: nudge it forward"
  matchLabels:   ['starter', 'improver', 'confident'], // "Great match" instead of raw key/BPM numbers
  matchReasons:  ['starter', 'improver'],              // "Neighbouring key, blends well · Close in speed"
  friendlyRoles: ['starter', 'improver'],              // "In the room" / "Listening" instead of A / B
  upNext:        ['starter', 'improver', 'confident', 'pro'],
  playView:      ['starter', 'improver', 'confident', 'pro'], // the game skin: try it at any level; Full decks is a click away
  setFirst:      ['confident', 'pro'],                 // the side panel opens on the set list, not the lessons
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
  keyLock:       ['improver', 'confident', 'pro'],
  quantise:      ['improver', 'confident', 'pro'],     // hot cues and play wait for the next beat (Starter learns timing by hand)     // key lock button (Starter: the pitch follows the speed, like a record)
};

export const FEATURES = Object.keys(ON);

export function levelIndex(id) { const i = LEVELS.findIndex((l) => l.id === id); return i < 0 ? 0 : i; }

/** { lesson: true, beatLane: true, … } for one level. */
export function featuresFor(level) {
  const id = LEVELS[levelIndex(level)].id;
  return Object.fromEntries(FEATURES.map((f) => [f, ON[f].includes(id)]));
}

/** EQ dials shown on each deck, top to bottom like a mixer. */
export function eqBands(level) {
  const f = featuresFor(level);
  return [f.highEQ && 'high', f.fullEQ && 'mid', f.bassEQ && 'low'].filter(Boolean);
}

/** Tempo fader range in ± %. */
export const tempoRange = (level) => (featuresFor(level).wideTempo ? 16 : 8);

/** Clean mixes in a row at a level before we suggest moving up. */
export const MIXES_TO_LEVEL_UP = 3;

/** The level to suggest next, or null if it's too early (or already Pro). */
export function suggestLevelUp(level, cleanMixes) {
  const i = levelIndex(level);
  return cleanMixes >= MIXES_TO_LEVEL_UP && i < LEVELS.length - 1 ? LEVELS[i + 1] : null;
}
