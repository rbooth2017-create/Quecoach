import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyController, applyMidi as apply, findController, detectController, CONTROLLERS } from '../js/controller.js';
const FLX4 = findController('ddj-flx4');
const applyMidi = (c, bytes, now) => apply(FLX4, c, bytes, now);
import { STEPS, compatChecks, deckBpm, fillText } from '../js/mixguide.js';

test('FLX4: 14-bit faders, EQ, tempo and buttons', () => {
  const c = emptyController();
  applyMidi(c, [0xb1, 0x13, 0x7f]); applyMidi(c, [0xb1, 0x33, 0x7f]); // deck 2 fader to top
  assert.ok(c.decks[2].fader > 0.99);
  applyMidi(c, [0xb0, 0x0f, 0x00]); // deck 1 LOW fully left
  assert.equal(c.decks[1].low, 0);
  applyMidi(c, [0xb0, 0x00, 0x40]); applyMidi(c, [0xb0, 0x20, 0x00]); // tempo slider centre
  assert.ok(Math.abs(c.decks[1].tempo) < 1e-9);
  applyMidi(c, [0xb0, 0x00, 0x00]); applyMidi(c, [0xb0, 0x20, 0x00]); // top = slower
  assert.equal(c.decks[1].tempo, -10);
  applyMidi(c, [0xb6, 0x18, 0x40]); // filter CH2 centre
  assert.ok(Math.abs(c.decks[2].filter - 0.5) < 0.01);
  assert.equal(applyMidi(c, [0x91, 0x54, 0x7f]), '2.headphones');
  assert.equal(c.decks[2].headphones, true);
  applyMidi(c, [0x91, 0x54, 0x00]); // release does nothing
  assert.equal(c.decks[2].headphones, true);
  applyMidi(c, [0x91, 0x0b, 0x7f], 1000);
  assert.equal(c.decks[2].lastPress.play, 1000);
  assert.equal(applyMidi(c, [0xb1, 0x21, 0x41]), '2.jog');
});

test('compat checks: tempo, key, unknowns', () => {
  const live = { bpm: 126, camelot: '8A' }, next = { bpm: 124, camelot: '9A' };
  const c = compatChecks(live, next);
  assert.equal(c.find((x) => x.id === 'bpm-range').ok, true);
  assert.equal(c.find((x) => x.id === 'key').ok, true);
  const far = compatChecks(live, { bpm: 100, camelot: '3B' });
  assert.equal(far.find((x) => x.id === 'bpm-range').ok, false);
  assert.equal(far.find((x) => x.id === 'key').ok, false);
  assert.equal(compatChecks(live, { bpm: 0 }).find((x) => x.id === 'key').ok, null);
  const m = compatChecks(live, next, { liveTempo: 0, nextTempo: (126 / 124 - 1) * 100 });
  assert.equal(m.find((x) => x.id === 'bpm-matched').ok, true);
  assert.ok(Math.abs(deckBpm(next, 1.6129) - 126) < 0.01);
});

test('steps tick themselves from the controller', () => {
  const step = (id) => STEPS.find((s) => s.id === id);
  const c = emptyController(); c.connected = true;
  const ctx = { ctl: c, N: 2, L: 1, since: () => false, has: (x) => FLX4.has.includes(x) };
  assert.equal(step('fader-down').auto(ctx), undefined); // unknown until the fader moves
  applyMidi(c, [0xb1, 0x13, 0x00]);
  assert.equal(step('fader-down').auto(ctx), true);
  for (const cc of [0x07, 0x0b, 0x0f]) applyMidi(c, [0xb1, cc, 0x40]);
  assert.equal(step('eq-flat').auto(ctx), true);
  applyMidi(c, [0xb1, 0x0f, 0x00]);
  assert.equal(step('bass-cut').auto(ctx), true);
  applyMidi(c, [0xb0, 0x0f, 0x00]); applyMidi(c, [0xb1, 0x0f, 0x40]);
  assert.equal(step('bass-swap').auto(ctx), true);
  assert.equal(step('wait-phrase').auto, undefined); // always ticked by hand
  assert.equal(fillText('Deck {N} to {BPM} BPM, like Deck {L}', { N: 2, L: 1, bpm: 126 }), 'Deck 2 to 126.0 BPM, like Deck 1');
});

test('imported FLX4 map matches the codes checked by hand', () => {
  const has = (s, d, name) => FLX4.controls.some(([a, b, n]) => a === s && b === d && n === name);
  assert.ok(has(0xb0, 0x13, 'd1.fader') && has(0xb0, 0x33, 'd1.fader'));
  assert.ok(has(0xb1, 0x04, 'd2.trim') && has(0xb1, 0x0f, 'd2.low') && has(0xb1, 0x07, 'd2.hi'));
  assert.ok(has(0xb6, 0x17, 'd1.filter') && has(0xb6, 0x18, 'd2.filter') && has(0xb6, 0x1f, 'm.crossfader'));
  assert.ok(has(0x90, 0x54, 'd1.headphones') && has(0x91, 0x0b, 'd2.play') && has(0x91, 0x0c, 'd2.cue') && has(0x90, 0x58, 'd1.sync'));
  assert.ok(has(0xb0, 0x00, 'd1.tempo') && has(0xb0, 0x20, 'd1.tempo'));
});

test('every profile reads both decks; devices are detected by name', () => {
  for (const p of CONTROLLERS) {
    for (const need of ['fader', 'headphones', 'play', 'low']) {
      assert.ok(p.has.includes(need), `${p.name} missing ${need}`);
      for (const d of ['d1', 'd2']) assert.ok(p.controls.some(([, , n]) => n === `${d}.${need}`), `${p.name} ${d}.${need}`);
    }
  }
  assert.equal(detectController('DDJ-FLX4 MIDI 1')?.id, 'ddj-flx4');
  assert.equal(detectController('DJControl Inpulse 300')?.id, 'inpulse-300');
  assert.equal(detectController('IAC Driver Bus 1'), null);
});

test('a 7-bit controller (Inpulse 300) and the tempo invert option', () => {
  const p = findController('inpulse-300'), c = emptyController();
  const [s, d] = p.controls.find(([, , n]) => n === 'd1.fader');
  apply(p, c, [s, d, 127]);
  assert.equal(c.decks[1].fader, 1);
  const [ts, td, , part] = p.controls.find(([, , n, pt]) => n === 'd1.tempo' && pt !== 'lsb');
  apply(p, c, [ts, td, 0], 0, { tempoRange: 10 });
  const t1 = c.decks[1].tempo;
  apply(p, c, [ts, td, 0], 0, { tempoRange: 10, invertTempo: true });
  assert.equal(c.decks[1].tempo, -t1);
  assert.ok(['msb', '7'].includes(part));
});
