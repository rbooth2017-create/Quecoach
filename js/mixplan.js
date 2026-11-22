// Mix timing: where to start the next track so its intro fits the playing track's outro, and plain-word
// cues as the moment comes up. DOM-free.
import { structureFromPhrases, mixOutPoint, mixInPoints, timeOfBar } from './engine.js';

/** What each part of a track is, in plain words, and whether it's a good place to mix. */
export const PART_INFO = {
  Intro: { name: 'Intro', what: 'Usually just drums and a simple groove.', mix: 'The best part to bring a track in on.' },
  Up: { name: 'Build', what: 'Tension rising towards a drop.', mix: 'Let it play: the drop is coming.' },
  Chorus: { name: 'Drop', what: 'The main part: full energy, full bass.', mix: 'Let it play. Don\'t mix out yet.' },
  Down: { name: 'Breakdown', what: 'The beat drops out for a moment.', mix: 'Hard to beatmatch over: wait for it to come back.' },
  Outro: { name: 'Outro', what: 'The track winding down, often just drums.', mix: 'Mix the next track in here.' },
  Verse: { name: 'Verse', what: 'A vocal section between the bigger moments.', mix: 'Usually wait for the end of the phrase.' },
  Bridge: { name: 'Bridge', what: 'A change of feel before the track returns.', mix: 'Usually wait for the end of the phrase.' },
};
export const partInfo = (label = '') => PART_INFO[label] || PART_INFO[Object.keys(PART_INFO).find((k) => label.startsWith(k))] || { name: label || 'Part', what: '', mix: '' };

// How long the two tracks play together. Short blends are a quick fade, not a mix: never plan fewer than 16
// bars. Dance tracks get B's whole intro and build (up to 64 bars) under A, so B's drop lands as A ends;
// a pop song with a short intro keeps a short blend. B starts earlier in A when A's outro alone is too short.
export const BLEND = { min: 16, max: 64 };

/**
 * Plan a mix from A (playing) into B (next).
 * startBar: A's bar to press play on B. B starts from bStart (its first downbeat).
 * The blend runs over B's intro and build (everything before its drop), 16 to 64 bars, so B's drop lands as A
 * ends. If that is longer than A's outro, B starts earlier by whole phrases so both tracks get time together.
 * The bass swap sits halfway, on a 4-bar line.
 */
export function planMix(A, B, phraseBars = 16) {
  if (!A?.grid || !B?.grid || !(A.duration > 0)) return null;
  const sA = structureFromPhrases(A.phrases, A.grid), sB = structureFromPhrases(B.phrases, B.grid);
  const out = mixOutPoint(A, sA ? { structure: sA } : null, phraseBars);
  const inPt = mixInPoints(B, sB ? { structure: sB } : null, phraseBars)[0];
  if (!out || !inPt) return null;
  // B's intro is the Intro part only; its build can also play under A, up to B's drop.
  const bl = 240 / B.grid.bpm;
  const afterIntro = (B.phrases || []).find((p) => !/^Intro/.test(p.label || '') && p.start > B.grid.firstDownbeat + bl / 2);
  const bIntroBars = afterIntro ? Math.max(4, Math.round((afterIntro.start - B.grid.firstDownbeat) / bl))
    : sB?.firstDrop ? Math.max(4, sB.firstDrop - 1) : 32;
  const bLeadBars = Math.max(bIntroBars, sB?.firstDrop ? sB.firstDrop - 1 : 0);
  const want = Math.max(BLEND.min, Math.min(BLEND.max, bLeadBars - (bLeadBars % 4)));
  const aOutroBars = Math.max(4, out.totalBars - out.bar + 1);
  const need = Math.max(want, bIntroBars);
  let startBar = out.bar;
  if (need > aOutroBars) startBar = Math.max(1, out.bar - Math.ceil((need - aOutroBars) / phraseBars) * phraseBars);
  const room = out.totalBars - startBar + 1;
  const blendBars = Math.max(4, Math.min(want, room - (room % 4)));
  const early = out.bar - startBar;
  return {
    startBar, startTime: timeOfBar(A.grid, startBar),
    blendBars, swapBar: swapAt(startBar, blendBars), endBar: startBar + blendBars,
    aOutroStart: out.bar, aTotalBars: out.totalBars, aOutroBars,
    bStart: inPt.time, bIntroBars, bDropAtBarA: startBar + (sB?.firstDrop ? sB.firstDrop - 1 : bIntroBars),
    why: !early
      ? `B's ${bIntroBars}-bar intro fits inside A's ${aOutroBars}-bar outro: ${blendBars} bars with both tracks playing.`
      : bIntroBars > aOutroBars
        ? `B's intro is ${bIntroBars} bars, longer than A's ${aOutroBars}-bar outro, so B starts ${early} bars earlier and its drop lands as A ends.`
        : want > aOutroBars && blendBars === want
          ? `B's intro and build run ${bLeadBars} bars before its drop, longer than A's ${aOutroBars}-bar outro, so B starts ${early} bars earlier: a ${blendBars}-bar blend, and B's drop lands as A ends.`
        : `A's outro is only ${aOutroBars} bars, so B starts ${early} bars earlier to give you a ${blendBars}-bar blend.`,
  };
}

