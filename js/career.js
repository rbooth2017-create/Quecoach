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

/**
 * Each venue's brief: one skill the booker wants to hear before they book you at the next venue. It has to land in
 * one mix (a mix report part at or above `min`). The ids are mix report parts (js/mixreport.js PARTS).
 */
export const BRIEFS = {
  party: { part: 'phrase', min: 80, text: 'Bring one song in right on a phrase' },
  basement: { part: 'bass', min: 80, text: 'One bass at a time: swap the bass cleanly in one mix' },
  warehouse: { part: 'key', min: 80, text: 'Pick a song that fits: key and energy in one mix' },
};
export const briefFor = (venue) => BRIEFS[venue] || null;

/** A different small challenge every day, for a bonus. Seeded by the day, so everyone gets the same one. */
export const CHALLENGES = [
  { id: 'locked', part: 'beats', min: 90, text: 'Keep the beats locked: 90+ for "Beats in time"' },
  { id: 'ones', part: 'ones', min: 90, text: 'Line up the "1"s all the way through a mix' },
  { id: 'phrase', part: 'phrase', min: 100, text: 'Start a song exactly on a phrase' },
  { id: 'long', part: 'length', min: 100, text: 'A long blend: 12 bars or more' },
  { id: 'smooth', part: 'smooth', min: 95, text: 'No volume dips during a mix' },
  { id: 'choice', part: 'key', min: 90, text: 'Pick a perfect next song: key and energy' },
  { id: 'three', stars: 3, text: 'Get a 3-star mix' },
];
export const CHALLENGE_BONUS = 2; // stars
/** Today's challenge, from a day number (days since 1970 in local time). */
export function dailyChallenge(day) {
  const i = (((Math.floor(day) * 2654435761) >>> 0) % CHALLENGES.length);
  return CHALLENGES[i];
}
/** Local day number for a time. */
export const dayNumber = (ms = Date.now()) => Math.floor((ms - new Date(ms).getTimezoneOffset() * 60000) / 86400000);
const meets = (goal, stars, parts) => (goal.stars ? stars >= goal.stars : Number.isFinite(parts?.[goal.part]) && parts[goal.part] >= goal.min);

export const venueById = (id) => VENUES.find((v) => v.id === id) || VENUES[0];
export const venueIndex = (id) => Math.max(0, VENUES.findIndex((v) => v.id === id));
export const nextVenue = (id) => VENUES[venueIndex(id) + 1] || null;

/** The first venue for a skill level (someone who picks a level by hand lands there). */
export function venueForLevel(level) {
  return VENUES.find((v) => v.level === level) || VENUES[0];
}

/** A fresh career, starting at the venue for the level you're on. */
export function newCareer(level = 'starter') {
  return { venue: venueForLevel(level).id, good: 0, mixes: 0, stars: 0, streak: 0, best: 0, offer: null, brief: false, daily: null };
}

/** The highest level your career has earned: the level of the venue you've reached. */
export const levelCap = (career) => venueById(career?.venue).level;

/** A saved career, checked and filled in (older saves, hand edits). */
export function loadCareer(saved, level = 'starter') {
  const c = { ...newCareer(level), ...(saved && typeof saved === 'object' ? saved : {}) };
  if (!VENUES.some((v) => v.id === c.venue)) c.venue = venueForLevel(level).id;
  for (const k of ['good', 'mixes', 'stars', 'streak', 'best']) c[k] = Number.isFinite(c[k]) && c[k] > 0 ? Math.floor(c[k]) : 0;
  c.brief = !!c.brief;
  c.daily = c.daily && Number.isFinite(c.daily.day) ? { day: c.daily.day, done: !!c.daily.done } : null;
  if (c.offer && !nextVenue(c.venue)) c.offer = null;
  if (c.offer && c.offer !== nextVenue(c.venue).id) c.offer = null;
  return c;
}

/**
 * Count one finished mix. Returns the new career; `offer` is set (the next venue's id) once the gig is
 * done (enough good mixes, and the venue's brief met in one of them), and stays until you take it.
 * A mix under the bar doesn't undo the good ones.
 * parts: the mix report's part scores ({ beats: 92, … }), for the brief and the daily challenge. day: today's number.
 */
export function recordMix(career, stars, parts = null, day = null) {
  const s = Math.max(0, Math.min(3, Math.round(stars) || 0));
  const good = s >= GIG.stars;
  const c = { ...career, mixes: career.mixes + 1, stars: career.stars + s, streak: good ? career.streak + 1 : 0 };
  c.best = Math.max(c.best, c.streak);
  if (good && !career.offer) c.good = Math.min(GIG.mixes, career.good + 1);
  const brief = briefFor(c.venue);
  if (!brief || (good && meets(brief, s, parts))) c.brief = true;
  c.challenge = null;
  if (day != null) {
    const daily = c.daily?.day === day ? c.daily : { day, done: false };
    if (!daily.done && meets(dailyChallenge(day), s, parts)) { c.daily = { day, done: true }; c.stars += CHALLENGE_BONUS; c.challenge = dailyChallenge(day); }
    else c.daily = daily;
  }
  const next = nextVenue(c.venue);
  if (next && c.good >= GIG.mixes && c.brief) c.offer = next.id;
  return c;
}

/** Take the booking: on to the next venue with a fresh gig. */
export function takeBooking(career) {
  if (!career.offer) return career;
  return { ...career, venue: career.offer, good: 0, offer: null, brief: false };
}

/** You picked a level by hand: move to that level's first venue, unless you're already at one of its venues. */
export function syncToLevel(career, level) {
  if (venueById(career.venue).level === level) return career;
  return { ...career, venue: venueForLevel(level).id, good: 0, offer: null, brief: false };
}

/** How the gig at this venue is going, for the progress bars. */
export function gigProgress(career) {
  const next = nextVenue(career.venue);
  const brief = briefFor(career.venue);
  return { done: career.good, of: GIG.mixes, stars: GIG.stars, next, booked: !!career.offer, last: !next, brief, briefDone: !brief || !!career.brief };
}
