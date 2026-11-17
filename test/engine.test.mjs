import test from 'node:test';
import assert from 'node:assert/strict';
import { toCamelot, keyRelation, parseRekordboxXML, demoLibrary } from '../js/library.js';
import { pitchNeeded, suggestNext, structureFromEnergy, mixInPoints, planTransition, barAt, timeOfBar } from '../js/engine.js';

test('camelot conversion', () => {
  assert.equal(toCamelot('Am'), '8A');
  assert.equal(toCamelot('C'), '8B');
  assert.equal(toCamelot('F#m'), '11A');
  assert.equal(toCamelot('Dbm'), '12A');
  assert.equal(toCamelot('Abmin'), '1A');
  assert.equal(toCamelot('5a'), '5A');
  assert.equal(toCamelot('nonsense'), null);
});

test('key relations', () => {
  assert.equal(keyRelation('8A', '8A').score, 1);
  assert.equal(keyRelation('8A', '9A').label, '+1 · lifts energy');
  assert.equal(keyRelation('12A', '1A').label, '+1 · lifts energy');
  assert.equal(keyRelation('8A', '8B').score, 0.85);
  assert.equal(keyRelation('8A', '3B').label, 'key clash');
});

test('pitch needed handles half/double time', () => {
  assert.ok(Math.abs(pitchNeeded(126, 124).pct - 1.61) < 0.01);
  assert.equal(pitchNeeded(174, 87).mode, '2x');
});

test('parse rekordbox xml', () => {
  const xml = `<?xml version="1.0"?><DJ_PLAYLISTS><COLLECTION Entries="1">
  <TRACK TrackID="12" Name="Song &amp; Co" Artist="X" Genre="House" TotalTime="300" AverageBpm="124.00" Tonality="Am" Rating="204" Location="file://localhost/Users/me/Music/Song%20Co.mp3" Comments="Energy 7">
    <TEMPO Inizio="0.512" Bpm="124.00" Metro="4/4" Battito="3"/>
    <POSITION_MARK Name="Mix" Type="0" Start="31.5" Num="0"/>
  </TRACK></COLLECTION><PLAYLISTS><NODE><TRACK Key="12"/></NODE></PLAYLISTS></DJ_PLAYLISTS>`;
  const [t] = parseRekordboxXML(xml);
  assert.equal(t.title, 'Song & Co');
  assert.equal(t.camelot, '8A');
  assert.equal(t.rating, 4);
  assert.equal(t.energy, 7);
  assert.equal(t.fileName, 'Song Co.mp3');
  // Battito 3 at 0.512s → downbeat 2 beats earlier, wrapped into first bar
  const beat = 60 / 124;
  assert.ok(Math.abs(t.grid.firstDownbeat - (0.512 - 2 * beat + 4 * beat)) < 1e-9);
  assert.equal(t.cues[0].num, 0);
});

test('suggestions rank compatible tracks first and skip played', () => {
  const lib = demoLibrary(40);
  const cur = lib[0];
  const s = suggestNext(cur, lib, { played: new Set([lib[1].id]) });
  assert.ok(s.length > 0);
  assert.ok(!s.some((x) => x.track.id === lib[1].id || x.track.id === cur.id));
  for (let i = 1; i < s.length; i++) assert.ok(s[i - 1].score >= s[i].score);
  assert.ok(s[0].key.score >= 0.85, `top pick key: ${s[0].key.label}`);
});

test('structure detection finds drop and outro in the demo arrangement', () => {
  // intro 32 (kick only, 0.4), build 16 (0.3), drop 32 (1), break 16 (0.05), drop 32 (1), outro 32 (0.4)
  const e = [...Array(32).fill(0.4), ...Array(16).fill(0.3), ...Array(32).fill(1), ...Array(16).fill(0.05), ...Array(32).fill(1), ...Array(32).fill(0.4)];
  const st = structureFromEnergy(e);
  assert.equal(st.firstDrop, 49);
  assert.equal(st.outroStart, 129);
  assert.ok(st.breaks.includes(81));
});

test('mix-in points and transition plan line up on bars', () => {
  const [A, B] = demoLibrary(2);
  const pts = mixInPoints(B, null);
  assert.equal(pts[0].bar, 1);
  assert.ok(pts.some((p) => p.label === 'Hot cue A'));
  const plan = planTransition(A, B, null, null);
  assert.equal(plan.blendBars % 8, 0);
  assert.equal(barAt(A.grid, plan.outTime + 0.01), plan.outBar);
  assert.ok(Math.abs(timeOfBar(A.grid, plan.outBar) - plan.steps[0].a) < 1e-9);
});

test('rekordbox phrases drive drop and outro', async () => {
  const { structureFromPhrases, mixOutPoint } = await import('../js/engine.js');
  const grid = { bpm: 120, firstDownbeat: 0.5 }; // 2 s per bar
  const phrases = [
    { label: 'Intro', start: 0.5, end: 64.5 }, { label: 'Up', start: 64.5, end: 96.5 },
    { label: 'Chorus', start: 96.5, end: 160.5 }, { label: 'Down', start: 160.5, end: 192.5 },
    { label: 'Chorus', start: 192.5, end: 256.5 }, { label: 'Outro', start: 256.5, end: 320.5 },
  ];
  const st = structureFromPhrases(phrases, grid);
  assert.deepEqual([st.firstDrop, st.outroStart, st.breaks], [49, 129, [81]]);
  const out = mixOutPoint({ grid, duration: 322 }, { structure: st });
  assert.equal(out.bar, 129);
  assert.match(out.why, /Outro/);
});

test('samples and loops are not suggested; start points stay inside the track', async () => {
  const { suggestNext, mixInPoints } = await import('../js/engine.js');
  const cur = { id: 'a', bpm: 128, camelot: '8A', duration: 300 };
  const loop = { id: 'b', bpm: 128, camelot: '8A', duration: 7 };
  const song = { id: 'c', bpm: 127, camelot: '8A', duration: 320 };
  assert.deepEqual(suggestNext(cur, [cur, loop, song]).map((x) => x.track.id), ['c']);
  const pts = mixInPoints({ ...loop, grid: { bpm: 128, firstDownbeat: 0 }, cues: [] }, null);
  assert.deepEqual(pts.map((p) => p.bar), [1]);
});
