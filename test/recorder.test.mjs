import test from 'node:test';
import assert from 'node:assert/strict';
import { pickMime, extFor, fileName, elapsed } from '../js/recorder.js';

test('recording format and file names', () => {
  assert.equal(pickMime((t) => t === 'audio/webm'), 'audio/webm');
  assert.equal(pickMime((t) => t.startsWith('audio/webm;')), 'audio/webm;codecs=opus');
  assert.equal(pickMime(() => false), '');
  assert.equal(extFor('audio/ogg;codecs=opus'), 'ogg');
  assert.equal(extFor('audio/mp4'), 'm4a');
  assert.equal(fileName('set', new Date(2026, 10, 21, 18, 5)), 'Cue Coach set 2026-11-21 18.05.webm');
  assert.equal(elapsed(65), '1:05');
  assert.equal(elapsed(3723), '1:02:03');
});
