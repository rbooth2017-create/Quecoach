// The Cue Coach curriculum: short lessons from complete beginner to novice DJ. DOM-free.
// Each step has a check on the live mix state `s` (built by the app every frame):
//
// s = {
//   left, right: { loaded, playing, bpm, camelot, eqLow, playedBars }   // deck A and deck B
//   bpmDiff, offsetMs, barOffset, alignedFor, xfader, keyScore,
//   did: Set of things the user has done since the lesson started:
//        'restart' | 'jog' | 'scrub' | 'phraseStart' | 'checkOk' | 'slowBlend' | 'driftOut'
// }
// Steps are ticked in order and stay ticked ("latched"), so pausing later doesn't undo a step.
import { STEPS as FIRST_MIX, ALIGN_MS, HOLD_S, TEMPO_OK } from './lesson.js';

const both = (s) => s.left.playing && s.right.playing;
const matched = (s) => s.bpmDiff != null && Math.abs(s.bpmDiff) <= TEMPO_OK;
const locked = (s) => both(s) && matched(s) && s.alignedFor >= HOLD_S;

export const TIERS = [
  { id: 'beginner', name: 'Beginner', blurb: 'Find your way around and get two tracks playing together.' },
  { id: 'novice', name: 'Novice', blurb: 'Make mixes that sound smooth: phrasing, EQ, keys and your ears.' },
];

export const LESSONS = [
  {
    id: 'decks', tier: 'beginner', title: 'Meet your decks', minutes: 2,
    why: 'Every DJ setup has the same parts: two decks to play tracks, and a mixer in the middle that decides what the room hears.',
    steps: [
      { id: 'load', title: 'Load a track on deck A', body: 'Pick any track in the library and press its A button, or double-click it.', action: 'music', done: (s) => s.left.loaded },
      { id: 'play', title: 'Press play', body: 'The big round button on deck A. Watch the wheel turn with the music.', key: 'Q', done: (s) => s.left.playing },
      { id: 'restart', title: 'Jump back to the start', body: 'The small button under play takes the track back to its very first beat.', done: (s) => s.did.has('restart') },
      { id: 'scrub', title: 'Find a spot with the wheel', body: 'Pause, then turn the wheel slowly. It moves you through the track, just like a record.', done: (s) => s.did.has('scrub') },
    ],
  },
  {
    id: 'counting', tier: 'beginner', title: 'Counting beats and bars', minutes: 3,
    why: 'Dance music is built in 4s: 4 beats make a bar, and 16 bars make a phrase. Mixing starts with counting along.',
    steps: [
      { id: 'play', title: 'Play deck A', body: 'Get a track playing on deck A.', key: 'Q', done: (s) => s.left.playing },
      { id: 'count', title: 'Count 8 bars along', body: 'Watch the beat lane: every big dot is a "1". Count 1-2-3-4 out loud for 8 bars.', done: (s) => s.left.playedBars >= 8 },
      { id: 'restart', title: 'Go back to the first "1"', body: 'Use the Start button. Tracks begin on a "1", which is why we mix from there.', done: (s) => s.did.has('restart') },
    ],
  },
  {
    id: 'speed', tier: 'beginner', title: 'Match the speed', minutes: 3,
    why: 'Two tracks only sound good together when they run at the same speed (BPM). The speed fader changes it.',
    steps: [
      { id: 'loadA', title: 'Load and play deck A', body: 'This is your track in the room.', action: 'music', done: (s) => s.left.playing },
      { id: 'loadB', title: 'Load a track on deck B', body: 'Pick something close in BPM. The Suggested tab helps.', action: 'music', done: (s) => s.right.loaded },
      { id: 'match', title: 'Make the BPMs the same', body: 'Slide deck B\'s speed fader, or tap + and −, until both decks show the same BPM.', key: '↑ ↓', done: matched },
      { id: 'playB', title: 'Play deck B with Listen on', body: 'Turn on Listen for B in the mixer so you hear it while the room still hears A.', key: 'P', done: (s) => s.right.playing && matched(s) },
    ],
  },
  {
    id: 'first-mix', tier: 'beginner', title: 'Your first mix', minutes: 5,
    why: 'Put it all together: match the speed, line up the beats, and slide the crossfader over.',
    steps: FIRST_MIX,
  },
  {
    id: 'nudge', tier: 'beginner', title: 'Nudge like a pro', minutes: 3,
    why: 'Even matched tracks drift apart. DJs catch it early with tiny pushes on the wheel.',
    steps: [
      { id: 'lock', title: 'Get both decks lined up', body: 'Match the speed and line up the dots, like in your first mix.', done: locked },
      { id: 'drift', title: 'Push B out on purpose', body: 'Give deck B\'s wheel a firm spin so the dots move apart.', done: (s) => s.did.has('driftOut') },
      { id: 'back', title: 'Bring it back with small spins', body: 'Little touches only. Hold the dots together for 2 seconds.', key: '← →', done: (s) => s.did.has('jog') && locked(s) },
    ],
  },
  {
    id: 'phrase', tier: 'novice', title: 'Start on the "1"', minutes: 4,
    why: 'Beats lined up is good. Bars lined up, so both tracks hit their big "1" together, is what makes a mix sound planned.',
    steps: [
      { id: 'lock', title: 'Line up the beats', body: 'Both decks playing, speeds matched, dots together.', done: locked },
      { id: 'ones', title: 'Line up the big dots', body: 'If the big "1" dots are apart, press B\'s Start button on A\'s "1", then nudge back in.', done: (s) => locked(s) && s.barOffset === 0 },
    ],
  },
  {
    id: 'phrasing', tier: 'novice', title: 'Mix on the phrase', minutes: 4,
    why: 'Tracks change every 16 bars. Starting the next track at the top of a phrase makes the change feel natural.',
    steps: [
      { id: 'play', title: 'Play deck A and watch the bar counter', body: 'The counter shows the bar and phrase. A phrase is 16 bars.', done: (s) => s.left.playing },
      { id: 'start', title: 'Start deck B on a new phrase', body: 'Press play on B right as deck A reaches bar 1 of a phrase (bar 17, 33, 49…).', key: 'P', done: (s) => s.did.has('phraseStart') },
    ],
    needs: 'barCounter',
  },
  {
    id: 'bass-swap', tier: 'novice', title: 'The bass swap', minutes: 5,
    why: 'Two basslines at once sound muddy. Swap them over in one move and the mix stays clean.',
    needs: 'bassEQ',
    steps: [
      { id: 'cut', title: 'Cut deck B\'s bass', body: 'Turn B\'s Bass dial all the way down, or press its Cut button.', done: (s) => s.right.eqLow <= -25 },
      { id: 'blend', title: 'Bring B in to the middle', body: 'Line up the beats, then move the crossfader to the middle. You hear B\'s drums but not its bass.', done: (s) => locked(s) && s.xfader >= 0.4 && s.xfader <= 0.65 && s.right.eqLow <= -25 },
      { id: 'swap', title: 'Swap the bass on a "1"', body: 'At the same moment: B\'s bass back up, A\'s bass cut.', done: (s) => s.right.eqLow > -6 && s.left.eqLow <= -25 },
      { id: 'out', title: 'Finish the mix', body: 'Slide the crossfader all the way to B.', done: (s) => s.xfader >= 0.95 },
    ],
  },
  {
    id: 'keys', tier: 'novice', title: 'Mix in key', minutes: 4,
    why: 'Tracks in matching keys blend without clashing notes. The coloured key badges show which ones fit.',
    steps: [
      { id: 'pick', title: 'Pick a track in a matching key', body: 'With A loaded, choose a B whose key badge is the same or next to A\'s (a "Great match").', action: 'music', done: (s) => s.right.loaded && s.keyScore >= 0.85 },
      { id: 'mix', title: 'Mix it in', body: 'Match, line up and crossfade. Listen for how the melodies fit together.', done: (s) => locked(s) && s.keyScore >= 0.85 && s.xfader >= 0.95 },
    ],
  },
  {
    id: 'ears', tier: 'novice', title: 'Beatmatch by ear', minutes: 6,
    why: 'Club gear doesn\'t show you a beat lane. Train your ears now and you can play anywhere.',
    hidesLane: true,
    steps: [
      { id: 'playboth', title: 'Play both decks, speeds matched', body: 'The beat lane is hidden for this lesson. Use your ears: listen to the kick drums.', done: (s) => both(s) && matched(s) },
      { id: 'check', title: 'Line them up, then check', body: 'When the kicks sound like one, press Check my beats. You need to be within 15 ms.', key: 'C', done: (s) => s.did.has('checkOk') },
    ],
  },
  {
    id: 'smooth', tier: 'novice', title: 'A smooth, long blend', minutes: 5,
    why: 'Fast cuts are a style, but a long blend shows control. Take at least 8 bars to cross over.',
    steps: [
      { id: 'lock', title: 'Line up both decks', body: 'Crossfader on A, both playing and lined up.', done: (s) => locked(s) && s.xfader <= 0.1 },
      { id: 'blend', title: 'Cross over over 8 bars or more', body: 'Move the crossfader slowly to B. We time it for you.', done: (s) => s.did.has('slowBlend') },
    ],
  },
];

