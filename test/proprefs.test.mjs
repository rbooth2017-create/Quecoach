import test from 'node:test';
import assert from 'node:assert/strict';
import { loadPrefs, DEFAULTS, stepZoom, canLeaveYoung } from '../js/prefs.js';
import { ACTIONS, ACTION_IDS, comboOf, loadKeys, changedKeys, actionFor, actionForEvent, rebind, keyLabel } from '../js/keymap.js';
import { newSession, logPlay, saveSessions, toText, toCSV, since, KEEP_SESSIONS } from '../js/history.js';
import { TEMPO_RANGES, nextTempoRange } from '../js/levels.js';

test('prefs: defaults, checking and the lane zoom', () => {
  assert.deepEqual(loadPrefs(null), DEFAULTS);
  const p = loadPrefs({ mode: 'pro', latency: 'nope', tempoRange: 50, youngPin: '12a4', boothLevel: 9, laneZoom: 7 });
  assert.equal(p.mode, 'pro'); assert.equal(p.latency, 'interactive'); assert.equal(p.tempoRange, 50);
  assert.equal(p.youngPin, ''); assert.equal(p.boothLevel, 1.5); assert.equal(p.laneZoom, 1);
  assert.equal(loadPrefs({ limiter: false }).limiter, false);
  assert.equal(stepZoom(1, 1), 1.5); assert.equal(stepZoom(4, 1), 4); assert.equal(stepZoom(0.5, -1), 0.5);
});

test('Young DJ mode needs its PIN to switch off', () => {
  assert.equal(canLeaveYoung({ young: true, youngPin: '1234' }, '0000'), false);
  assert.equal(canLeaveYoung({ young: true, youngPin: '1234' }, '1234'), true);
  assert.equal(canLeaveYoung({ young: false }, ''), true);
});

test('keys: every action has its own default, and Shift works for bigger steps', () => {
  const defs = ACTION_IDS.map((id) => ACTIONS[id].def);
  assert.equal(new Set(defs).size, defs.length, 'no two actions share a default key');
  const keys = loadKeys(null);
  assert.deepEqual(actionFor(keys, 'q'), { id: 'a.play', shift: false });
  assert.deepEqual(actionForEvent(keys, { key: 'ArrowUp', code: 'ArrowUp', shiftKey: true }), { id: 'b.faster', shift: true });
  assert.deepEqual(actionForEvent(keys, { key: 'Q', code: 'KeyQ', shiftKey: true }), { id: 'a.load', shift: false });
  assert.deepEqual(actionForEvent(keys, { key: 'S', code: 'KeyS', shiftKey: true }), { id: 'a.faster', shift: true });
  assert.equal(comboOf({ key: '!', code: 'Digit1', shiftKey: true }), 'shift+1');
  assert.equal(comboOf({ key: '?', code: 'Slash', shiftKey: true }), '?');
  assert.equal(comboOf({ key: 'q', code: 'KeyQ', metaKey: true }), null, 'Cmd/Ctrl shortcuts stay the system\'s');
  assert.equal(comboOf({ key: 'Escape', code: 'Escape' }), null);
});

test('keys: rebinding takes the key from whatever had it, and only changes are saved', () => {
  let { keys, freed } = rebind(loadKeys(null), 'a.loop', 'q');
  assert.equal(keys['a.loop'], 'q'); assert.deepEqual(freed, ['a.play']); assert.equal(keys['a.play'], '');
  assert.deepEqual(changedKeys(keys), { 'a.loop': 'q', 'a.play': '' });
  assert.deepEqual(loadKeys(changedKeys(keys)), keys);
  assert.deepEqual(keyLabel('shift+q'), ['Shift', 'Q']); assert.deepEqual(keyLabel('arrowup'), ['↑']);
});

test('tempo ranges cycle like a CDJ', () => {
  assert.equal(nextTempoRange(16), 50); assert.equal(nextTempoRange(50), TEMPO_RANGES[0]);
});

test('set history: one entry per track the room heard, exported as a tracklist', () => {
  const t0 = Date.UTC(2026, 10, 22, 21, 0, 0);
  let s = newSession(t0);
  const a = { id: '1', title: 'Night Drive', artist: 'Kora Vale', bpm: 122.04, camelot: '8A' }, b = { id: '2', title: 'Glass, House', artist: 'Mono Atlas', bpm: 124 };
  s = logPlay(s, a, t0); s = logPlay(s, a, t0 + 5000); s = logPlay(s, b, t0 + 245000);
  assert.equal(s.tracks.length, 2); assert.equal(s.tracks[0].bpm, 122);
  assert.equal(since(t0, t0 + 3_725_000), '1:02:05');
  assert.match(toText(s), /1\.\s+0:00\s+Kora Vale - Night Drive/);
  assert.match(toText(s), /2\.\s+4:05\s+Mono Atlas - Glass, House/);
  assert.match(toCSV(s), /"Glass, House"/);
  const all = saveSessions(Array.from({ length: 40 }, (_, i) => ({ id: `x${i}`, tracks: [a] })), s);
  assert.equal(all.length, KEEP_SESSIONS); assert.equal(all[0].id, s.id);
  assert.deepEqual(saveSessions([], newSession()), [], 'an empty session isn\'t kept');
});
