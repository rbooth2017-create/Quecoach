// Start again: wipe the game progress (level, career, lessons, mix scores, expansion pack saves) and keep
// what took effort to set up: the music library, cue points, sets, settings, keys, controller maps and AI key.

/** Progress keys under learn.* that "Start again" removes. */
export const PROGRESS_KEYS = [
  'level', 'career', 'cleanMixes', 'completed', 'lesson', 'mixHistory', 'lastReport', 'tourDone', 'djName',
];
/** Expansion pack saves (learn.pack.djlife and any later pack) go too. */
const PACK_SAVE = /^learn\.pack\./;

/** Which localStorage keys a reset removes, given every key there is. */
export function progressKeysIn(allKeys) {
  const mine = new Set(PROGRESS_KEYS.map((k) => `learn.${k}`));
  return allKeys.filter((k) => mine.has(k) || PACK_SAVE.test(k));
}

/** Remove the progress from a Storage (localStorage). Returns how many keys went. */
export function resetProgress(storage = globalThis.localStorage) {
  try {
    const all = []; for (let i = 0; i < storage.length; i++) all.push(storage.key(i));
    const gone = progressKeysIn(all);
    for (const k of gone) storage.removeItem(k);
    return gone.length;
  } catch { return 0; } // private mode
}
