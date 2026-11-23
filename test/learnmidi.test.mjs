import test from 'node:test';
import assert from 'node:assert/strict';
import { midiToAction, jogTicks, eqDb } from '../js/learnmidi.js';
import { findController, emptyController, detectController } from '../js/controller.js';

const flx4 = findController('ddj-flx4');

test('the FLX4 is recognised by its MIDI name', () => {
  assert.equal(detectController('DDJ-FLX4').id, 'ddj-flx4');
});

test('FLX4 buttons: play, cue, sync and headphones on each deck', () => {
  const ctl = emptyController();
  assert.deepEqual(midiToAction(flx4, ctl, [144, 11, 127]), { type: 'play', side: 'left' });
  assert.equal(midiToAction(flx4, ctl, [144, 11, 0]), null); // button release does nothing
  assert.deepEqual(midiToAction(flx4, ctl, [145, 11, 127]), { type: 'play', side: 'right' });
  assert.deepEqual(midiToAction(flx4, ctl, [144, 12, 127]), { type: 'cue', side: 'left', down: true });
  assert.deepEqual(midiToAction(flx4, ctl, [144, 12, 0]), { type: 'cue', side: 'left', down: false }); // CUE needs its release, like a CDJ
  assert.deepEqual(midiToAction(flx4, ctl, [0x81, 12, 64]), { type: 'cue', side: 'right', down: false }); // note-off release
  assert.deepEqual(midiToAction(flx4, ctl, [145, 88, 127]), { type: 'sync', side: 'right' });
  assert.deepEqual(midiToAction(flx4, ctl, [145, 84, 127]), { type: 'listen', side: 'right', on: true });
  assert.deepEqual(midiToAction(flx4, ctl, [145, 84, 127]), { type: 'listen', side: 'right', on: false }); // toggles
});

test('FLX4 jog wheels nudge forward and back', () => {
  const ctl = emptyController();
  assert.deepEqual(midiToAction(flx4, ctl, [176, 33, 66]), { type: 'jog', side: 'left', ticks: 2 });
  assert.deepEqual(midiToAction(flx4, ctl, [177, 33, 61]), { type: 'jog', side: 'right', ticks: -3 });
});

test('Hercules jogs count the other way', () => {
  const inpulse = findController('inpulse-300');
  assert.equal(jogTicks(inpulse, 1), 1);
  assert.equal(jogTicks(inpulse, 127), -1);
  assert.equal(jogTicks(inpulse, 120), -8);
  assert.equal(midiToAction(inpulse, emptyController(), [177, 10, 3]).ticks, 3);
});

test('FLX4 faders and knobs: tempo, EQ, channel fader, crossfader', () => {
  const ctl = emptyController();
  // 14-bit controls send the coarse value first; the middle of the tempo fader is 0 %
  assert.deepEqual(midiToAction(flx4, ctl, [176, 0, 64]), { type: 'tempo', side: 'left', pct: 0 });
  // Pioneer tempo faders: top (0) is slower, bottom is faster
  assert.equal(midiToAction(flx4, ctl, [176, 0, 0]).pct, -8);
  assert.equal(midiToAction(flx4, ctl, [176, 0, 127], { tempoRange: 16 }).pct > 15.5, true);
  assert.deepEqual(midiToAction(flx4, ctl, [177, 15, 0]), { type: 'eq', side: 'right', band: 'low', db: -30 });
  assert.equal(midiToAction(flx4, ctl, [176, 7, 64]).band, 'high');
  assert.equal(midiToAction(flx4, ctl, [176, 7, 64]).db, 0);
  assert.equal(midiToAction(flx4, ctl, [176, 19, 127]).type, 'volume');
  const xf = midiToAction(flx4, ctl, [182, 31, 127]);
  assert.equal(xf.type, 'xfader'); assert.ok(xf.value > 0.99);
  assert.equal(midiToAction(flx4, ctl, [182, 63, 0]), null); // the fine half of a 14-bit pair doesn't fire twice
  assert.deepEqual(midiToAction(flx4, ctl, [176, 4, 64]), { type: 'trim', side: 'left', db: 0 }); // trim centre is flat
});

test('EQ knob curve: centre flat, full cut, small boost', () => {
  assert.equal(eqDb(0.5), 0); assert.equal(eqDb(0), -30); assert.equal(eqDb(1), 6); assert.equal(eqDb(0.25), -15);
});

import { KEEPALIVE, describeAction, hexBytes } from '../js/learnmidi.js';

