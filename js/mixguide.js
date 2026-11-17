// The beginner mixing routine: checks before you start, then steps in order.
// DOM-free. Each step can tick itself from the DDJ-FLX4 (auto) or be ticked by hand.
//
// Order follows common beginner guides: prepare the next deck silently (fader down, EQ flat,
// headphones), cue the first beat, match tempo, start on a phrase, match level with TRIM
// while the EQ is still flat, then cut the bass, fade in, swap the bass on a phrase, fade out.
import { keyRelation } from './library.js';
import { pitchNeeded } from './engine.js';

const near = (v, target, tol) => v != null && Math.abs(v - target) <= tol;
const CENTER = 64 / 127; // 12 o'clock on a 7-bit knob

/** Live BPM of a deck: the track's BPM moved by its tempo slider (if we can read it). */
export function deckBpm(track, tempoPct) {
  if (!track?.bpm) return null;
  return track.bpm * (1 + (tempoPct ?? 0) / 100);
}

/**
 * "Do these two tracks mix?" — the tick boxes at the top of the page.
 * Each: { id, label, ok: true | false | null (unknown), detail }
 */
export function compatChecks(live, next, { liveTempo = null, nextTempo = null, tempoRange = 10 } = {}) {
  if (!live || !next) return [];
  const checks = [];
  const liveBpm = deckBpm(live, liveTempo), nextBase = next.bpm || null;
  if (!liveBpm || !nextBase) {
    checks.push({ id: 'bpm-range', label: 'Tempos are close enough', ok: null, detail: 'One track has no BPM — analyse it in rekordbox.' });
  } else {
    const p = pitchNeeded(liveBpm, nextBase);
    const ok = Math.abs(p.pct) <= tempoRange * 0.8;
    checks.push({
      id: 'bpm-range', label: 'Tempos are close enough', ok,
      detail: ok ? `${nextBase.toFixed(1)} → ${liveBpm.toFixed(1)} BPM needs ${p.pct >= 0 ? '+' : ''}${p.pct.toFixed(1)}% on the tempo slider${p.mode !== '1x' ? ` (${p.mode} time)` : ''}.`
        : `${p.pct.toFixed(1)}% apart — too far for the tempo slider (±${tempoRange}%). It will sound stretched. Pick a closer track.`,
    });
    if (nextTempo != null) {
      const now = deckBpm(next, nextTempo), diff = now - liveBpm;
      checks.push({
        id: 'bpm-matched', label: 'Tempo matched', ok: Math.abs(diff) < 0.1,
        detail: Math.abs(diff) < 0.1 ? `Both at ${liveBpm.toFixed(1)} BPM.` : `Next deck is ${Math.abs(diff).toFixed(1)} BPM ${diff > 0 ? 'faster — move its tempo slider up' : 'slower — move its tempo slider down'}.`,
      });
    }
  }
  const k = keyRelation(live.camelot, next.camelot);
  checks.push({
    id: 'key', label: 'Keys work together',
    ok: !live.camelot || !next.camelot ? null : k.score >= 0.55,
    detail: !live.camelot || !next.camelot ? 'Key unknown — turn on key analysis in rekordbox.' : `${live.camelot} → ${next.camelot}: ${k.label}.`,
  });
  if (live.energy != null && next.energy != null) {
    const d = next.energy - live.energy;
    checks.push({ id: 'energy', label: 'Energy step is gentle', ok: Math.abs(d) <= 2, detail: `Energy ${live.energy} → ${next.energy}.` });
  }
  return checks;
}

/**
 * The steps. In text: {N} = next deck number, {L} = playing deck number, {BPM} = target BPM.
 * auto(ctx) → true when the controller shows it's done; undefined when it can't tell.
 * ctx = { ctl, N, L, since(button), has(control) }  (since: pressed after the step started? has: does this controller have it?)
 * needs: the hardware control a step uses; if the controller lacks it, the page says to use rekordbox on screen.
 */