/** The bass swap: halfway through the blend, on a 4-bar line. */
const swapAt = (start, blend) => start + Math.max(2, Math.floor(blend / 8) * 4);
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const clamp01 = (x) => Math.max(0, Math.min(1, x));

/**
 * The mixer moves the guide can ask for: what the level shows on screen, plus everything on a connected
 * controller (it has real channel faders and all three EQ dials). The crossfader is always there.
 */
export function mixControls(f = {}, hasController = false) {
  const c = !!hasController;
  return { volume: !!f.volume || c, low: !!f.bassEQ || c, mid: !!f.fullEQ || c, high: !!f.highEQ || c };
}

/** The plan re-anchored to the bar B was actually started on, with the blend squeezed into what's left of A. */
export function shiftPlan(plan, startBar) {
  if (!plan || !Number.isFinite(startBar)) return plan;
  const s = Math.max(1, Math.round(startBar));
  if (s === plan.startBar) return plan;
  const room = plan.aTotalBars - s + 1;
  const blendBars = Math.max(4, Math.min(plan.blendBars, room - (room % 4)));
  return { ...plan, startBar: s, blendBars, swapBar: swapAt(s, blendBars), endBar: s + blendBars, bDropAtBarA: plan.bDropAtBarA + (s - plan.startBar) };
}

const BAND_WORD = { high: 'highs', mid: 'mids' };

/** Steps that happen before B plays (getting it ready); they're missed if B starts first. */
export const PREP_STEPS = new Set(['ready', 'pick', 'load', 'match', 'cue', 'levels']);

/** Getting B ready, one move at a time (the detailed guide for newer DJs). bar is filled in by mixSteps. */
export function prepSteps(controls = {}, names = { a: 'A', b: 'B' }) {
  const { a, b } = names, c = controls;
  const down = ['high', 'mid'].filter((k) => c[k]).map((k) => BAND_WORD[k]);
  const levels = [
    c.low && `Turn ${b}'s bass all the way down, so its bassline doesn't clash with ${a}'s.`,
    c.volume ? `Pull ${b}'s volume all the way down and put the crossfader in the middle.` : `Keep the crossfader all the way over on ${a}, so nobody hears ${b} yet.`,
    down.length && `Turn ${b}'s ${down.join(' and ')} down to about halfway.`,
  ].filter(Boolean).join(' ');
  return [
    { id: 'pick', short: 'Pick a track', title: 'Pick the next track', detail: `Open the library: the Suggested tab lists tracks that blend well with ${a}. Look for a close speed and a matching key.` },
    { id: 'load', short: `Load ${b}`, title: `Load it onto deck ${b}`, detail: `Press the ${b} button next to the track. ${b} waits, silent, while ${a} keeps playing.` },
    { id: 'match', short: 'Match speed', title: `Match ${b}'s speed to ${a}`, detail: `Move ${b}'s tempo fader until both show the same BPM.` },
    { id: 'cue', short: `Cue ${b} up`, title: `Cue ${b} up`, detail: `Press "Cue ${b} up" so it waits on its first beat, ready to play.` },
    { id: 'levels', short: 'Set levels', title: `Set ${b}'s levels`, detail: levels },
  ];
}

/**
 * The transition as a short list of steps, in A's bars. Only moves the DJ has controls for are included.
 * Each step: { id, bar (when it starts), by (when it should be finished), short, title, detail }.
 * names: the deck letters, e.g. { a: 'A', b: 'B' }. detailed: split getting ready into single moves and
 * swap the mids as well as the bass (Starter and Improver).
 */
