import test from 'node:test';
import assert from 'node:assert/strict';
import { EVENTS, AUDIENCES, setProfile, eventBrief, setSources, tracksFrom, trackFolder, makeSet, addToSet, removeFromSet, toggleInSet, moveInSet, voteInSet, inSet, mergeRefined, refineSet, quickSet, NEW_SET_TITLE } from '../js/setbuilder.js';
import { demoLibrary } from '../js/library.js';
import { featuresFor } from '../js/levels.js';

const LIB = demoLibrary(8);
const ids = (s) => s.items.map((i) => i.id);
const setOf = (...xs) => ({ title: 'T', story: '', ai: false, items: xs.map((x) => (typeof x === 'string' ? { id: x, why: '', tip: '', vote: 0 } : { why: '', tip: '', vote: 0, ...x })), played: [] });

test('+ with no set starts "My set"', () => {
  const s = addToSet(null, 'demo-1');
  assert.equal(s.title, NEW_SET_TITLE);
  assert.deepEqual(s.items, [{ id: 'demo-1', why: '', tip: '', vote: 0 }]);
  assert.deepEqual(s.played, []);
});

test('+ adds to the end, never twice, and leaves the old set alone', () => {
  const a = setOf('demo-1', 'demo-2');
  const b = addToSet(a, 'demo-3');
  assert.deepEqual(ids(b), ['demo-1', 'demo-2', 'demo-3']);
  assert.deepEqual(ids(a), ['demo-1', 'demo-2']);
  assert.equal(addToSet(b, 'demo-2'), b);
});

test('pressing + again on a track in the set takes it out', () => {
  let s = toggleInSet(null, 'demo-4');
  assert.ok(inSet(s, 'demo-4'));
  s = toggleInSet(s, 'demo-5');
  s = toggleInSet(s, 'demo-4');
  assert.deepEqual(ids(s), ['demo-5']);
  assert.equal(inSet(null, 'demo-4'), false);
});

test('removing a track also forgets it was played', () => {
  const s = { ...setOf('demo-1', 'demo-2'), played: ['demo-1'] };
  const r = removeFromSet(s, 'demo-1');
  assert.deepEqual(ids(r), ['demo-2']);
  assert.deepEqual(r.played, []);
  assert.equal(removeFromSet(null, 'x'), null);
});

test('drag to reorder moves one row', () => {
  const s = setOf('a', 'b', 'c', 'd');
  assert.deepEqual(ids(moveInSet(s, 0, 2)), ['b', 'c', 'a', 'd']);
  assert.deepEqual(ids(moveInSet(s, 3, 0)), ['d', 'a', 'b', 'c']);
  assert.deepEqual(ids(moveInSet(s, 1, 99)), ['a', 'c', 'd', 'b']);
  assert.equal(moveInSet(s, 2, 2), s);
  assert.equal(moveInSet(s, 9, 0), s);
});

test('thumbs set a verdict, and the same thumb again clears it', () => {
  let s = setOf('a', 'b');
  s = voteInSet(s, 'a', 1);
  assert.equal(s.items[0].vote, 1);
  s = voteInSet(s, 'a', -1);
  assert.equal(s.items[0].vote, -1);
  s = voteInSet(s, 'a', -1);
  assert.equal(s.items[0].vote, 0);
  assert.equal(s.items[1].vote, 0);
});

test('makeSet turns builder output into saved items with no votes', () => {
  const items = quickSet(LIB, { minutes: 20, vibe: 'journey' });
  const s = makeSet({ title: 'Journey set', story: 'x', items });
  assert.equal(s.items.length, items.length);
  assert.ok(s.items.every((i) => i.vote === 0 && typeof i.why === 'string' && i.tip === ''));
  assert.deepEqual(ids(s), items.map((i) => i.track.id));
});

