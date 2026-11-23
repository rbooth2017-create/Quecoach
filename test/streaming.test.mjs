import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import {
  trackLinks, spotifyTrackId, decodeText, parseDelimited, parsePlaylist, splitArtistTitle,
  norm, titleParts, artistNames, matchScore, matchPlaylist, playlistSummary, MUSIC_GUIDE,
} from '../js/streaming.js';
const M = createRequire(import.meta.url)('../desktop/libmodel.cjs');

const ID = '4uLU6hMCjMI75M1A2tKUQC';

test('links search by artist and title, or open the exact Spotify track', () => {
  const links = trackLinks({ title: 'Night Drive (Extended Mix)', artist: 'Kora Vale' });
  assert.deepEqual(links.map((l) => l.id), ['spotify', 'apple', 'beatport', 'juno', 'traxsource', 'bandcamp', 'amazon']);
  assert.equal(links[0].url, 'https://open.spotify.com/search/Kora%20Vale%20Night%20Drive%20(Extended%20Mix)');
  assert.equal(links[1].url, 'https://music.apple.com/search?term=Kora%20Vale%20Night%20Drive%20(Extended%20Mix)');
  assert.ok(links.every((l) => l.url.startsWith('https://')));
  assert.equal(trackLinks({ title: 'X', spotify: `spotify:track:${ID}` })[0].url, `https://open.spotify.com/track/${ID}`);
});

test('spotifyTrackId reads URIs and share links', () => {
  assert.equal(spotifyTrackId(`spotify:track:${ID}`), ID);
  assert.equal(spotifyTrackId(`https://open.spotify.com/track/${ID}?si=abc`), ID);
  assert.equal(spotifyTrackId(`https://open.spotify.com/intl-de/track/${ID}`), ID);
  assert.equal(spotifyTrackId('https://open.spotify.com/album/xyz'), '');
  assert.equal(spotifyTrackId(null), '');
});

test('decodeText handles UTF-8 and the UTF-16 Apple Music exports', () => {
  const utf16 = (s, bom = true) => { const a = bom ? [0xff, 0xfe] : []; for (const c of s) { const k = c.charCodeAt(0); a.push(k & 0xff, k >> 8); } return Uint8Array.from(a); };
  assert.equal(decodeText(utf16('Name\tArtist\nCafé\tX')), 'Name\tArtist\nCafé\tX');
  assert.equal(decodeText(utf16('Name\tArtist', false)), 'Name\tArtist');
  assert.equal(decodeText(new TextEncoder().encode('﻿Track Name')), 'Track Name');
});

test('parseDelimited copes with quotes, commas and CRLF', () => {
  assert.deepEqual(parseDelimited('a,"b, c","say ""hi"""\r\n1,2,3\r\n', ','), [['a', 'b, c', 'say "hi"'], ['1', '2', '3']]);
  assert.deepEqual(parseDelimited('"multi\nline",x', ','), [['multi\nline', 'x']]);
});

test('reads an Exportify CSV from Spotify', () => {
  const csv = [
    '"Track URI","Track Name","Artist URI(s)","Artist Name(s)","Album Name","Duration (ms)","ISRC"',
    `"spotify:track:${ID}","Night Drive - Extended Mix","spotify:artist:a","Kora Vale,Ana","Drive EP","342000","gbxyz2400001"`,
    '"spotify:track:5","Glasshouse","spotify:artist:b","Mono Atlas","Glass","301500",""',
    '"spotify:track:5","Glasshouse","spotify:artist:b","Mono Atlas","Glass","301500",""', // a duplicate
  ].join('\n');
  const p = parsePlaylist(csv, 'deep_house_sunday.csv');
  assert.equal(p.format, 'csv');
  assert.equal(p.name, 'deep house sunday');
  assert.deepEqual(p.items, [
    { title: 'Night Drive - Extended Mix', artist: 'Kora Vale,Ana', album: 'Drive EP', isrc: 'GBXYZ2400001', spotify: ID, duration: 342 },
    { title: 'Glasshouse', artist: 'Mono Atlas', album: 'Glass', duration: 302 },
  ]);
});

