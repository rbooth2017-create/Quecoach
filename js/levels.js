// Skill levels: the app grows with the DJ. Each level switches help off and pro tools on. DOM-free.
// One table decides what is on screen, so the UI never has to guess.

export const LEVELS = [
  { id: 'starter', name: 'Starter', blurb: 'Step-by-step coaching, beat lane and plain-word tips.' },
  { id: 'improver', name: 'Improver', blurb: 'Shorter tips. Adds the bass control and bar counter for smoother blends.' },
  { id: 'confident', name: 'Confident', blurb: 'Beatmatch by ear: the beat lane hides until you ask to check.' },
  { id: 'pro', name: 'Pro', blurb: 'No coaching. Just decks, EQ, keys and numbers.' },
];

// Feature → levels where it is on. Coaching fades out left to right; tools fade in.
const ON = {
  // coaching
  lesson:        ['starter', 'improver', 'confident'], // the step card at the top
  lessonDetail:  ['starter'],                          // full sentences, not just the step title
  keyHints:      ['starter', 'improver'],              // keyboard chips next to controls
  beatLane:      ['starter', 'improver'],              // always visible
  beatLaneCheck: ['confident'],                        // hidden; "Check" shows it for a few seconds
  offsetHint:    ['starter', 'improver'],              // "Right is 40 ms late: nudge it forward"
  matchLabels:   ['starter', 'improver', 'confident'], // "Great match" instead of raw key/BPM numbers
  matchReasons:  ['starter', 'improver'],              // "Neighbouring key, blends well · Close in speed"
  friendlyRoles: ['starter', 'improver'],              // "In the room" / "Listening" instead of A / B
  upNext:        ['starter', 'improver', 'confident', 'pro'],
  // tools
  bassEQ:        ['improver', 'confident', 'pro'],     // the bass swap is the next skill after beatmatching
  fullEQ:        ['pro'],                              // high, mid and low
  barCounter:    ['improver', 'confident', 'pro'],     // "Bar 17 · phrase 2"
  phraseMarks:   ['improver', 'confident', 'pro'],     // phrase lines on the waveform
  pitchPercent:  ['confident', 'pro'],                 // speed shown as ±% rather than BPM only
  wideTempo:     ['pro'],                              // ±16 % instead of ±8 %
};

export const FEATURES = Object.keys(ON);

export function levelIndex(id) { const i = LEVELS.findIndex((l) => l.id === id); return i < 0 ? 0 : i; }

/** { lesson: true, beatLane: true, … } for one level. */
export function featuresFor(level) {
  const id = LEVELS[levelIndex(level)].id;
  return Object.fromEntries(FEATURES.map((f) => [f, ON[f].includes(id)]));
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
