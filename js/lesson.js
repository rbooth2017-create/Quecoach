// "Your first mix": the beginner lesson as a list of steps, each ticked by a check on the live mix state.
// DOM-free. The UI builds `s` (the mix state) every frame and calls currentStep().
//
// s = {
//   left, right: { loaded, playing, bpm, title }   // the room deck and the next deck
//   offsetMs: number|null   // how far the right deck's beats are from the left's (+ = ahead)
//   bpmDiff: number|null    // right BPM − left BPM
//   barOffset: number|null  // beats between the two "1"s (0 = downbeats together)
//   alignedFor: seconds the beats have stayed within the window
//   xfader: 0 (left) … 1 (right)
// }

export const ALIGN_MS = 15;   // beats count as lined up within ±15 ms
export const HOLD_S = 2;      // …held for 2 seconds
export const TEMPO_OK = 0.1;  // BPM difference that counts as matched

export const STEPS = [
  {
    id: 'load-left', title: 'Pick your first track',
    body: 'Choose a track for deck A, on the left. It\'s the one the room hears first.',
    action: 'music', done: (s) => s.left.loaded,
  },
  {
    id: 'play-left', title: 'Start the music',
    body: 'Press play on deck A. Nice and easy.',
    key: 'Q', done: (s) => s.left.playing,
  },
  {
    id: 'load-right', title: 'Choose what comes next',
    body: 'Pick a track for deck B, on the right. Tracks marked "Great match" are the easiest to mix.',
    action: 'music', done: (s) => s.right.loaded,
  },
  {
    id: 'match-speed', title: 'Match the speed',
    body: 'Make deck B\'s BPM the same as deck A\'s ({LBPM}). Slide its speed fader, or tap + and −.',
    key: '↑ ↓', done: (s) => s.bpmDiff != null && Math.abs(s.bpmDiff) <= TEMPO_OK,
  },
  {
    id: 'play-right', title: 'Start it on the beat',
    body: 'Press play on deck B. Turn on its Listen button in the mixer to hear it while the room still hears A.',
    key: 'P', done: (s) => s.right.playing,
  },
  {
    id: 'line-up', title: 'Line up the beats',
    body: 'Watch the beat lane. Give deck B\'s wheel a gentle spin forward or back until its dots sit under A\'s, and hold them there.',
    key: '← →', done: (s) => s.alignedFor >= HOLD_S,
  },
  {
    id: 'blend', title: 'Bring it in',
    body: 'Slowly slide the crossfader all the way over to B. Take about 8 bars. Smooth is better than fast.',
    done: (s) => s.xfader >= 0.95,
  },
];

/** Index of the first step that isn't done or skipped yet (STEPS.length when the lesson is complete). */
export function currentStep(s, skipped = new Set()) {
  for (let i = 0; i < STEPS.length; i++) if (!skipped.has(STEPS[i].id) && !STEPS[i].done(s)) return i;
  return STEPS.length;
}

/** A plain-words hint for the beat lane. */
export function beatHint(s) {
  if (!s.left.loaded || !s.right.loaded) return null;
  if (s.bpmDiff != null && Math.abs(s.bpmDiff) > TEMPO_OK) {
    const d = Math.abs(s.bpmDiff);
    return { tone: d < 0.5 ? 'close' : 'warn', text: `B is ${d.toFixed(2)} BPM ${s.bpmDiff > 0 ? 'faster: slow it down' : 'slower: speed it up'}${d < 0.5 ? ' a touch' : ''}` };
  }
  if (!s.left.playing || !s.right.playing) return s.bpmDiff != null ? { tone: 'ok', text: 'Speeds match. Now start deck B' } : null;
  if (s.offsetMs == null) return null;
  const off = Math.abs(s.offsetMs);
  if (off <= ALIGN_MS) return { tone: 'ok', text: s.barOffset ? 'Beats lined up · the big "1" dots are apart' : 'Beats lined up' };
  return { tone: off < 60 ? 'close' : 'warn', text: `B is ${off.toFixed(0)} ms ${s.offsetMs > 0 ? 'early: nudge it back' : 'late: nudge it forward'}` };
}

/** Track how long the beats have stayed lined up. */
export function updateAligned(prev, s, dt) {
  const ok = s.left.playing && s.right.playing && s.offsetMs != null && Math.abs(s.offsetMs) <= ALIGN_MS
    && s.bpmDiff != null && Math.abs(s.bpmDiff) <= TEMPO_OK;
  return ok ? prev + dt : 0;
}

export const fill = (text, s) => text.replace('{LBPM}', s.left.bpm ? s.left.bpm.toFixed(2) : '?');