test('FLX4 keep-alive is the SysEx Mixxx sends, and the monitor speaks plainly', () => {
  const k = KEEPALIVE['ddj-flx4'];
  assert.equal(k.bytes[0], 0xF0); assert.equal(k.bytes.at(-1), 0xF7); assert.equal(k.bytes.length, 12); assert.equal(k.everyMs, 200);
  const ctl = emptyController();
  assert.equal(describeAction(midiToAction(flx4, ctl, [144, 11, 127])), 'Play / pause, deck A');
  assert.equal(describeAction(midiToAction(flx4, ctl, [177, 33, 61])), 'Jog -3, deck B');
  assert.equal(describeAction(midiToAction(flx4, ctl, [177, 15, 0])), 'Bass -30 dB, deck B');
  assert.equal(describeAction(null), 'not used yet');
  assert.equal(describeAction(midiToAction(flx4, ctl, [145, 88, 127])), 'Beat sync: align this deck\'s phrase to the other deck, deck B');
  assert.equal(hexBytes(Uint8Array.from([144, 11, 127])), '90 0B 7F');
});

import { browseSteps, flx4Lights, JOG_STEPS_PER_TURN } from '../js/learnmidi.js';

test('FLX4 extras: jog top, search, touch, shift, pads, browse, load, trim, filter', () => {
  const ctl = emptyController();
  assert.deepEqual(midiToAction(flx4, ctl, [176, 0x22, 66]), { type: 'jog', side: 'left', ticks: 2 });
  assert.deepEqual(midiToAction(flx4, ctl, [177, 0x23, 63]), { type: 'jog', side: 'right', ticks: -1 });
  assert.deepEqual(midiToAction(flx4, ctl, [176, 0x29, 70]), { type: 'search', side: 'left', ticks: 6 });
  assert.deepEqual(midiToAction(flx4, ctl, [145, 0x36, 127]), { type: 'touch', side: 'right', on: true });
  assert.deepEqual(midiToAction(flx4, ctl, [144, 0x3f, 127]), { type: 'shift', on: true });
  assert.deepEqual(midiToAction(flx4, ctl, [0x97, 2, 127]), { type: 'pad', side: 'left', mode: 'hotcue', pad: 2, down: true, shift: false });
  assert.equal(midiToAction(flx4, ctl, [0x97, 2, 0]).down, false); // pad release is reported (held effects need it)
  assert.deepEqual(midiToAction(flx4, ctl, [0x9a, 0, 127]), { type: 'pad', side: 'right', mode: 'hotcue', pad: 0, down: true, shift: true });
  assert.deepEqual(midiToAction(flx4, ctl, [0xb6, 0x40, 1]), { type: 'browse', steps: 1 });
  assert.deepEqual(midiToAction(flx4, ctl, [0xb6, 0x40, 127]), { type: 'browse', steps: -1 });
  assert.deepEqual(midiToAction(flx4, ctl, [0x96, 0x47, 127]), { type: 'load', side: 'right' });
  assert.deepEqual(midiToAction(flx4, ctl, [0x96, 0x41, 127]), { type: 'browsePress' });
  const trim = midiToAction(flx4, ctl, [176, 0x04, 127]); assert.equal(trim.type, 'trim'); assert.ok(trim.db > 11.5 && trim.db <= 12);
  assert.equal(midiToAction(flx4, ctl, [182, 0x17, 0]).type, 'filter');
  assert.deepEqual(midiToAction(flx4, ctl, [0x94, 0x47, 127]), { type: 'fxOn' });
  // the side of the jog still comes through the generated map
  assert.deepEqual(midiToAction(flx4, ctl, [176, 0x21, 65]), { type: 'jog', side: 'left', ticks: 1 });
  assert.equal(JOG_STEPS_PER_TURN, 720);
  assert.equal(browseSteps(64), 0); assert.equal(browseSteps(3), 3); assert.equal(browseSteps(125), -3);
});

test('FLX4 lights follow the app', () => {
  const lights = flx4Lights({ left: { playing: true, loaded: true, listening: false, cues: [1.5, null, null, null], padMode: 'hotcue' }, right: { playing: false, loaded: false, listening: true, cues: [], padMode: 'loop', loopBeats: 4 }, fxOn: true });
  const get = (st, d1) => lights.find(([s, d]) => s === st && d === d1)[2];
  assert.equal(get(0x90, 0x0b), 0x7f); assert.equal(get(0x91, 0x0b), 0);
  assert.equal(get(0x91, 0x54), 0x7f); assert.equal(get(0x97, 0), 0x7f); assert.equal(get(0x97, 1), 0);
  assert.equal(get(0x99, 0x64), 0x7f); assert.equal(get(0x99, 0x63), 0); // deck 2 in loop mode: the 4-beat pad is lit
  assert.equal(get(0x91, 0x6d), 0x7f); assert.equal(get(0x91, 0x1b), 0); // its BEAT LOOP mode button is lit
  assert.equal(get(0x91, 0x10), 0x7f); assert.equal(get(0x90, 0x10), 0); // loop IN lit only while looping
  assert.equal(get(0x94, 0x47), 0x7f);
});

