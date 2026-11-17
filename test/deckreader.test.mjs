import test from 'node:test';
import assert from 'node:assert/strict';
import { matchDeck, readBpm, similarity } from '../js/deckreader.js';

// Titles like rekordbox's own sample library
const LIB = [
  'NOISE', 'SINEWAVE', 'SIREN', 'HORN', 'Demo Track 1', 'Demo Track 2', 'CYMBAL', 'SHORT BOOM', "LET'S GO",
  'House 1', 'House 2', 'House 3', 'House 4', 'Techno 1', 'Breaks 1', 'Breaks 2', 'BOOM DOWN LIFTER2',
].map((title, i) => ({ id: String(i), title, artist: /Demo|BOOM|SHORT|LET/.test(title) ? 'Loopmasters' : 'rekordbox', bpm: { 'Demo Track 1': 128, 'Demo Track 2': 120 }[title] || 0 }));

// Real OCR output (tesseract.js) of rekordbox's deck headers
const DECK1 = 'Rm\nEXPORT v3 ® @ TRAL OO () —: .\nDemo Track 1 | BEATSYNC |\n© Loopmasters | -00:35.7 02:16.6 | | 128.00';
const DECK2 = 'G Demo Track 2 | BEATSYNG |\nLoopmasters N | -01:382 0020.7 | | 120.00 | memory\n> B TCR MC IC blanklist [EI = ES [EI = ES EB blanklist';

test('matches real OCR of both deck headers to the right tracks', () => {
  const d1 = matchDeck(DECK1, LIB), d2 = matchDeck(DECK2, LIB);
  assert.equal(d1.track?.title, 'Demo Track 1');
  assert.equal(d2.track?.title, 'Demo Track 2');
  assert.equal(d1.bpm, 128);
  assert.equal(d2.bpm, 120);
});

test('tolerates OCR mistakes, prefers the longer exact title, and rejects junk', () => {
  assert.equal(matchDeck('Hause 3  rekordbox  140.00', LIB).track?.title, 'House 3');
  assert.equal(matchDeck('BOOM DOWN LIFTER2 Loopmasters', LIB).track?.title, 'BOOM DOWN LIFTER2');
  assert.equal(matchDeck('MEMORY HOT CUE INFO', LIB).track, null);
  assert.equal(matchDeck('', LIB).track, null);
});

test('reads the BPM, not the times', () => {
  assert.equal(readBpm('-01:38.2 00:29.7 120.00'), 120);
  assert.equal(readBpm('02:16.6 no bpm here'), null);
  assert.ok(similarity('beatsync', 'beatsyng') > 0.8);
});
