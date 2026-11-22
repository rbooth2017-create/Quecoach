import test from 'node:test';
import assert from 'node:assert/strict';
import {
  sortTracks, filterTracks, gridStatus, gridSetOne, gridNudge, gridShiftBeat, gridSetBpm, tapTempo, snapTime, beatsBetween,
  hotCues, setHotCue, clearHotCue, addMemoryCue, removeMemoryCue, renameMemoryCue, memoryCues,
  transition, setStats, newSetList, editSetList, renameSetList, deleteSetList, duplicateSetList, addItems, removeItems, moveItems,
  toM3U, fmtDur, fmtCue,
} from '../js/managermodel.js';

const T = (id, o = {}) => ({ id, title: id, artist: '', genre: '', bpm: 124, camelot: '8A', duration: 300, analysed: true, grid: { bpm: 124, firstDownbeat: 0.5 }, ...o });

test('sort by BPM puts tracks without one last, in both directions', () => {
  const ts = [T('a', { bpm: 128 }), T('b', { bpm: null }), T('c', { bpm: 120 })];
  assert.deepEqual(sortTracks(ts, 'bpm', 1).map((t) => t.id), ['c', 'a', 'b']);
  assert.deepEqual(sortTracks(ts, 'bpm', -1).map((t) => t.id), ['a', 'c', 'b']);
});

test('sort by key follows the Camelot wheel, A before B', () => {
  const ts = [T('x', { camelot: '10A' }), T('y', { camelot: '2B' }), T('z', { camelot: '2A' })];
  assert.deepEqual(sortTracks(ts, 'key').map((t) => t.id), ['z', 'y', 'x']);
});

test('filters: words, BPM range, mixable keys, grids to check', () => {
  const ts = [T('Night Drive', { camelot: '8A', bpm: 122 }), T('Sun', { camelot: '3B', bpm: 128 }), T('Moon', { camelot: '9A', bpm: 126, grid: null })];
  assert.deepEqual(filterTracks(ts, { query: 'night' }).map((t) => t.id), ['Night Drive']);
  assert.deepEqual(filterTracks(ts, { bpmMin: 124, bpmMax: 127 }).map((t) => t.id), ['Moon']);
  assert.deepEqual(filterTracks(ts, { matchKey: '8A' }).map((t) => t.id), ['Night Drive', 'Moon']);
  assert.deepEqual(filterTracks(ts, { gridTodo: true }).map((t) => t.id), ['Moon']);
});

test('grid status', () => {
  assert.equal(gridStatus(T('a')), 'ok');
  assert.equal(gridStatus(T('a', { grid: null })), 'none');
  assert.equal(gridStatus(T('a', { grid: { bpm: 120, firstDownbeat: 0, approx: true }, analysed: false })), 'approx');
  assert.equal(gridStatus(T('a', { grid: { bpm: 120, firstDownbeat: 0, adjusted: true } })), 'adjusted');
  assert.equal(gridStatus(T('a', { grid: { bpm: 120, firstDownbeat: 0, estimated: true, fit: 1 } })), 'unsure');
});

test('grid edits mark the grid as checked and leave the old one alone', () => {
  const g = { bpm: 120, firstDownbeat: 0.25, estimated: true };
  const one = gridSetOne(g, 1.2345);
  assert.equal(one.firstDownbeat, 1.235); assert.equal(one.adjusted, true); assert.equal(g.adjusted, undefined);
  assert.equal(gridNudge(g, 0.005).firstDownbeat, 0.255);
  assert.equal(gridNudge({ bpm: 120, firstDownbeat: 0.01 }, -0.02).firstDownbeat, 1.99); // wraps by a bar
  const b1 = gridShiftBeat(one); assert.equal(b1.firstDownbeat, 1.735);
  const b4 = gridShiftBeat(gridShiftBeat(gridShiftBeat(b1))); assert.equal(b4.firstDownbeat, 1.235); // back to the bar you set
  assert.equal(gridSetBpm(g, 124.456).bpm, 124.46);
  assert.equal(gridSetBpm(g, 20), null);
});

test('tap tempo needs four taps and restarts after a pause', () => {
  let r = { taps: [] };
  for (const t of [0, 500, 1000]) r = tapTempo(r.taps, t);
  assert.equal(r.bpm, null); assert.equal(r.more, 1);
  r = tapTempo(r.taps, 1500); assert.equal(r.bpm, 120);
  r = tapTempo(r.taps, 5000); assert.deepEqual(r.taps, [5000]);
});

test('snap and beats in view', () => {
  const g = { bpm: 120, firstDownbeat: 1 };
  assert.equal(snapTime(g, 1.26), 1.5);
  assert.equal(snapTime(null, 1.26), 1.26);
  const beats = beatsBetween(g, 0.4, 3.1);
  assert.deepEqual(beats.map((b) => [b.time, b.bar, b.beat]), [[0.5, 0, 4], [1, 1, 1], [1.5, 1, 2], [2, 1, 3], [2.5, 1, 4], [3, 2, 1]]);
});

