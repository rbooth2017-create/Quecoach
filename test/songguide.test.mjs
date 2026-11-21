import test from 'node:test';
import assert from 'node:assert/strict';
import { trackSections, describeTrack, mixability, timelineSVG, beatsSVG, phraseSVG, mixMapSVG, GUIDE, GUIDE_PARTS, CHEAT_SHEET, sectionsFromBars, clock } from '../js/songguide.js';
import { PART_INFO } from '../js/mixplan.js';
import { demoLibrary } from '../js/library.js';

const bpm = 120, bl = 2; // 120 BPM: a bar is 2 seconds
const track = (parts, extra = {}) => {
  let bar = 0;
  const phrases = parts.map(([label, bars]) => { const p = { label, start: bar * bl, end: (bar + bars) * bl }; bar += bars; return p; });
  return { title: 'T', grid: { bpm, firstDownbeat: 0 }, phrases, duration: bar * bl, camelot: '8A', ...extra };
};

test('neighbouring phrases of the same part join into one section', () => {
  const s = trackSections(track([['Intro', 16], ['Intro', 16], ['Up', 16], ['Chorus', 16], ['Chorus', 16], ['Outro', 32]]));
  assert.deepEqual(s.map((x) => [x.key, x.bars, x.startBar]), [['Intro', 32, 1], ['Up', 16, 33], ['Chorus', 32, 49], ['Outro', 32, 81]]);
  assert.equal(s[1].name, 'Build');
  assert.equal(s[2].name, 'Drop');
});

test('describeTrack tells the story in order and finds the mix points', () => {
  const d = describeTrack(track([['Intro', 32], ['Up', 16], ['Chorus', 32], ['Down', 16], ['Chorus', 32], ['Outro', 32]]));
  assert.match(d.story[0], /32 bars intro|32-bar intro|32 bar/);
  assert.ok(d.story.some((s) => /first drop lands at 1:36, bar 49/.test(s)));
  assert.ok(d.story.some((s) => /breakdown/.test(s)));
  assert.equal(d.mixOut.bar, 129);
  assert.equal(d.mixIn.bar, 1);
  assert.equal(d.ease.id, 'easy');
  assert.match(d.shape, /2 drops/);
  assert.match(d.headline, /120\.0 BPM · key 8A/);
});

test('tracks with no intro or outro are marked tricky and still get a mix-out point', () => {
  const d = describeTrack(track([['Chorus', 64], ['Down', 16], ['Chorus', 64]]));
  assert.equal(d.ease.id, 'hard');
  assert.match(d.story[0], /no real intro/);
  assert.ok(d.mixOut.bar > 1 && (d.mixOut.bar - 1) % 16 === 0);
});

test('no grid or phrases: no breakdown', () => {
  assert.equal(describeTrack({ title: 'x' }), null);
  assert.equal(describeTrack({ grid: { bpm: 120, firstDownbeat: 0 }, phrases: [] }), null);
});

test('every practice track gets a breakdown', () => {
  for (const t of demoLibrary(6)) {
    const d = describeTrack(t);
    assert.ok(d && d.sections.length >= 5, t.title);
    assert.equal(d.sections[0].key, 'Intro');
  }
});

test('mixability scales with intro and outro room', () => {
  assert.equal(mixability(sectionsFromBars([['Intro', 8], ['Chorus', 32], ['Outro', 8]])).id, 'ok');
  assert.equal(mixability(sectionsFromBars([['Intro', 4], ['Chorus', 32], ['Outro', 32]])).id, 'hard');
});

test('pictures render as SVG with labels', () => {
  for (const svg of [beatsSVG(), phraseSVG(), mixMapSVG(), timelineSVG(sectionsFromBars(), { marks: [{ time: 10, label: 'In' }], now: 5 })]) {
    assert.match(svg, /^<svg[\s\S]*<\/svg>$/);
    assert.match(svg, /aria-label="[^"]+"/);
  }
  assert.equal(timelineSVG([]), '');
  assert.match(timelineSVG(sectionsFromBars()), /Breakdown/);
});

test('the guide uses the same part names as the deck labels', () => {
  assert.equal(GUIDE_PARTS.length, Object.keys(PART_INFO).length);
  for (const p of GUIDE_PARTS) assert.equal(p.name, PART_INFO[p.key].name);
  assert.deepEqual(GUIDE.map((g) => g.id), ['beats', 'phrases', 'parts', 'where']);
  assert.ok(GUIDE.every((g) => g.text.length && g.title));
  assert.ok(CHEAT_SHEET.length >= 4);
  assert.ok(!JSON.stringify(GUIDE).toLowerCase().includes('sync'));
});

test('clock', () => { assert.equal(clock(62.4), '1:02'); assert.equal(clock(NaN), '–:––'); });