export const lessonById = (id) => LESSONS.find((l) => l.id === id) || LESSONS[0];

/** Tick off steps in order. Returns the new set of ticked step ids. */
export function advanceLesson(lesson, s, ticked = new Set()) {
  const out = new Set(ticked);
  for (const st of lesson.steps) {
    if (out.has(st.id)) continue;
    if (st.done(s)) out.add(st.id); else break;
  }
  return out;
}

/** Index of the step to do next (steps.length when the lesson is finished). */
export const stepIndex = (lesson, ticked) => { const i = lesson.steps.findIndex((st) => !ticked.has(st.id)); return i < 0 ? lesson.steps.length : i; };

/** The lesson to suggest after this one, or null at the end of the course. */
export function nextLesson(id, completed = []) {
  const i = LESSONS.findIndex((l) => l.id === id);
  return LESSONS.slice(i + 1).find((l) => !completed.includes(l.id)) || LESSONS.find((l) => !completed.includes(l.id) && l.id !== id) || null;
}

/** "3 of 11 lessons", per tier and overall. */
export function courseProgress(completed = []) {
  const done = new Set(completed);
  return {
    done: LESSONS.filter((l) => done.has(l.id)).length,
    total: LESSONS.length,
    tiers: TIERS.map((t) => ({ ...t, done: LESSONS.filter((l) => l.tier === t.id && done.has(l.id)).length, total: LESSONS.filter((l) => l.tier === t.id).length })),
  };
}

export { ALIGN_MS };