export function mixSteps(plan, controls = {}, names = { a: 'A', b: 'B' }, detailed = false) {
  if (!plan) return [];
  const { a, b } = names, c = controls;
  const start = plan.startBar, swap = plan.swapBar, end = plan.endBar, blend = plan.blendBars;
  const down = ['high', 'mid'].filter((k) => c[k]).map((k) => BAND_WORD[k]);
  const prepBar = Math.max(1, start - 16);
  const steps = detailed ? prepSteps(c, names).map((s) => ({ ...s, bar: prepBar, by: start })) : [
    {
      id: 'ready', bar: prepBar, by: start, short: 'Get ready', title: `Get ${b} ready`,
      detail: [`Load it, match its speed to ${a}, then press "Cue ${b} up".`,
        c.low && `Turn ${b}'s bass all the way down.`,
        c.volume ? `Pull ${b}'s volume down and put the crossfader in the middle.` : `Keep the crossfader on ${a}.`,
        down.length && `Turn ${b}'s ${down.join(' and ')} down to about halfway.`].filter(Boolean).join(' '),
    },
  ];
  steps.push(
    { id: 'start', bar: start, by: start, short: `Start ${b}`, title: `Start ${b} on the 1 of bar ${start}`, detail: `Press play on ${b} right on the big "1". Nobody hears it yet.` },
    {
      id: 'fade', bar: start, by: swap, short: `Bring ${b} in`,
      title: c.volume ? `Raise ${b}'s volume: all the way up by bar ${swap}` : `Slide the crossfader to the middle by bar ${swap}`,
      detail: `Go slowly, a little every bar. You'll start to hear ${b} under ${a}.`,
    },
  );
  if (c.high) steps.push({ id: 'highs', bar: start + Math.round(blend / 4), by: swap, short: `${b}'s highs`, title: `Bring ${b}'s highs back to the middle`, detail: 'The hi-hats and cymbals come in. Turn the treble dial back to 12 o\'clock.' });
  if (c.mid) {
    steps.push(detailed
      ? { id: 'mids', swapA: true, bar: start + Math.round((3 * blend) / 8), by: swap, short: 'Swap mids', title: `Swap the mids by bar ${swap}`, detail: `Turn ${b}'s mids back to 12 o'clock and ${a}'s mids down to about halfway, so the melodies don't fight.` }
      : { id: 'mids', bar: start + Math.round((3 * blend) / 8), by: swap, short: `${b}'s mids`, title: `Bring ${b}'s mids back to the middle`, detail: 'Now the melody and vocals join in. Turn the mid dial back to 12 o\'clock.' });
  }
  if (c.low) steps.push({ id: 'swap', bar: swap, by: swap + 1, short: 'Swap bass', title: `Swap the bass on bar ${swap}`, detail: `On the "1": turn ${a}'s bass all the way down and ${b}'s bass back to the middle, at the same time.` });
  steps.push({
    id: 'out', bar: swap, by: end, short: `${a} out`,
    title: c.volume ? `Lower ${a}'s volume: gone by bar ${end}` : `Crossfader all the way to ${b} by bar ${end}`,
    detail: `Take ${a} away slowly. When it's silent, ${b} is the track.`,
  });
  return steps;
}

// How the controls have to look for a step to count as done (EQ in dB, faders 0..1).
export const GUIDE = { cutDb: -20, backDb: -6, halfDb: -10, faderUp: 0.9, xfMiddle: 0.45, xfAllB: 0.95, aGone: 0.05, rampSlack: 0.35, lateBars: 2 };
const WAY = ['a little', 'about a quarter', 'about halfway', 'about three quarters', 'nearly all the way'];

/** How far a fade step has got, 0..1, from the mixer. xf: crossfader towards B (0 = all A, 1 = all B). */
function rampProgress(id, snap, c) {
  const xf = snap.xf ?? 0;
  if (id === 'fade') return c.volume ? clamp01(snap.volB ?? 0) : clamp01(xf / 0.5);
  if (id === 'out') {
    if (snap.aPlaying === false || xf >= GUIDE.xfAllB) return 1;
    return c.volume ? clamp01(1 - (snap.volA ?? 1)) : clamp01((xf - 0.5) / 0.5);
  }
  return 0;
}

function isDone(step, snap, c) {
  const eqA = snap.eqA || {}, eqB = snap.eqB || {};
  switch (step.id) {
    case 'ready': return !!snap.bReady && (!c.low || (eqB.low ?? 0) <= GUIDE.cutDb) && (!c.volume || (snap.volB ?? 1) <= 0.1);
    case 'pick': case 'load': return snap.bLoaded ?? !!snap.bReady;
    case 'match': return snap.bMatched ?? !!snap.bReady;
    case 'cue': return snap.bCued ?? !!snap.bReady;
    case 'levels': return (!c.low || (eqB.low ?? 0) <= GUIDE.cutDb) && (c.volume ? (snap.volB ?? 1) <= 0.1 : (snap.xf ?? 0) <= 0.1);
    case 'start': return !!snap.bPlaying;
    case 'fade': return c.volume ? (snap.volB ?? 0) >= GUIDE.faderUp : (snap.xf ?? 0) >= GUIDE.xfMiddle;
    case 'highs': return (eqB.high ?? 0) >= GUIDE.backDb;
    case 'mids': return (eqB.mid ?? 0) >= GUIDE.backDb && (!step.swapA || (eqA.mid ?? 0) <= GUIDE.halfDb);
    case 'swap': return (eqB.low ?? 0) >= GUIDE.backDb && (eqA.low ?? 0) <= GUIDE.cutDb;
    case 'out': return rampProgress('out', snap, c) >= 0.95;
    default: return false;
  }
}

