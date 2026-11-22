import test from 'node:test';
import assert from 'node:assert/strict';
import { cueRoute, headphoneMix, setupTip, looksLikeHeadphones } from '../js/headphones.js';
import { midiToAction } from '../js/learnmidi.js';
import { findController, emptyController } from '../js/controller.js';

const outputs = [
  { id: 'mac', label: 'MacBook Pro Speakers' },
  { id: 'flx', label: 'DDJ-FLX4' },
  { id: 'hpdev', label: 'Headphones (DDJ-FLX4)' },
];

test('a 4-output controller: speakers on 1-2, headphones on 3-4', () => {
  const r = cueRoute({ maxChannels: 4, outputs, mainId: 'flx' });
  assert.equal(r.mode, 'channels');
  assert.deepEqual(r.master, [0, 1]);
  assert.deepEqual(r.cue, [2, 3]);
  assert.equal(r.channels, 4);
  // 6 or 8 outputs still use 3-4
  assert.deepEqual(cueRoute({ maxChannels: 8, outputs, mainId: 'flx' }).cue, [2, 3]);
});

test('a driver that shows the headphones as their own output', () => {
  const r = cueRoute({ maxChannels: 2, outputs, mainId: 'flx' });
  assert.equal(r.mode, 'device');
  assert.equal(r.deviceId, 'hpdev');
  assert.ok(looksLikeHeadphones('Headphones (DDJ-FLX4)'));
  assert.ok(!looksLikeHeadphones('Headphones (Realtek Audio)'), 'laptop headphones are not picked on their own');
});

test('room sound on the laptop, controller plugged in: its headphone socket (3-4) still works', () => {
  const r = cueRoute({ maxChannels: 2, outputs: outputs.slice(0, 2), mainId: 'mac' });
  assert.equal(r.mode, 'device');
  assert.equal(r.deviceId, 'flx');
  assert.deepEqual(r.cue, [2, 3]);
  assert.match(r.why, /MacBook Pro Speakers/);
  // a plain second output (not a controller) plays on its 1-2
  assert.deepEqual(cueRoute({ maxChannels: 2, outputs, mainId: 'flx', choice: { device: 'mac' } }).cue, [0, 1]);
});

test('stereo only: Listen through the speakers, with a setup tip for the controller', () => {
  const r = cueRoute({ maxChannels: 2, outputs: outputs.slice(0, 2), mainId: 'flx' });
  assert.equal(r.mode, 'speakers');
  assert.match(setupTip(r, { platform: 'win32', mainLabel: 'DDJ-FLX4' }), /Quadraphonic/);
  assert.match(setupTip(r, { platform: 'darwin', mainLabel: 'DDJ-FLX4' }), /Audio MIDI Setup/);
  assert.match(setupTip(r, { mainLabel: 'MacBook Pro Speakers' }), /Choose your controller/);
  assert.equal(setupTip({ mode: 'channels' }), null);
});

test('the user can choose', () => {
  assert.equal(cueRoute({ maxChannels: 4, outputs, mainId: 'flx', choice: 'speakers' }).mode, 'speakers');
  assert.equal(cueRoute({ maxChannels: 2, outputs, mainId: 'flx', choice: 'channels' }).mode, 'speakers');
  assert.equal(cueRoute({ maxChannels: 2, outputs, mainId: 'flx', choice: { device: 'mac' } }).deviceId, 'mac');
  assert.equal(cueRoute({ maxChannels: 2, outputs, mainId: 'flx', choice: { device: 'gone' } }).mode, 'speakers');
  assert.equal(cueRoute({ maxChannels: 4, outputs, mainId: 'flx', choice: { device: 'flx' } }).mode, 'channels');
});

test('headphone mix is equal power from cue to room', () => {
  assert.deepEqual(headphoneMix(0), { cue: 1, master: 0 });
  const mid = headphoneMix(0.5);
  assert.ok(Math.abs(mid.cue ** 2 + mid.master ** 2 - 1) < 1e-9);
  assert.ok(headphoneMix(1).cue < 1e-9);
  assert.deepEqual(headphoneMix(-3), headphoneMix(0));
});

test('the FLX4 headphone CUE buttons and MIX knob reach the app', () => {
  const p = findController('ddj-flx4'), ctl = emptyController();
  assert.deepEqual(midiToAction(p, ctl, [0x91, 0x54, 0x7f]), { type: 'listen', side: 'right', on: true });
  assert.deepEqual(midiToAction(p, ctl, [0x91, 0x54, 0x7f]), { type: 'listen', side: 'right', on: false });
  const mixCodes = p.controls.filter((c) => c[2] === 'm.headMix');
  assert.ok(mixCodes.length, 'the FLX4 map has the headphone mix knob');
  const msb = mixCodes.find((c) => c[3] === 'msb') || mixCodes[0];
  const a = midiToAction(p, ctl, [msb[0], msb[1], 127]);
  assert.equal(a.type, 'headMix');
  assert.ok(a.value > 0.95);
});
