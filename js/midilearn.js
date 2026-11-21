// "Map my controller": learn any MIDI controller by asking the DJ to press or move each control in turn.
// Builds a profile in the same shape as controllers.js, so the rest of the app treats it like a built-in one.
// DOM-free.

/** The controls to learn, in order. kind: 'button' (press), 'knob' (turn or slide), 'jog' (spin). */
export const LEARN_STEPS = [
  ...['1', '2'].flatMap((n) => {
    const deck = n === '1' ? 'deck A (left)' : 'deck B (right)';
    return [
      { id: `d${n}.play`, kind: 'button', title: `Play on ${deck}`, text: 'Press the PLAY button.' },
      { id: `d${n}.cue`, kind: 'button', title: `Cue on ${deck}`, text: 'Press the CUE button.' },
      { id: `d${n}.jog`, kind: 'jog', title: `Jog wheel on ${deck}`, text: 'Turn the jog wheel a little, by its side.' },
      { id: `d${n}.tempo`, kind: 'knob', title: `Tempo on ${deck}`, text: 'Push the tempo slider all the way up (away from you), then pull it down.' },
      { id: `d${n}.fader`, kind: 'knob', title: `Channel fader on ${deck}`, text: 'Move the channel fader up and down.' },
      { id: `d${n}.hi`, kind: 'knob', title: `Treble (HI) on ${deck}`, text: 'Turn the HI knob.' },
      { id: `d${n}.mid`, kind: 'knob', title: `Mid on ${deck}`, text: 'Turn the MID knob.' },
      { id: `d${n}.low`, kind: 'knob', title: `Bass (LOW) on ${deck}`, text: 'Turn the LOW knob.' },
      { id: `d${n}.headphones`, kind: 'button', title: `Headphone cue on ${deck}`, text: 'Press the headphone (CUE) button for this channel.' },
    ];
  }),
  { id: 'm.crossfader', kind: 'knob', title: 'Crossfader', text: 'Slide the crossfader from side to side.' },
  { id: 'm.headMix', kind: 'knob', title: 'Headphone mix', text: 'Turn the HEADPHONES MIX knob, if your controller has one. Skip it if not.' },
];

const isNote = (s) => (s & 0xf0) === 0x90 || (s & 0xf0) === 0x80;
const isCC = (s) => (s & 0xf0) === 0xb0;

/**
 * Work out one control from the messages that came in while the DJ used it. msgs: [[status, d1, d2], ...].
 * Returns { controls: [[status, d1, name, part]], extra } or null if nothing usable came in.
 * extra: { jog: 'centered' | 'twos' } for jogs, { invertTempo } for the tempo slider.
 */
export function learnControl(step, msgs) {
  if (!msgs?.length) return null;
  if (step.kind === 'button') {
    const m = msgs.find(([s, , v]) => isNote(s) && (s & 0xf0) === 0x90 && v > 0) || msgs.find(([s, , v]) => isCC(s) && v > 0);
    if (!m) return null;
    // a button that sends CCs is stored as a note on the same channel would be wrong: keep it as it came
    return { controls: [[isCC(m[0]) ? m[0] : 0x90 | (m[0] & 0x0f), m[1], step.id, isCC(m[0]) ? '7' : 'note']] };
  }
  const ccs = msgs.filter(([s]) => isCC(s));
  if (!ccs.length) return null;
  // the CC that moved most is the control; a partner 32 higher on the same status is its fine (LSB) half
  const counts = new Map();
  for (const [s, d1] of ccs) counts.set(`${s}:${d1}`, (counts.get(`${s}:${d1}`) || 0) + 1);
  const keyOf = (s, d1) => `${s}:${d1}`;
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k.split(':').map(Number));
  let [status, d1] = sorted.find(([s, d]) => d < 32 || !counts.has(keyOf(s, d - 32))) || sorted[0];
  const vals = ccs.filter(([s, d]) => s === status && d === d1).map(([, , v]) => v);
  if (step.kind === 'jog') {
    const centered = vals.every((v) => v >= 32 && v <= 96);
    return { controls: [[status, d1, step.id, 'rel']], extra: { jog: centered ? 'centered' : 'twos' } };
  }
  const fine = d1 < 32 && counts.has(keyOf(status, d1 + 32));
  const controls = fine ? [[status, d1, step.id, 'msb'], [status, d1 + 32, step.id, 'lsb']] : [[status, d1, step.id, '7']];
  const extra = {};
  // tempo: we asked for the top first. Pioneer-style sliders send 0 at the top (top = slower).
  if (step.id.endsWith('.tempo') && vals.length >= 2) extra.invertTempo = vals[0] > 64;
  return { controls, extra };
}

/** Put the learned controls together into a controller profile. learned: { stepId: learnControl(...) }. */
export function buildProfile(deviceName, learned) {
  const controls = [], has = new Set();
  let jog = 'twos', invertTempo = false;
  for (const [id, r] of Object.entries(learned)) {
    if (!r) continue;
    controls.push(...r.controls);
    has.add(id.split('.')[1]);
    if (r.extra?.jog) jog = r.extra.jog;
    if (r.extra?.invertTempo) invertTempo = true;
  }
  return { id: `custom:${deviceName}`, name: deviceName, match: deviceName, custom: true, rekordbox: false, tempoTopIsSlower: !invertTempo, invertTempo, jog, has: [...has].sort(), controls };
}

/** How much of the controller is mapped, for the dialog. */
export const learnedCount = (learned) => Object.values(learned).filter(Boolean).length;