/**
 * Where the DJ is in the steps. snap: { bReady, bLoaded, bMatched, bCued, bPlaying, aPlaying, xf, volA, volB, eqA, eqB } read from
 * the mixer; done: ids already ticked (ticks stay, so a wobble on a dial doesn't untick a step).
 * Returns { items (steps + status 'done'|'now'|'todo'|'missed'), current, next, toNext, toDeadline, note, doneIds }.
 */
export function stepState(steps, plan, barA, snap = {}, controls = {}, done = new Set()) {
  const c = controls, ids = new Set(done);
  for (const s of steps) {
    if (ids.has(s.id)) continue;
    // getting ready counts before B plays; the blend moves only once it does
    const now = PREP_STEPS.has(s.id) ? !snap.bPlaying : s.id === 'start' || snap.bPlaying;
    if (now && isDone(s, snap, c)) ids.add(s.id);
  }
  const items = steps.map((s) => {
    if (ids.has(s.id)) return { ...s, status: 'done' };
    if (PREP_STEPS.has(s.id)) return { ...s, status: snap.bPlaying ? 'missed' : 'now' };
    if (s.id === 'start') return { ...s, status: steps.every((x) => !PREP_STEPS.has(x.id) || ids.has(x.id)) || barA >= s.bar - 1 ? 'now' : 'todo' };
    return { ...s, status: snap.bPlaying && barA >= s.bar ? 'now' : 'todo' };
  });
  const current = items.find((it) => it.status === 'now') || null;
  const allDone = items.every((it) => it.status === 'done' || it.status === 'missed');
  const next = items.find((it) => it.status !== 'done' && it.status !== 'missed' && it !== current && it.bar > barA) || null;
  const toNext = next ? Math.max(0, Math.ceil(next.bar - barA)) : null;
  const toDeadline = current ? Math.max(0, Math.ceil(current.by - barA)) : null;
  return { items, current, next, toNext, toDeadline, note: snap.bPlaying && !allDone ? guideNote(items, plan, barA, snap, c) : null, doneIds: [...ids] };
}

/** One gentle line if a move is early or late, else null. */
function guideNote(items, plan, barA, snap, c) {
  const has = (id) => items.find((it) => it.id === id);
  const eqA = snap.eqA || {}, eqB = snap.eqB || {};
  const { swapBar: swap, endBar: end, startBar: start } = plan;
  if (c.low && has('swap') && has('swap').status !== 'done') {
    if (barA < swap - 1 && (eqB.low ?? 0) > GUIDE.backDb && (eqA.low ?? 0) > GUIDE.cutDb) return { tone: 'early', text: `A bit early: two basslines at once sound muddy. Keep the new track's bass down until bar ${swap}.` };
    if (barA > swap + GUIDE.lateBars) return { tone: 'late', text: 'Swap the bass now: one bass down, the other up, together.' };
  }
  const out = rampProgress('out', snap, c);
  if (barA < swap && out >= 0.95) return { tone: 'early', text: `The old track went out early. Fine for practice; next time keep it until bar ${end}.` };
  if (barA > end + 1 && out < 0.95) return { tone: 'late', text: 'The old track should be gone by now: finish the fade.' };
  const ramp = barA < swap ? { id: 'fade', from: start, to: swap } : barA < end ? { id: 'out', from: swap, to: end } : null;
  if (ramp && has(ramp.id)) {
    const want = clamp01((barA - ramp.from) / (ramp.to - ramp.from)), got = rampProgress(ramp.id, snap, c);
    if (got - want > GUIDE.rampSlack && barA < ramp.to - 2) return { tone: 'early', text: `A bit quick: no rush. Spread this move out until bar ${ramp.to}.` };
    if (want - got > GUIDE.rampSlack) {
      const w = WAY[Math.round(want * 4)];
      const text = ramp.id === 'fade'
        ? (c.volume ? `the new track's volume should be ${w} up` : `the crossfader should be ${w} to the middle`)
        : (c.volume ? `the old track's volume should be ${w} down` : `the crossfader should be ${w} from the middle to the new track`);
      return { tone: 'late', text: `Keep going: ${text} by now.` };
    }
  }
  return null;
}