test('hot cues: yours win over rekordbox, false hides one', () => {
  const t = { cues: [{ num: 0, time: 10 }, { num: 1, time: 20 }, { num: -1, time: 5 }] };
  let own = setHotCue([], 2, 30.0004);
  assert.deepEqual(hotCues(t, own).slice(0, 3), [10, 20, 30]);
  own = clearHotCue(own, 0);
  assert.deepEqual(hotCues(t, own).slice(0, 3), [null, 20, 30]);
  assert.equal(hotCues(t, own).length, 8);
});

test('memory cues stay sorted, once per spot, with rekordbox ones read-only', () => {
  let m = addMemoryCue([], 64, 'Drop');
  m = addMemoryCue(m, 32, 'Build');
  m = addMemoryCue(m, 32.02, 'dupe');
  assert.deepEqual(m.map((c) => c.name), ['Build', 'Drop']);
  m = renameMemoryCue(m, 64, 'Big drop');
  assert.equal(m[1].name, 'Big drop');
  assert.deepEqual(removeMemoryCue(m, 32).map((c) => c.time), [64]);
  const all = memoryCues({ cues: [{ num: -1, time: 1, comment: 'rb' }] }, m);
  assert.deepEqual(all.map((c) => [c.time, !!c.fixed]), [[1, true], [32, false], [64, false]]);
});

test('transition chip between two tracks', () => {
  const tr = transition(T('a', { camelot: '8A', bpm: 124, energy: 5 }), T('b', { camelot: '9A', bpm: 126, energy: 7 }));
  assert.equal(tr.key, '8A → 9A'); assert.equal(tr.bpm, '+2 BPM'); assert.equal(tr.energy, 1);
  assert.ok(['great', 'good'].includes(tr.level));
  assert.equal(transition(T('a'), T('b')).bpm, 'same BPM');
  assert.equal(transition(null, T('b')), null);
});

test('set stats', () => {
  const s = setStats([T('a', { bpm: 120, duration: 240 }), T('b', { bpm: 128, duration: 360 })]);
  assert.equal(s.count, 2); assert.equal(s.fullMinutes, 10); assert.equal(s.minutes, 8);
  assert.equal(s.bpmMin, 120); assert.equal(s.bpmMax, 128);
});

test('set lists: new, edit in place, rename, duplicate, delete', () => {
  let { list, id } = newSetList([], 'Friday', ['a', 'b', 'a'], 1000);
  assert.equal(list[0].title, 'Friday'); assert.equal(list[0].count, 2); assert.equal(list[0].set.savedId, id);
  const second = newSetList(list, 'Friday', [], 2000);
  assert.equal(second.list[0].title, 'Friday 2');
  list = editSetList(second.list, id, (items) => addItems(items, ['c', 'b']), 3000);
  assert.deepEqual(list[1].set.items.map((i) => i.id), ['a', 'b', 'c']); assert.equal(list[1].count, 3);
  assert.equal(list[1].id, id); // stayed in its place
  assert.equal(renameSetList(list, id, '  ').find((x) => x.id === id).title, 'Friday');
  assert.equal(renameSetList(list, id, 'Friday 2').find((x) => x.id === id).title, 'Friday 2 2');
  const dup = duplicateSetList(list, id, 4000);
  assert.equal(dup.list[0].title, 'Friday copy'); assert.deepEqual(dup.list[0].set.items.map((i) => i.id), ['a', 'b', 'c']);
  assert.equal(deleteSetList(dup.list, id).length, 2);
});

test('move and remove items', () => {
  const items = ['a', 'b', 'c', 'd'].map((id) => ({ id }));
  assert.deepEqual(moveItems(items, ['d'], 0).map((i) => i.id), ['d', 'a', 'b', 'c']);
  assert.deepEqual(moveItems(items, ['a', 'c'], 1).map((i) => i.id), ['b', 'a', 'c', 'd']);
  assert.deepEqual(removeItems(items, ['b']).map((i) => i.id), ['a', 'c', 'd']);
});

test('M3U leaves out tracks with no file', () => {
  const m = toM3U('Set', [T('a', { artist: 'X', path: '/m/a.mp3', duration: 61.4 }), T('b')]);
  assert.equal(m, '#EXTM3U\n#PLAYLIST:Set\n#EXTINF:61,X - a\n/m/a.mp3\n');
});

test('time formats', () => {
  assert.equal(fmtDur(307), '5:07'); assert.equal(fmtDur(0), '–');
  assert.equal(fmtCue(62.346), '1:02.35'); assert.equal(fmtCue(null), '–');
});
