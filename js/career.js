// Your DJ career: from the bedroom to the main room. Each venue sits on a skill level (js/levels.js decides
// what's on screen); a good gig at one venue gets you booked at the next. DOM-free.

export const VENUES = [
  {
    id: 'bedroom', name: 'Your bedroom', level: 'starter', crowd: 3, picky: 0.6,
    who: 'Just you and whoever is listening through the wall.',
    unlocks: ['Two decks and the handover slider', 'The coach talks you through every move'],
  },
  {
    id: 'party', name: 'House party', level: 'starter', crowd: 14, picky: 0.8,
    who: 'A kitchen full of mates. About 20 people.',
    unlocks: ['A bigger crowd that notices when the beats drift', 'Your first gig poster'],
  },
  {
    id: 'basement', name: 'The Basement', level: 'improver', crowd: 24, picky: 1,
    who: 'A small bar. 60 people who came for a drink.',
    unlocks: ['Bass dial: swap the bass so two songs never clash', 'Volume dials: bring the next song in gently', 'Hot cues: jump straight to the best moments', 'Bar counter: see where you are in the song'],
  },
  {
    id: 'warehouse', name: 'Warehouse', level: 'confident', crowd: 36, picky: 1.25,
    who: 'A proper club night. 400 people.',
    unlocks: ['Match by ear: the beat lane hides until you check', 'Treble dial for cleaner blends', 'Beat FX'],
  },
  {
    id: 'main', name: 'Main room', level: 'pro', crowd: 48, picky: 1.5,
    who: 'Headline slot. 2,000 people and no coach.',
    unlocks: ['The full three-band mixer', '±16% speed, keys and numbers', 'No coaching: it\'s all you'],
  },
];

/** A gig: this many mixes with at least this many stars gets you booked at the next venue. */
export const GIG = { mixes: 3, stars: 2 };

export const venueById = (id) => VENUES.find((v) => v.id === id) || VENUES[0];
export const venueIndex = (id) => Math.max(0, VENUES.findIndex((v) => v.id === id));
export const nextVenue = (id) => VENUES[venueIndex(id) + 1] || null;

/** The first venue for a skill level (someone who picks a level by hand lands there). */
export function venueForLevel(level) {
  return VENUES.find((v) => v.level === level) || VENUES[0];
}

/** A fresh career, starting at the venue for the level you're on. */
export function newCareer(level = 'starter') {
  return { venue: venueForLevel(level).id, good: 0, mixes: 0, stars: 0, streak: 0, best: 0, offer: null };
}

/** A saved career, checked and filled in (older saves, hand edits). */
export function loadCareer(saved, level = 'starter') {
  const c = { ...newCareer(level), ...(saved && typeof saved === 'object' ? saved : {}) };
  if (!VENUES.some((v) => v.id === c.venue)) c.venue = venueForLevel(level).id;
  for (const k of ['good', 'mixes', 'stars', 'streak', 'best']) c[k] = Number.isFinite(c[k]) && c[k] > 0 ? Math.floor(c[k]) : 0;
  if (c.offer && !nextVenue(c.venue)) c.offer = null;
  if (c.offer && c.offer !== nextVenue(c.venue).id) c.offer = null;
  return c;
}

/**
 * Count one finished mix. Returns the new career; `offer` is set (the next venue's id) once the gig is
 * done, and stays until you take it. A mix under the bar doesn't undo the good ones.
 */
export function recordMix(career, stars) {
  const s = Math.max(0, Math.min(3, Math.round(stars) || 0));
  const good = s >= GIG.stars;
  const c = { ...career, mixes: career.mixes + 1, stars: career.stars + s, streak: good ? career.streak + 1 : 0 };
  c.best = Math.max(c.best, c.streak);
  if (good && !career.offer) c.good = Math.min(GIG.mixes, career.good + 1);
  const next = nextVenue(c.venue);
  if (next && c.good >= GIG.mixes) c.offer = next.id;
  return c;
}

/** Take the booking: on to the next venue with a fresh gig. */
export function takeBooking(career) {
  if (!career.offer) return career;
  return { ...career, venue: career.offer, good: 0, offer: null };
}

/** You picked a level by hand: move to that level's first venue, unless you're already at one of its venues. */
export function syncToLevel(career, level) {
  if (venueById(career.venue).level === level) return career;
  return { ...career, venue: venueForLevel(level).id, good: 0, offer: null };
}

/** How the gig at this venue is going, for the progress bars. */
export function gigProgress(career) {
  const next = nextVenue(career.venue);
  return { done: career.good, of: GIG.mixes, stars: GIG.stars, next, booked: !!career.offer, last: !next };
}