/**
 * What to tell the DJ right now. barA: deck A's position in bars (1 = first downbeat, fractions allowed).
 * bPlaying: is deck B playing. guide: stepState() for the plan; once B is playing the cue follows its steps.
 * Returns { phase, title, detail, big, unit } (+ nextText, step when guided).
 */
export function mixCue(plan, barA, bPlaying, phraseBars = 16, guide = null) {
  if (!plan) return null;
  const left = plan.startBar - barA; // bars until the mix point
  if (bPlaying && guide && left <= 0.5) {
    const { current: cur, next, toNext, toDeadline, items, note } = guide;
    if (!cur && next) { // ahead of the plan: count down to the next step instead of calling it done
      return { phase: note?.tone === 'early' ? 'early' : 'blend', title: `Next: ${next.title}`, detail: next.detail, nextText: `In ${plural(toNext, 'bar')}.`, step: '', big: String(toNext), unit: toNext === 1 ? 'bar' : 'bars' };
    }
    if (!cur) return { phase: 'done', title: 'Mix done', detail: 'B is the track now. Stop A and load the next one.', big: '✓', unit: '', nextText: '' };
    const n = items.filter((it) => it.status !== 'missed').length, i = items.filter((it) => it.status !== 'missed').indexOf(cur) + 1;
    const nextText = next ? `Next: ${next.short.toLowerCase()} in ${plural(toNext, 'bar')}.` : '';
    const bars = next ? toNext : toDeadline;
    return {
      phase: note?.tone === 'late' ? 'late' : note?.tone === 'early' ? 'early' : 'blend',
      title: cur.title, detail: [cur.detail, nextText].filter(Boolean).join(' '), nextText, step: `Step ${i} of ${n}`,
      big: String(bars), unit: bars === 1 ? 'bar' : 'bars',
    };
  }
  if (bPlaying) {
    if (left > 0.5) return { phase: 'early', title: 'Deck B started early', detail: `That's fine for practice. For a clean mix, start it at A's bar ${plan.startBar}.`, big: '!', unit: '' };
    const into = Math.floor(barA - plan.startBar) + 1;
    if (into <= plan.blendBars) {
      const toSwap = plan.swapBar - barA;
      return {
        phase: 'blend', title: `Blending: bar ${Math.max(1, into)} of ${plan.blendBars}`,
        detail: toSwap > 0 ? `Bring B up slowly. Swap the bass in ${plural(Math.ceil(toSwap), 'bar')} (A's bar ${plan.swapBar}).` : `Bass swapped? Now fade A out by bar ${plan.endBar}.`,
        big: String(Math.max(1, into)), unit: `of ${plan.blendBars}`,
      };
    }
    return { phase: 'done', title: 'Mix done', detail: 'B is the track now. Stop A and load the next one.', big: '✓', unit: '' };
  }
  if (left > 16) return { phase: 'prep', title: `Mix point in ${plural(Math.ceil(left), 'bar')}`, detail: `At A's bar ${plan.startBar}. Get B ready now: match its speed and set it to its start.`, big: String(Math.ceil(left)), unit: 'bars' };
  if (left > 1) return { phase: 'soon', title: `Start deck B in ${plural(Math.ceil(left), 'bar')}`, detail: `Press play on B on the big "1" at A's bar ${plan.startBar}.`, big: String(Math.ceil(left)), unit: 'bars' };
  if (left > 0) {
    const beats = Math.ceil(left * 4); // the last bar counts down in beats
    return { phase: 'count', title: beats > 1 ? `${beats}…` : '1… next beat: GO', detail: 'Get your finger on deck B\'s play button.', big: String(beats), unit: 'beats' };
  }
  if (left > -0.5) return { phase: 'go', title: 'GO: play deck B now', detail: 'Right on this bar.', big: 'GO', unit: '' };
  const next = plan.startBar + Math.ceil(-left / phraseBars) * phraseBars;
  if (next <= plan.aTotalBars - 4) return { phase: 'late', title: 'Missed it: no problem', detail: `The next good point is A's bar ${next}, in ${plural(Math.ceil(next - barA), 'bar')}.`, big: String(Math.ceil(next - barA)), unit: 'bars' };
  return { phase: 'late', title: 'Track A is nearly over', detail: 'Start B now on a "1" and blend quickly.', big: '!', unit: '' };
}