test('reads a TuneMyMusic CSV with its playlist name', () => {
  const p = parsePlaylist('Track name,Artist name,Album,Playlist name,Type,ISRC\nGlasshouse,Mono Atlas,Glass,Warm up,Playlist,\n');
  assert.equal(p.name, 'Warm up');
  assert.deepEqual(p.items, [{ title: 'Glasshouse', artist: 'Mono Atlas', album: 'Glass' }]);
});

test('reads an Apple Music "Export Playlist" text file', () => {
  const txt = 'Name\tArtist\tComposer\tAlbum\tGrouping\tWork\tGenre\tSize\tTime\n'
    + 'Night Drive (Extended Mix)\tKora Vale\t\tDrive EP\t\t\tHouse\t1\t342\n'
    + 'Glasshouse\tMono Atlas\t\tGlass\t\t\tHouse\t1\t301\n';
  const p = parsePlaylist(txt, 'Friday.txt');
  assert.equal(p.format, 'apple');
  assert.equal(p.name, 'Friday');
  assert.deepEqual(p.items[0], { title: 'Night Drive (Extended Mix)', artist: 'Kora Vale', album: 'Drive EP', duration: 342 });
  assert.equal(p.items.length, 2);
});

test('reads M3U playlists, with and without #EXTINF', () => {
  const m3u = '#EXTM3U\n#PLAYLIST:Peak time\n#EXTINF:342,Kora Vale - Night Drive\n/Music/a.mp3\n/Music/03 - Mono Atlas - Glasshouse.flac\n';
  const p = parsePlaylist(m3u, 'x.m3u8');
  assert.equal(p.format, 'm3u');
  assert.equal(p.name, 'Peak time');
  assert.deepEqual(p.items, [{ title: 'Night Drive', artist: 'Kora Vale', duration: 342 }, { title: 'Glasshouse', artist: 'Mono Atlas' }]);
});

test('reads pasted lists and says when it only got links', () => {
  const p = parsePlaylist('1. Kora Vale - Night Drive\nGlasshouse by Mono Atlas\nTidepool\tLumen\n\n');
  assert.equal(p.format, 'list');
  assert.deepEqual(p.items, [
    { title: 'Night Drive', artist: 'Kora Vale' }, { title: 'Glasshouse', artist: 'Mono Atlas' }, { title: 'Tidepool', artist: 'Lumen' },
  ]);
  const links = parsePlaylist(`https://open.spotify.com/track/${ID}\nhttps://open.spotify.com/track/${ID}`);
  assert.equal(links.items.length, 0);
  assert.equal(links.links, 2);
});

test('splitArtistTitle', () => {
  assert.deepEqual(splitArtistTitle('A - B - C'), { artist: 'A', title: 'B - C' });
  assert.deepEqual(splitArtistTitle('Just a title'), { artist: '', title: 'Just a title' });
});

test('titles split into the song and its version, whichever way they are written', () => {
  assert.deepEqual(titleParts('Night Drive - Extended Mix'), { core: 'night drive', mix: 'extended mix' });
  assert.deepEqual(titleParts('Night Drive (Extended Mix) [feat. Ana]'), { core: 'night drive', mix: 'extended mix' });
  assert.deepEqual(titleParts('Night Drive (Original Mix)'), { core: 'night drive', mix: '' });
  assert.deepEqual(titleParts('Glasshouse - 2011 Remaster'), { core: 'glasshouse', mix: '' });
  assert.deepEqual(titleParts('Glasshouse (feat. Ana)'), { core: 'glasshouse', mix: '' });
  assert.deepEqual(titleParts('Stay With Me'), { core: 'stay with me', mix: '' });
  assert.deepEqual(titleParts('Glasshouse feat. Ana - Dub Mix'), { core: 'glasshouse', mix: 'dub mix' });
  assert.deepEqual(titleParts('Glasshouse [with Ana]'), { core: 'glasshouse', mix: '' });
  assert.equal(norm('Café  del Mar!'), 'cafe del mar');
  assert.deepEqual(artistNames('Kora Vale, Ana & Bo feat. Cy'), ['kora vale', 'ana', 'bo', 'cy']);
});

