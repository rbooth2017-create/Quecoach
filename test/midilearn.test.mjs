import test from 'node:test';
import assert from 'node:assert/strict';
import { LEARN_STEPS, learnControl, buildProfile, learnedCount } from '../js/midilearn.js';
import { midiToAction, jogTicks } from '../js/learnmidi.js';
import { detectController, emptyController, findController } from '../js/controller.js';

const step = (id) => LEARN_STEPS.find((s) => s.id === id);

test('every step is unique and has words', () => {
  assert.equal(new Set(LEARN_STEPS.map((s) => s.id)).size, LEARN_STEPS.length);
  assert.ok(LEARN_STEPS.every((s) => s.title && s.text && ['button', 'knob', 'jog'].includes(s.kind)));
  assert.ok(LEARN_STEPS.some((s) => s.id === 'd1.headphones') && LEARN_STEPS.some((s) => s.id === 'm.headMix'));
});

test('learn buttons, 7-bit and 14-bit knobs, jogs and tempo direction', () => {
  assert.deepEqual(learnControl(step('d1.play'), [[0x90, 0x0b, 0x7f], [0x80, 0x0b, 0]]).controls, [[0x90, 0x0b, 'd1.play', 'note']]);
  assert.deepEqual(learnControl(step('d1.low'), [[0xb0, 0x0f, 10], [0xb0, 0x0f, 20]]).controls, [[0xb0, 0x0f, 'd1.low', '7']]);
  const fine = learnControl(step('d1.fader'), [[0xb0, 0x13, 10], [0xb0, 0x33, 5], [0xb0, 0x13, 11], [0xb0, 0x33, 90]]);
  assert.deepEqual(fine.controls, [[0xb0, 0x13, 'd1.fader', 'msb'], [0xb0, 0x33, 'd1.fader', 'lsb']]);
  assert.equal(learnControl(step('d1.jog'), [[0xb0, 0x21, 65], [0xb0, 0x21, 63]]).extra.jog, 'centered');
  assert.equal(learnControl(step('d1.jog'), [[0xb0, 0x21, 1], [0xb0, 0x21, 127]]).extra.jog, 'twos');
  assert.equal(learnControl(step('d1.tempo'), [[0xb0, 0x00, 0], [0xb0, 0x00, 127]]).extra.invertTempo, false);
  assert.equal(learnControl(step('d1.tempo'), [[0xb0, 0x00, 127], [0xb0, 0x00, 0]]).extra.invertTempo, true);
  assert.equal(learnControl(step('d1.play'), []), null);
  assert.equal(learnControl(step('d1.low'), [[0x90, 1, 127]]), null);
});

test('a learned profile drives the app like a built-in one', () => {
  const learned = {
    'd1.play': learnControl(step('d1.play'), [[0x90, 0x0b, 0x7f]]),
    'd1.jog': learnControl(step('d1.jog'), [[0xb0, 0x21, 1]]),
    'd1.tempo': learnControl(step('d1.tempo'), [[0xb0, 0x00, 127], [0xb0, 0x00, 0]]),
    'd2.headphones': learnControl(step('d2.headphones'), [[0x91, 0x54, 0x7f]]),
    'm.crossfader': learnControl(step('m.crossfader'), [[0xb6, 0x1f, 0], [0xb6, 0x1f, 127]]),
    'm.headMix': null,
  };
  assert.equal(learnedCount(learned), 5);
  const p = buildProfile('DDJ-FLX2', learned);
  assert.equal(p.id, 'custom:DDJ-FLX2');
  assert.equal(detectController('DDJ-FLX2', [p]), p);
  assert.equal(detectController('DDJ-FLX4 MIDI 1', [p]).id, 'ddj-flx4');
  const ctl = emptyController();
  assert.deepEqual(midiToAction(p, ctl, [0x90, 0x0b, 0x7f]), { type: 'play', side: 'left' });
  assert.deepEqual(midiToAction(p, ctl, [0x91, 0x54, 0x7f]), { type: 'listen', side: 'right', on: true });
  assert.equal(midiToAction(p, ctl, [0xb0, 0x21, 127]).ticks, -1);
  assert.ok(midiToAction(p, ctl, [0xb0, 0x00, 127], { tempoRange: 8 }).pct < 0, 'inverted slider: top (127) is slower');
  assert.equal(midiToAction(p, ctl, [0xb6, 0x1f, 127]).type, 'xfader');
  assert.equal(jogTicks({ id: 'x', jog: 'centered' }, 66), 2);
});

test('the DDJ-400 gets the FLX4 pads, loops and browse', () => {
  const p = findController('ddj-400'), ctl = emptyController();
  assert.deepEqual(midiToAction(p, ctl, [0x97, 0x02, 0x7f]), { type: 'pad', side: 'left', mode: 'hotcue', pad: 2, down: true, shift: false });
  assert.deepEqual(midiToAction(p, ctl, [0x90, 0x10, 0x7f]), { type: 'loopIn', side: 'left' });
  assert.equal(midiToAction(p, ctl, [0xb6, 0x40, 1]).type, 'browse');
});
