// The computer keyboard as a DJ controller: every action, its default key, and your own changes. DOM-free.
// A key is written as a "combo": the key in lower case ('q', 'arrowup', '1', '[') with 'shift+' in front for a
// shifted letter or digit. Symbols keep the character they type ('?'), so a layout's Shift symbols still work.

export const GROUPS = [['a', 'Deck A'], ['b', 'Deck B'], ['mix', 'Mixer'], ['app', 'App']];

/** id → { name, group, hold (fires on key down and up), def (default combo) } */
export const ACTIONS = {
  'a.play': { name: 'Play / pause', group: 'a', def: 'q' },
  'a.cue': { name: 'CUE (hold to preview)', group: 'a', def: 'w', hold: true },
  'a.slower': { name: 'Slower (Shift: bigger step)', group: 'a', def: 'a' },
  'a.faster': { name: 'Faster (Shift: bigger step)', group: 'a', def: 's' },
  'a.back': { name: 'Nudge back', group: 'a', def: 'z', hold: true },
  'a.ahead': { name: 'Nudge ahead', group: 'a', def: 'x', hold: true },
  'a.loop': { name: 'Loop 4 beats on / off', group: 'a', def: 'e' },
  'a.cue1': { name: 'Hot cue 1', group: 'a', def: '1' },
  'a.cue2': { name: 'Hot cue 2', group: 'a', def: '2' },
  'a.cue3': { name: 'Hot cue 3', group: 'a', def: '3' },
  'a.cue4': { name: 'Hot cue 4', group: 'a', def: '4' },
  'a.load': { name: 'Load the selected track', group: 'a', def: 'shift+q' },
  'b.play': { name: 'Play / pause', group: 'b', def: 'p' },
  'b.cue': { name: 'CUE (hold to preview)', group: 'b', def: 'o', hold: true },
  'b.slower': { name: 'Slower (Shift: bigger step)', group: 'b', def: 'arrowdown' },
  'b.faster': { name: 'Faster (Shift: bigger step)', group: 'b', def: 'arrowup' },
  'b.back': { name: 'Nudge back', group: 'b', def: 'arrowleft', hold: true },
  'b.ahead': { name: 'Nudge ahead', group: 'b', def: 'arrowright', hold: true },
  'b.loop': { name: 'Loop 4 beats on / off', group: 'b', def: 'i' },
  'b.cue1': { name: 'Hot cue 1', group: 'b', def: '7' },
  'b.cue2': { name: 'Hot cue 2', group: 'b', def: '8' },
  'b.cue3': { name: 'Hot cue 3', group: 'b', def: '9' },
  'b.cue4': { name: 'Hot cue 4', group: 'b', def: '0' },
  'b.load': { name: 'Load the selected track', group: 'b', def: 'shift+p' },
  'mix.xleft': { name: 'Crossfader towards A', group: 'mix', def: '[' },
  'mix.xright': { name: 'Crossfader towards B', group: 'mix', def: ']' },
  'app.search': { name: 'Search your music', group: 'app', def: '/' },
  'app.pane': { name: 'Show or hide the side panel', group: 'app', def: 'l' },
  'app.record': { name: 'Start or stop recording', group: 'app', def: 'r' },
  'app.check': { name: 'Check your beats (by ear)', group: 'app', def: 'c' },
  'app.help': { name: 'Keyboard shortcuts', group: 'app', def: '?' },
};
export const ACTION_IDS = Object.keys(ACTIONS);
/** Keys that can't be bound: they belong to text fields, dialogs and the system. */
const RESERVED = new Set(['escape', 'tab', 'enter', ' ', 'backspace', 'delete', 'meta', 'control', 'alt', 'shift', 'capslock']);

/** The combo for a keyboard event (or null for modifier-only and Ctrl/Cmd/Alt shortcuts, which stay the system's). */
export function comboOf(e) {
  if (!e || e.metaKey || e.ctrlKey || e.altKey || !e.key) return null;
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key.toLowerCase();
  if (RESERVED.has(k)) return null;
  const shiftable = /^[a-z0-9]$/.test(k) && e.code && /^(Key|Digit)/.test(e.code);
  // Shift+1 types '!' on most layouts: use the physical digit, so 'shift+1' works everywhere
  if (e.shiftKey && e.code && /^Digit\d$/.test(e.code)) return `shift+${e.code.slice(5)}`;
  return e.shiftKey && shiftable ? `shift+${k}` : k;
}

/** Your keys: the defaults with your changes over them ({ id: combo }, '' = no key). */
export function loadKeys(saved) {
  const s = saved && typeof saved === 'object' ? saved : {};
  return Object.fromEntries(ACTION_IDS.map((id) => [id, typeof s[id] === 'string' ? s[id] : ACTIONS[id].def]));
}
/** Only what differs from the defaults (what gets saved). */
export function changedKeys(keys) {
  return Object.fromEntries(ACTION_IDS.filter((id) => keys[id] !== ACTIONS[id].def).map((id) => [id, keys[id]]));
}

/**
 * The action for a combo. Arrows and letters with Shift also match their unshifted binding, so Shift can mean
 * "bigger step" for the speed keys. Returns { id, shift } or null.
 */
export function actionFor(keys, combo) {
  if (!combo) return null;
  const hit = ACTION_IDS.find((id) => keys[id] === combo);
  if (hit) return { id: hit, shift: false };
  if (combo.startsWith('shift+')) { const base = combo.slice(6), id = ACTION_IDS.find((x) => keys[x] === base); if (id) return { id, shift: true }; }
  return null;
}
/** Shift+arrow arrives as the plain arrow with shiftKey set: find the action and say Shift was down. */
export function actionForEvent(keys, e) {
  const a = actionFor(keys, comboOf(e));
  return a && e.shiftKey && !a.shift && !/^shift\+/.test(keys[a.id]) ? { ...a, shift: true } : a;
}

/** Give an action a new key. Anything else on that key loses it (it's yours now). Returns { keys, freed: [ids] }. */
export function rebind(keys, id, combo) {
  if (!ACTIONS[id]) return { keys, freed: [] };
  const next = { ...keys }, freed = [];
  if (combo) for (const other of ACTION_IDS) if (other !== id && next[other] === combo) { next[other] = ''; freed.push(other); }
  next[id] = combo || '';
  return { keys: next, freed };
}

const NAMES = { arrowup: '↑', arrowdown: '↓', arrowleft: '←', arrowright: '→', ' ': 'Space', pageup: 'Page Up', pagedown: 'Page Down', home: 'Home', end: 'End' };
/** How a combo is shown on a key cap: 'shift+q' → ['Shift', 'Q']. */
export function keyLabel(combo) {
  if (!combo) return [];
  const parts = combo.split('+').filter(Boolean);
  if (combo.endsWith('++')) parts.push('+');
  return parts.map((p) => (p === 'shift' ? 'Shift' : NAMES[p] || (p.length === 1 ? p.toUpperCase() : p[0].toUpperCase() + p.slice(1))));
}