test('refine keeps 👍 tracks in place, never brings back a 👎 track and drops unknown ids', () => {
  const s = setOf({ id: 'a', vote: 1 }, { id: 'b', vote: -1 }, 'c', { id: 'd', vote: 1 }, 'e');
  const known = new Set(['a', 'b', 'c', 'd', 'e', 'x', 'y', 'z']);
  const r = mergeRefined(s, [{ id: 'x', why: 'w', tip: 't' }, { id: 'b' }, { id: 'a' }, { id: 'nope' }, { id: 'y' }, { id: 'y' }, { id: 'z' }], known);
  assert.deepEqual(ids(r), ['a', 'x', 'y', 'd', 'z']);
  assert.equal(r.items[0].vote, 1);
  assert.equal(r.items[3].vote, 1);
  assert.deepEqual(r.items[1], { id: 'x', why: 'w', tip: 't', vote: 0 });
});

test('refine with too few new tracks closes up behind the kept ones', () => {
  const s = { ...setOf('a', 'b', { id: 'c', vote: 1 }, 'd', { id: 'e', vote: 1 }), played: ['a', 'c'] };
  const r = mergeRefined(s, [{ id: 'q' }]);
  assert.deepEqual(ids(r), ['q', 'c', 'e']);
  assert.deepEqual(r.played, ['c']);
});

test('refine without AI swaps only the 👎 tracks, in their slots', () => {
  const s = setOf({ id: 'demo-1', vote: 1 }, { id: 'demo-2', vote: -1 }, 'demo-3', { id: 'demo-4', vote: -1 });
  const { set: r, swapped, dropped } = refineSet(LIB, s, { vibe: 'journey', minutes: 20 });
  assert.equal(swapped, 2);
  assert.equal(dropped, 0);
  assert.equal(r.items.length, 4);
  assert.equal(r.items[0].id, 'demo-1');
  assert.equal(r.items[0].vote, 1);
  assert.equal(r.items[2].id, 'demo-3');
  const fresh = [r.items[1].id, r.items[3].id];
  for (const id of fresh) assert.ok(!['demo-1', 'demo-2', 'demo-3', 'demo-4'].includes(id), id);
  assert.notEqual(fresh[0], fresh[1]);
  assert.match(r.items[1].why, /^Swapped in/);
  assert.equal(r.items[1].vote, 0);
  assert.deepEqual(ids(s), ['demo-1', 'demo-2', 'demo-3', 'demo-4']); // untouched
});

test('refine without AI picks the best fit for the slot', () => {
  // The only free tracks are demo-7 and demo-8; the swap must be one of them and must mix out of demo-1.
  const lib = LIB;
  const s = setOf('demo-1', { id: 'demo-2', vote: -1 }, 'demo-3', 'demo-4', 'demo-5', 'demo-6');
  const { set: r } = refineSet(lib, s);
  assert.ok(['demo-7', 'demo-8'].includes(r.items[1].id));
});

test('refine without AI drops a 👎 track when nothing is left to swap in', () => {
  const lib = LIB.slice(0, 3);
  const s = setOf('demo-1', { id: 'demo-2', vote: -1 }, 'demo-3');
  const { set: r, swapped, dropped } = refineSet(lib, s);
  assert.deepEqual(ids(r), ['demo-1', 'demo-3']);
  assert.equal(swapped, 0);
  assert.equal(dropped, 1);
});

test('refine without AI and no 👎 changes nothing', () => {
  const s = setOf('demo-1', { id: 'demo-2', vote: 1 }, 'demo-3');
  const { set: r, swapped } = refineSet(LIB, s);
  assert.equal(swapped, 0);
  assert.deepEqual(r.items, s.items);
});

test('the side panel opens on the set for Confident and Pro, on lessons before that', () => {
  assert.deepEqual(['starter', 'improver', 'confident', 'pro'].map((l) => featuresFor(l).setFirst), [false, false, true, true]);
});

