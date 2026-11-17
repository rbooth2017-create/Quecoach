// Builds js/controllers.js from Mixxx's open controller mappings (only the MIDI numbers we need).
// Run: node scripts/import-mixxx.mjs
// Source: https://github.com/mixxxdj/mixxx/tree/main/res/controllers
import { writeFileSync } from 'node:fs';

const BASE = 'https://raw.githubusercontent.com/mixxxdj/mixxx/main/res/controllers/';
const CONTROLLERS = [
  { id: 'ddj-flx4', name: 'Pioneer DDJ-FLX4', file: 'Pioneer-DDJ-FLX4.midi.xml', match: 'FLX4', rekordbox: true, tempoTopIsSlower: true },
  { id: 'ddj-400', name: 'Pioneer DDJ-400', file: 'Pioneer-DDJ-400.midi.xml', match: 'DDJ-400', rekordbox: true, tempoTopIsSlower: true },
  { id: 'ddj-200', name: 'Pioneer DDJ-200', file: 'Pioneer DDJ-200.midi.xml', match: 'DDJ-200', rekordbox: true, tempoTopIsSlower: true },
  { id: 'ddj-sb3', name: 'Pioneer DDJ-SB3', file: 'Pioneer-DDJ-SB3.midi.xml', match: 'SB3', rekordbox: false, tempoTopIsSlower: true },
  { id: 'inpulse-200', name: 'Hercules DJControl Inpulse 200', file: 'Hercules_DJControl_Inpulse_200.midi.xml', match: 'Inpulse 200', rekordbox: false, tempoTopIsSlower: true },
  { id: 'inpulse-300', name: 'Hercules DJControl Inpulse 300', file: 'Hercules_DJControl_Inpulse_300.midi.xml', match: 'Inpulse 300', rekordbox: false, tempoTopIsSlower: true },
  { id: 'inpulse-500', name: 'Hercules DJControl Inpulse 500', file: 'Hercules_DJControl_Inpulse_500.midi.xml', match: 'Inpulse 500', rekordbox: false, tempoTopIsSlower: true },
  { id: 'mixtrack-3', name: 'Numark Mixtrack 3', file: 'Numark-Mixtrack-3.midi.xml', match: 'Mixtrack 3', rekordbox: false, tempoTopIsSlower: true },
];

const tag = (xml, t) => (xml.match(new RegExp(`<${t}>([\\s\\S]*?)</${t}>`)) || [])[1]?.trim() ?? '';

/** Mixxx group + key (+ description) → our control name ('d1.fader', 'm.crossfader', …) or null. */
function target(group, key, desc, isCC) {
  const k = key.toLowerCase(), all = `${k} ${desc.toLowerCase()}`;
  if (/shift|hotcue|hot-cue|sampler|loop|beatjump|pad|browse|load|fx|effect ?unit|vinyl mode|slip|censor|key ?lock|master ?level|headphones level|headgain|samples?/.test(all.replace(/quickeffect|equalizer/g, ''))) return null;
  let deck = (group.match(/Channel([12])\]/) || [])[1];
  deck = deck ? +deck : null;
  if (/^\[(Master|Mixer|Mixer Profile)\]$/.test(group)) {
    if (/crossfader(?!.*(enable|curve))/.test(k)) return 'm.crossfader';
    if (/headmix|cue mix/.test(all)) return 'm.headMix';
    return null;
  }
  if (!deck) return null;
  // EQ: Mixxx parameter1/2/3 or script eqKnob[1..3] = low/mid/high
  const eqn = (k.match(/parameter([123])$/) || k.match(/eqknob\[([123])\]/) || [])[1];
  if (eqn || /equalizer/i.test(group) || /eq ?knob|\beq\b/.test(all)) {
    const n = eqn || (/\blow\b/.test(all) ? 1 : /\bmid\b/.test(all) ? 2 : /\bhi(gh)?\b/.test(all) ? 3 : null);
    return n ? `d${deck}.${{ 1: 'low', 2: 'mid', 3: 'hi' }[n]}` : null;
  }
  if (/quickeffect|filterknob|super1|\bfilter\b/.test(all)) return `d${deck}.filter`;
  if (/jog|wheel|platter/.test(all)) return isCC && !/touch/.test(all) ? `d${deck}.jog` : null;
  if (/tempo|pitchfader|pitch fader|pitch slider/.test(all) || /(^|[._])rate(msb|lsb)?$/.test(k)) return `d${deck}.tempo`;
  if (/pfl|headphonecue|headphone cue|toggles headphone/.test(all)) return `d${deck}.headphones`;
  if (/sync/.test(all)) return /long|set as (master|leader)|leader|key ?sync/.test(all) ? null : `d${deck}.sync`;
  if (/cue_default|cuebutton|cue button|(^|\.)cue(_gotoandplay)?($|\.)|\bcue \(deck|set\/call cue/.test(all)) return `d${deck}.cue`;
  if (/playbutton|play\/pause|(^|\.)play($|\.)|play button/.test(all)) return `d${deck}.play`;
  if (/pregain|gainknob|\btrim\b|\bgain deck/.test(all)) return `d${deck}.trim`;
  if (/volume|deckfader|channel ?fader|line fader/.test(all)) return `d${deck}.fader`;
  return null;
}

