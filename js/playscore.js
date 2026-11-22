// The Play view's game feel: stars for a mix, how locked the two beats are, which way to move the speed,
// and the crowd's vibe. DOM-free, so it's unit-tested.

/** Stars for a mix report score (0..100). */
export function starsFor(score) {
  return score >= 90 ? 3 : score >= 75 ? 2 : score >= 55 ? 1 : 0;
}

export const LOCK = { bpm: 0.1, ms: 25, farBpm: 3, farMs: 120 };

/**
 * How locked the two beats are, 0..1, from the speed difference (BPM) and, when both play, the beat offset (ms).
 * 1 = locked (within the lesson's limits), 0 = far apart. Speed counts more until both decks are playing.
 */
export function lockAmount(bpmDiff, offsetMs = null) {
  if (bpmDiff == null || !Number.isFinite(bpmDiff)) return 0;
  const sp = Math.abs(bpmDiff) <= LOCK.bpm ? 1 : Math.max(0, 1 - (Math.abs(bpmDiff) - LOCK.bpm) / (LOCK.farBpm - LOCK.bpm));
  if (offsetMs == null || !Number.isFinite(offsetMs)) return sp; // not heard together yet: the speed is all there is to match
  const ph = Math.abs(offsetMs) <= LOCK.ms ? 1 : Math.max(0, 1 - (Math.abs(offsetMs) - LOCK.ms) / (LOCK.farMs - LOCK.ms));
  return Math.min(sp, 0.35 + 0.65 * ph) * (sp >= 1 ? 1 : 0.9);
}

/**
 * What to tell a beginner about the incoming deck's speed. diff = incoming BPM − playing BPM.
 * Returns { dir: 'faster' | 'slower' | null, text }.
 */
export function speedAdvice(diff) {
  if (diff == null || !Number.isFinite(diff)) return { dir: null, text: 'Load a song on both sides to compare.' };
  const a = Math.abs(diff);
  if (a <= LOCK.bpm) return { dir: null, text: 'Same speed. Now line up the beats.' };
  const dir = diff < 0 ? 'faster' : 'slower';
  const how = a < 0.5 ? 'a touch' : a < 2 ? 'a little' : 'quite a bit';
  return { dir, text: `Up next is ${how} ${diff < 0 ? 'slow' : 'fast'}. Tap ${dir === 'faster' ? 'Faster' : 'Slower'}.` };
}

/**
 * Which way to push the incoming deck's beats once the speeds match: offsetMs > 0 means the incoming deck is ahead.
 * Returns { dir: 'back' | 'ahead' | null, text }.
 */
export function nudgeAdvice(offsetMs) {
  if (offsetMs == null || !Number.isFinite(offsetMs)) return { dir: null, text: '' };
  if (Math.abs(offsetMs) <= LOCK.ms) return { dir: null, text: 'Locked together.' };
  return offsetMs > 0 ? { dir: 'back', text: 'A little ahead: push it back.' } : { dir: 'ahead', text: 'A little behind: push it ahead.' };
}

/**
 * The crowd's vibe, 0..1, one frame on. now: { audible (the room hears music), clash (two audible decks with beats
 * apart), locked (two audible decks, beats together) }, picky: the venue (bigger rooms react faster).
 */
export function vibeStep(vibe, now, dt, picky = 1) {
  let rate;
  if (!now.audible) rate = -0.12;           // silence empties the floor
  else if (now.clash) rate = -0.08;         // a trainwreck
  else if (now.locked) rate = 0.05;         // a clean blend lifts the room
  else rate = vibe < 0.6 ? 0.03 : -0.005;   // music on: drifts to "nodding along"
  const k = rate < 0 ? picky : 1 / Math.max(0.5, picky);
  return Math.max(0, Math.min(1, vibe + rate * k * dt));
}

export function vibeWords(vibe, crowdSize = 3) {
  const few = crowdSize <= 4;
  if (vibe >= 0.85) return few ? 'Your mates are dancing.' : 'The floor is packed.';
  if (vibe >= 0.6) return few ? 'Your mates are nodding along.' : 'Busy and happy.';
  if (vibe >= 0.35) return few ? 'Someone checked their phone.' : 'A few people are drifting off.';
  return few ? 'It\'s gone quiet in here.' : 'The floor is emptying.';
}