test('Build from lists All music, crates, then folders', () => {
  const tracks = [
    { id: 'a', libId: 'L1', relPath: 'Music/House/a.mp3' },
    { id: 'b', libId: 'L2', relPath: 'Music/House/b.mp3' },
    { id: 'c', libId: 'L3', relPath: 'Music/Disco/c.mp3' },
    { id: 'd', path: 'C:\\Users\\me\\Music\\Techno\\d.wav' },
  ];
  const crates = [{ id: 'k1', name: 'Warm-up', trackIds: ['L3', 'L1', 'gone'] }];
  const s = setSources(tracks, crates);
  assert.deepEqual(s.map((x) => [x.id, x.name, x.count]), [
    ['all', 'All music', 4],
    ['crate:k1', 'Warm-up', 2],
    ['folder:C:/Users/me/Music/Techno', 'Music / Techno', 1],
    ['folder:Music/Disco', 'Music / Disco', 1],
    ['folder:Music/House', 'Music / House', 2],
  ]);
  assert.deepEqual(tracksFrom(tracks, crates, 'crate:k1').map((t) => t.id), ['a', 'c']);
  assert.deepEqual(tracksFrom(tracks, crates, 'folder:Music/House').map((t) => t.id), ['a', 'b']);
  assert.equal(tracksFrom(tracks, crates, 'folder:Gone').length, 4);
  assert.equal(tracksFrom(tracks, crates, 'crate:nope').length, 4);
  assert.equal(trackFolder({ id: 'p' }), '');
});

test('one folder, or no paths at all, offers only All music', () => {
  assert.equal(setSources(demoLibrary(4)).length, 1);
  assert.equal(setSources([{ id: 'a', relPath: 'X/a.mp3' }, { id: 'b', relPath: 'X/b.mp3' }]).length, 1);
});

test('Generate and Refine stay inside the chosen folder', () => {
  const house = new Set(['demo-1', 'demo-3', 'demo-5', 'demo-7']);
  const from = LIB.filter((t) => house.has(t.id));
  assert.ok(quickSet(from, { minutes: 60 }).every((i) => house.has(i.track.id)));
  const s = setOf('demo-1', { id: 'demo-3', vote: -1 });
  const { set: r } = refineSet(LIB, s, { from });
  assert.ok(house.has(r.items[1].id) && r.items[1].id !== 'demo-3');
});

test('every event and crowd explains itself and briefs the AI', () => {
  for (const e of EVENTS) assert.ok(e.name && e.blurb && e.story && e.ai && (e.usesVibe || e.curve), e.id);
  for (const a of AUDIENCES) assert.ok(a.name && a.blurb && a.ai, a.id);
  assert.match(eventBrief({ event: 'wedding', audience: 'family' }), /wedding.*clean lyrics/is);
  assert.equal(eventBrief({}), eventBrief({ event: 'club', audience: 'mixed' }));
});

test('a wedding starts gentle, peaks late and cares less about matching than a club night', () => {
  const club = setProfile({ event: 'club', vibe: 'peak' }), wed = setProfile({ event: 'wedding' });
  assert.ok(wed.energy(0) < club.energy(0));
  assert.ok(wed.energy(0.75) > wed.energy(0.1));
  assert.ok(wed.match < club.match);
  assert.ok(wed.familiar > club.familiar);
});

test('the crowd moves the energy, and a family crowd or a bar never gets too intense', () => {
  const young = setProfile({ event: 'party', audience: 'young' }), older = setProfile({ event: 'party', audience: 'older' });
  assert.ok(young.energy(0.5) > older.energy(0.5));
  for (const t of [0, 0.25, 0.5, 0.75, 1]) {
    assert.ok(setProfile({ event: 'festival', vibe: 'peak', audience: 'family' }).energy(t) <= 7);
    assert.ok(setProfile({ event: 'bar', audience: 'young' }).energy(t) <= 6);
  }
  assert.equal(setProfile({ event: 'nope', audience: 'nope' }).event.id, 'club');
});

test('a wedding set reaches for the songs people know', () => {
  // Same tracks; the well-loved ones (5 stars) mix worse. A wedding should still pick them more than a club night.
  const lib = demoLibrary(60).map((t, i) => ({ ...t, rating: i % 4 === 0 ? 5 : 0 }));
  const loved = (items) => items.filter((i) => i.track.rating === 5).length / items.length;
  const wed = quickSet(lib, { minutes: 45, event: 'wedding', audience: 'mixed' });
  const club = quickSet(lib, { minutes: 45, event: 'club', audience: 'heads', vibe: 'journey' });
  assert.ok(loved(wed) > loved(club), `${loved(wed)} vs ${loved(club)}`);
});