async function convert(c) {
  const xml = await (await fetch(BASE + encodeURIComponent(c.file))).text();
  const controls = [];
  const seen = new Set();
  for (const m of xml.matchAll(/<control>([\s\S]*?)<\/control>/g)) {
    const body = m[1];
    const status = parseInt(tag(body, 'status'), 16), data1 = parseInt(tag(body, 'midino'), 16);
    const isCC = (parseInt(tag(body, 'status'), 16) & 0xf0) === 0xb0;
    const name = target(tag(body, 'group'), tag(body, 'key'), tag(body, 'description'), isCC);
    if (!name || Number.isNaN(status) || Number.isNaN(data1)) continue;
    const key = tag(body, 'key');
    let part = isCC ? '7' : 'note';
    const said = `${key} ${tag(body, 'description')}`;
    if (/fourteen-bit-msb/i.test(body) || /msb|highvalue|main bits/i.test(said)) part = 'msb';
    if (/fourteen-bit-lsb/i.test(body) || /lsb|lowvalue|precision bits/i.test(said)) part = 'lsb';
    const jog = name.endsWith('.jog');
    if (jog && !isCC) continue; // jog touch, not turn
    const id = `${status}:${data1}`;
    if (seen.has(id)) continue;
    seen.add(id);
    controls.push([status, data1, name, jog ? 'rel' : part]);
  }
  // keep only the first MSB/7-bit source per control (others are usually shifted duplicates)
  const firstFor = new Map();
  const kept = controls.filter(([s, d, name, part]) => {
    if (part === 'note' || part === 'rel' || name.endsWith('.play') || name.endsWith('.cue')) return true;
    const k = `${name}:${part}`;
    if (firstFor.has(k)) return false;
    firstFor.set(k, true); return true;
  });
  // an LSB must belong to a kept MSB of the same control
  const msbs = new Map(kept.filter((x) => x[3] === 'msb').map((x) => [x[2], x]));
  const final = kept.filter((x) => x[3] !== 'lsb' || msbs.has(x[2]));
  const have = [...new Set(final.map((x) => x[2].split('.')[1]))].sort();
  return { id: c.id, name: c.name, match: c.match, rekordbox: c.rekordbox, tempoTopIsSlower: c.tempoTopIsSlower, has: have, controls: final };
}

const out = [];
for (const c of CONTROLLERS) {
  const p = await convert(c);
  console.log(`${p.name}: ${p.controls.length} controls — ${p.has.join(', ')}`);
  out.push(p);
}
writeFileSync(new URL('../js/controllers.js', import.meta.url), `// Generated by scripts/import-mixxx.mjs — do not edit by hand.
// MIDI numbers taken from the Mixxx project's controller mappings
// (https://github.com/mixxxdj/mixxx/tree/main/res/controllers, GPL-2.0-or-later).
// controls: [status, data1, control, part] — part: 'msb' | 'lsb' | '7' (7-bit) | 'note' | 'rel' (jog, relative)
export const CONTROLLERS = ${JSON.stringify(out, null, 0).replace(/\],\[/g, '],\n  [')};
`);