import { PAD_MODES } from '../js/learnmidi.js';

test('FLX4 performance: pad modes, loops, beat jump, sampler, Pad FX and Beat FX', () => {
  const ctl = emptyController();
  assert.deepEqual(midiToAction(flx4, ctl, [0x90, 0x6d, 127]), { type: 'padMode', side: 'left', mode: 'loop' });
  assert.deepEqual(midiToAction(flx4, ctl, [0x91, 0x22, 127]), { type: 'padMode', side: 'right', mode: 'sampler' });
  assert.equal(Object.keys(PAD_MODES).length, 8);
  assert.deepEqual(midiToAction(flx4, ctl, [0x97, 0x64, 127]), { type: 'pad', side: 'left', mode: 'loop', pad: 4, down: true, shift: false });
  assert.deepEqual(midiToAction(flx4, ctl, [0x99, 0x27, 127]), { type: 'pad', side: 'right', mode: 'jump', pad: 7, down: true, shift: false });
  assert.deepEqual(midiToAction(flx4, ctl, [0x99, 0x31, 127]), { type: 'pad', side: 'right', mode: 'sampler', pad: 1, down: true, shift: false });
  // Pad FX pads have no known codes: they arrive on other notes and follow the deck's pad mode
  assert.deepEqual(midiToAction(flx4, ctl, [0x97, 0x12, 127]), { type: 'pad', side: 'left', mode: null, pad: 2, down: true, shift: false });
  assert.equal(midiToAction(flx4, ctl, [0x87, 0x12, 0]).down, false); // note-off release
  assert.equal(midiToAction(flx4, ctl, [0x97, 0x41, 127]), null); // keyboard mode not used yet
  // loop section
  assert.deepEqual(midiToAction(flx4, ctl, [0x90, 0x10, 127]), { type: 'loopIn', side: 'left' });
  assert.deepEqual(midiToAction(flx4, ctl, [0x91, 0x11, 127]), { type: 'loopOut', side: 'right' });
  assert.deepEqual(midiToAction(flx4, ctl, [0x90, 0x4d, 127]), { type: 'reloop', side: 'left' });
  assert.deepEqual(midiToAction(flx4, ctl, [0x90, 0x51, 127]), { type: 'loopHalf', side: 'left' });
  assert.deepEqual(midiToAction(flx4, ctl, [0x91, 0x3d, 127]), { type: 'jump', side: 'right', beats: 32 });
  assert.equal(midiToAction(flx4, ctl, [0x90, 0x10, 0]), null);
  // Beat FX
  assert.deepEqual(midiToAction(flx4, ctl, [0x94, 0x63, 127]), { type: 'fxSelect', step: 1 });
  assert.deepEqual(midiToAction(flx4, ctl, [0x94, 0x4a, 127]), { type: 'fxBeats', step: -1 });
  assert.deepEqual(midiToAction(flx4, ctl, [0x94, 0x10, 127]), { type: 'fxChannel', ch: 'A' });
  assert.deepEqual(midiToAction(flx4, ctl, [0x94, 0x10, 0]), { type: 'fxChannel', ch: 'both' });
  assert.deepEqual(midiToAction(flx4, ctl, [0x95, 0x11, 127]), { type: 'fxChannel', ch: 'B' });
  assert.deepEqual(midiToAction(flx4, ctl, [0xb4, 0x02, 127]), { type: 'fxLevel', value: 1 });
  // play, cue and headphones still come from the generated map
  assert.deepEqual(midiToAction(flx4, ctl, [0x90, 0x0b, 127]), { type: 'play', side: 'left' });
});

import { flx4Meters } from '../js/learnmidi.js';

test('FLX4 level meters follow each channel', () => {
  assert.deepEqual(flx4Meters({ left: 0.5, right: 0 }), [[0xb0, 0x02, 64], [0xb1, 0x02, 0]]);
  assert.deepEqual(flx4Meters({ left: 2, right: -1 }), [[0xb0, 0x02, 127], [0xb1, 0x02, 0]]); // clipped to the meter
});