test('matchScore: same version, another mix, or not the same song', () => {
  const lib = { title: 'Night Drive (Extended Mix)', artist: 'Kora Vale' };
  assert.equal(matchScore({ title: 'Night Drive - Extended Mix', artist: 'Kora Vale, Ana' }, lib), 2);
  assert.equal(matchScore({ title: 'Night Drive - Radio Edit', artist: 'Kora Vale' }, lib), 1);
  assert.equal(matchScore({ title: 'Night Drive', artist: 'Someone Else' }, lib), 0);
  assert.equal(matchScore({ title: 'Night Ride', artist: 'Kora Vale' }, lib), 0);
  // a file without an artist tag, named "Artist - Title"
  assert.equal(matchScore({ title: 'Night Drive', artist: 'Kora Vale' }, { title: 'Kora Vale - Night Drive', artist: '' }), 2);
  // no artist on either side still matches the title
  assert.equal(matchScore({ title: 'Glasshouse', artist: '' }, { title: 'Glasshouse', artist: 'Mono Atlas' }), 2);
  // "The" is often left off artist tags
  assert.equal(matchScore({ title: 'Firestarter', artist: 'The Prodigy' }, { title: 'Firestarter', artist: 'Prodigy' }), 2);
  // short titles need the exact version
  assert.equal(matchScore({ title: 'Go - Dub', artist: 'X' }, { title: 'Go', artist: 'X' }), 0);
});

test('matchPlaylist prefers the same version and uses each track once', () => {
  const tracks = [
    { id: 'a', libId: 'a', title: 'Night Drive (Radio Edit)', artist: 'Kora Vale' },
    { id: 'b', libId: 'b', title: 'Night Drive (Extended Mix)', artist: 'Kora Vale' },
    { id: 'c', libId: 'c', title: 'Mono Atlas - Glasshouse', artist: '' },
  ];
  const m = matchPlaylist([
    { title: 'Night Drive - Extended Mix', artist: 'Kora Vale' },
    { title: 'Glasshouse', artist: 'Mono Atlas' },
    { title: 'Tidepool', artist: 'Lumen' },
  ], tracks);
  assert.deepEqual(m.map((x) => [x.track?.id ?? null, x.exact]), [['b', true], ['c', true], [null, false]]);
  assert.equal(playlistSummary(m), '3 tracks · 2 in My library · 1 to get');
  assert.equal(playlistSummary([{ track: null }]), '1 track · 1 to get');
});

test('crates keep a clean list of tracks still to get', () => {
  let lib = M.emptyLibrary();
  const r = M.createCrate(lib, 'c1', 'Sunday', [
    { title: 'Tidepool', artist: 'Lumen', duration: '301', spotify: ID, junk: 'x' },
    { title: '', artist: 'No title' },
    null,
  ]);
  assert.deepEqual(r.crate.wanted, [{ title: 'Tidepool', artist: 'Lumen', spotify: ID, duration: 301 }]);
  lib = M.setWanted(r.lib, 'c1', []);
  assert.equal('wanted' in lib.crates[0], false); // left off when empty
  assert.equal('wanted' in M.createCrate(M.emptyLibrary(), 'c2', 'Plain').crate, false);
  // survives a load from disk, and bad data is cleaned
  const loaded = M.normalise({ crates: [{ id: 'c1', name: 'S', trackIds: [], wanted: [{ title: 'A' }, { title: 5 }, 'x'] }] });
  assert.deepEqual(loaded.crates[0].wanted, [{ title: 'A', artist: '' }, { title: '5', artist: '' }]);
  // renaming and adding keep it
  const kept = M.addToCrate(M.renameCrate(r.lib, 'c1', 'Sun'), 'c1', []);
  assert.equal(kept.crates[0].wanted.length, 1);
});

test('the music guide points to download shops and the practice tracks, never streaming', () => {
  const { stores, free, tips } = MUSIC_GUIDE;
  assert.deepEqual(stores.map((s) => s.id), ['bandcamp', 'beatport', 'traxsource', 'juno']);
  assert.ok(stores.every((s) => s.url.startsWith('https://') && s.note));
  assert.ok(free.some((f) => f.source === 'practice'), 'offers the built-in tracks');
  assert.ok(!stores.some((s) => /spotify|apple|youtube|soundcloud/i.test(s.url)), 'only shops that sell files to keep');
  assert.ok(tips.length >= 3);
});
