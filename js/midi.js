// Web MIDI: listen to the DJ controller (works alongside rekordbox — macOS lets several apps read one controller).
export const ACTIONS = [
  ['A.play', 'Deck A play'], ['A.tempo', 'Deck A tempo fader'], ['A.jog', 'Deck A jog wheel'], ['A.low', 'Deck A low EQ'], ['A.vol', 'Deck A volume'],
  ['B.play', 'Deck B play'], ['B.tempo', 'Deck B tempo fader'], ['B.jog', 'Deck B jog wheel'], ['B.low', 'Deck B low EQ'], ['B.vol', 'Deck B volume'],
  ['xfader', 'Crossfader'],
];
const KEY = 'cuecoach.midimap';
let map = {};
try { map = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { map = {}; }
let learning = null, handler = () => {}, monitor = () => {};
export let inputs = [];
const rawListeners = [], deviceListeners = [];
/** Every incoming message: cb(bytes, deviceName). */
export function onRaw(cb) { rawListeners.push(cb); }
/** Called with the list of input names whenever devices change. */
export function onDevices(cb) { deviceListeners.push(cb); cb(inputs.map((i) => i.name)); }
let accessPromise = null;

const sig = (d) => `${(d[0] & 0xf0) === 0x80 ? 0x90 : d[0] & 0xf0}:${d[0] & 0x0f}:${d[1]}`;

export async function initMIDI(onAction, onMonitor) {
  if (onAction) handler = onAction;
  if (onMonitor) monitor = onMonitor;
  if (!navigator.requestMIDIAccess) throw new Error('This browser has no Web MIDI — use Chrome or Edge.');
  accessPromise ??= navigator.requestMIDIAccess().then((access) => {
    const bind = () => {
      inputs = [...access.inputs.values()].filter((i) => i.state !== 'disconnected');
      for (const inp of inputs) inp.onmidimessage = (e) => onMessage(e.data, inp.name);
      for (const l of deviceListeners) l(inputs.map((i) => i.name));
    };
    access.onstatechange = bind; bind();
    return access;
  });
  accessPromise.catch(() => { accessPromise = null; });
  await accessPromise;
  return inputs.map((i) => i.name);
}

function onMessage(d, device) {
  if (d.length < 3) return;
  for (const l of rawListeners) l(d, device);
  const type = d[0] & 0xf0;
  if (type !== 0x90 && type !== 0x80 && type !== 0xb0) return;
  monitor(`${device}: ${type === 0xb0 ? 'CC' : 'Note'} ch${(d[0] & 15) + 1} #${d[1]} = ${d[2]}`);
  const s = sig(d);
  if (learning) {
    if (type === 0x80 || (type === 0x90 && d[2] === 0)) return; // learn on press, not release
    map[learning.action] = s; localStorage.setItem(KEY, JSON.stringify(map));
    const l = learning; learning = null; l.resolve(s); return;
  }
  for (const [action, m] of Object.entries(map)) {
    if (m !== s) continue;
    const pressed = type === 0x90 && d[2] > 0;
    handler(action, { value: d[2] / 127, raw: d[2], pressed, rel: d[2] < 64 ? d[2] : d[2] - 128 });
  }
}

export function learn(action) { return new Promise((resolve) => { learning = { action, resolve }; }); }
export function binding(action) { return map[action] || null; }
export function clearBinding(action) { delete map[action]; localStorage.setItem(KEY, JSON.stringify(map)); }