export const STEPS = [
  {
    id: 'load', title: 'Load the next track on Deck {N}',
    how: 'Pick it in the Deck {N} card above (and load the same track in rekordbox: select it, press LOAD {N} on the controller).',
    why: 'Deck {L} keeps playing to the crowd while you get Deck {N} ready.',
    auto: ({ hasNext }) => hasNext || undefined,
  },
  {
    id: 'fader-down', needs: 'fader', title: 'Pull Deck {N}\'s channel fader all the way down',
    how: 'The tall slider for channel {N}, in the middle of the controller.',
    why: 'So nobody hears the new track until you\'re ready.',
    auto: ({ ctl, N }) => ctl?.decks[N].fader == null ? undefined : ctl.decks[N].fader < 0.04,
  },
  {
    id: 'eq-flat', needs: 'low', title: 'Set Deck {N}\'s EQ and FILTER to 12 o\'clock',
    how: 'HI, MID, LOW and the FILTER knob for channel {N} all pointing straight up.',
    why: 'Start from the track\'s natural sound.',
    auto: ({ ctl, N }) => {
      const d = ctl?.decks[N];
      if (!d || [d.hi, d.mid, d.low].some((v) => v == null)) return undefined;
      return [d.hi, d.mid, d.low].every((v) => near(v, CENTER, 0.06)) && (d.filter == null || near(d.filter, CENTER, 0.06));
    },
  },
  {
    id: 'headphones', needs: 'headphones', title: 'Turn on headphone CUE for Deck {N}',
    how: 'Press the 🎧 CUE button under channel {N}\'s knobs, put your headphones on, and turn HEADPHONES MIXING towards CUE.',
    why: 'Now only you can hear Deck {N}.',
    auto: ({ ctl, N, has }) => ctl && has('headphones') ? ctl.decks[N].headphones : undefined,
  },
  {
    id: 'cue-point', needs: 'cue', title: 'Set a cue point on the first beat',
    how: 'With Deck {N} paused, turn its jog wheel to the first kick drum (the first beat line on the waveform), then press CUE.',
    why: 'CUE remembers that spot, so you can start exactly on the beat.',
    auto: ({ since }) => since('cue') || undefined,
  },
  {
    id: 'tempo', needs: 'tempo', title: 'Match the tempo: Deck {N} to {BPM} BPM',
    how: 'Move Deck {N}\'s TEMPO slider until its BPM in rekordbox reads {BPM}, the same as Deck {L}. Easy way while learning: press BEAT SYNC on Deck {N}.',
    why: 'Same speed means the beats won\'t drift apart.',
    auto: ({ tempoMatched, since, vision }) => (since('sync') || tempoMatched || vision?.tempoOk) || undefined,
  },
  {
    id: 'wait-phrase', title: 'Wait for a new phrase on Deck {L}',
    how: 'Count the beats of Deck {L}: 1-2-3-4 is one bar. Music changes every 8 or 16 bars — that\'s a phrase. Get ready to start on the "1" of the next one.{OUT}',
    why: 'Starting on a phrase makes both tracks change at the same time, which sounds planned.',
  },
  {
    id: 'play', needs: 'play', title: 'Press PLAY on Deck {N} on the "1"',
    how: 'Tap ▶︎ exactly on the first beat of the new phrase.',
    why: 'Both kick drums now land together — only you can hear it so far.',
    auto: ({ since }) => since('play') || undefined,
  },
  {
    id: 'check-beats', needs: 'jog', title: 'Check the beats in your headphones',
    how: 'If the kicks sound like a galloping horse, nudge Deck {N}: spin the OUTER EDGE of its jog wheel a little forward (if it\'s behind) or back (if it\'s ahead).',
    why: 'Small timing slips are normal — nudging fixes them. If it already sounds like one kick, just tick this.',
    auto: ({ since, vision, phaseHeld }) => (vision ? (vision.tempoOk && phaseHeld) : since('jog')) || undefined,
  },
  {
    id: 'gain', needs: 'trim', title: 'Match the volume with Deck {N}\'s TRIM',
    how: 'Turn channel {N}\'s TRIM (top knob) until its level meter bounces as high as Deck {L}\'s. Keep both out of the red.',
    why: 'Do this before touching the EQ, so both tracks start equally loud.',
    auto: ({ ctl, trimMoved, has }) => ctl && has('trim') ? trimMoved || undefined : undefined,
  },
  {
    id: 'bass-cut', needs: 'low', title: 'Turn Deck {N}\'s LOW all the way down',
    how: 'Channel {N}\'s LOW knob fully left.',
    why: 'Two basslines at once sound muddy and too loud.',
    auto: ({ ctl, N }) => ctl?.decks[N].low == null ? undefined : ctl.decks[N].low < 0.1,
  },
  {
    id: 'fade-in', needs: 'fader', title: 'Slowly push Deck {N}\'s fader to the top',
    how: 'Take about 8 bars (roughly 15 seconds). Leave the crossfader in the middle.',
    why: 'The crowd now hears the new track\'s melody and drums coming in.',
    auto: ({ ctl, N }) => ctl?.decks[N].fader == null ? undefined : ctl.decks[N].fader > 0.9,
  },
  {
    id: 'bass-swap', needs: 'low', title: 'Swap the bass on the next phrase',
    how: 'On the "1" of the next phrase, at the same moment: Deck {L}\'s LOW fully down, Deck {N}\'s LOW back to 12 o\'clock.',
    why: 'This is the moment the new track takes over.',
    auto: ({ ctl, N, L }) => {
      if (!ctl || ctl.decks[N].low == null || ctl.decks[L].low == null) return undefined;
      return ctl.decks[L].low < 0.1 && near(ctl.decks[N].low, CENTER, 0.08);
    },
  },
  {
    id: 'fade-out', needs: 'fader', title: 'Fade Deck {L} out',
    how: 'Bring Deck {L}\'s channel fader down over a few bars.',
    why: 'Deck {N} is now playing on its own. That\'s a mix! 🎉',
    auto: ({ ctl, L }) => ctl?.decks[L].fader == null ? undefined : ctl.decks[L].fader < 0.04,
  },
  {
    id: 'reset', title: 'Reset for the next mix',
    how: 'Turn off 🎧 CUE on Deck {N}, set Deck {L}\'s LOW back to 12 o\'clock, then load a new track on Deck {L}.',
    why: 'Deck {N} is now your playing deck; Deck {L} becomes the next one.',
    auto: ({ ctl, N, L, has }) => ctl && has('headphones') && ctl.decks[L].low != null ? !ctl.decks[N].headphones && near(ctl.decks[L].low, CENTER, 0.08) : undefined,
  },
];

export function fillText(text, { N, L, bpm, outHint = '' }) {
  return text.replace(/\{N\}/g, N).replace(/\{L\}/g, L).replace(/\{BPM\}/g, bpm ? bpm.toFixed(1) : '—').replace('{OUT}', outHint);
}

/** Plain names for the controls, used when a controller doesn't have one. */
export const CONTROL_NAMES = {
  fader: 'channel fader', trim: 'TRIM (gain) knob', low: 'EQ knobs', headphones: 'headphone CUE button',
  cue: 'CUE button', tempo: 'TEMPO slider', play: 'PLAY button', jog: 'jog wheel',
};
