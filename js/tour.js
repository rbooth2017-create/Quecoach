// The first-run tour: a short, skippable walk round the screen. It points things out; the lessons teach.
// DOM-free: the stop list, which stops apply at a level, and the done / restart state. learn.js draws it.
import { featuresFor } from './levels.js';

/**
 * Stops in order. target: a CSS selector for the area to highlight (the first visible match wins).
 * needs: a feature from levels.js that must be on at the user's level for the stop to show.
 */
export const STOPS = [
  { id: 'deckA', target: '#deck-left', title: 'Your decks', text: 'Two decks, A and B, each play one track. Play, go back to the start, and spin the wheel to move through the music.' },
  { id: 'speed', target: '#deck-left .pitch, #deck-right .pitch', title: 'The speed fader', text: 'Slide it to make a track faster or slower, so two tracks play at the same speed. That\'s beatmatching.' },
  { id: 'keylock', target: '#deck-left [data-a="keylock"], #deck-right [data-a="keylock"]', needs: 'keyLock', title: 'Key lock', text: 'With Key on, changing the speed keeps the track in tune. Turn it off to hear the pitch rise and fall, like a record.' },
  { id: 'lane', target: '#lanePanel', needs: 'beatLane', title: 'The beat lane', text: 'Both tracks\' beats, side by side. When the big dots line up, your tracks are in time.' },
  { id: 'mixer', target: '#mixer', title: 'The mixer', text: 'The crossfader at the bottom moves the sound from A to B. Listen lets you hear a deck before the room does.' },
  { id: 'library', target: '#library', title: 'Your music', text: 'Pick a track and press A or B to load it, or + to add it to your set. Suggested shows tracks that mix well with what\'s playing.' },
  { id: 'panel', target: '#tutor', title: 'Lessons, Track and Set', text: 'Lessons teach you step by step. Track shows how the loaded song is built and where to mix. Set plans a whole set.' },
  { id: 'record', target: '#recBtn', title: 'Record your mix', text: 'Press Record (or R) to record what the room hears, and save it when you stop. Every mix also gets a short clip you can play back from its report.' },
  { id: 'controller', target: '#ctlBtn', title: 'Controller and headphones', text: 'Plug in a DJ controller and it runs the decks. Click here to set up its headphone socket and test your speakers and headphones.' },
  { id: 'level', target: '#levelBtn', title: 'Your level', text: 'As you get better, move up a level. The coaching fades away and more of the mixer appears.' },
  { id: 'ai', target: '#aiBtn', title: 'AI coach', text: 'Add your own Anthropic API key and the AI coach builds sets and picks your next track, with a reason for each.' },
  { id: 'help', target: '#helpBtn', title: 'Help is here', text: 'Take this tour again, read how songs are built, or see the keyboard shortcuts.' },
];

/** The stops for a level, leaving out anything that level doesn't show. isVisible(stop) lets the page drop stops whose area is hidden. */
export function stopsFor(level, isVisible = () => true) {
  const f = featuresFor(level);
  return STOPS.filter((s) => (!s.needs || f[s.needs]) && isVisible(s));
}

/** Move through the tour. Returns the new index, or -1 when it's over. */
export function step(i, dir, count) {
  const n = i + dir;
  if (n < 0) return 0;
  return n >= count ? -1 : n;
}

/** Start on its own only once: after the welcome screen, when a music source is chosen. */
export const shouldAutoStart = ({ done, hasSource, welcomeOpen }) => !done && !!hasSource && !welcomeOpen;

/** "3 of 8" */
export const progressLabel = (i, count) => `${i + 1} of ${count}`;
