# Cue Coach — prototype

A DJ practice and coaching tool that runs in the browser next to rekordbox.

## Run it

```bash
npm start        # serves on http://localhost:8642 (python3 http.server)
npm test         # engine unit tests (Node 20+)
```

Use Chrome or Edge (needed for Web MIDI and linking a music folder).

## Desktop app — Mac, Windows, Linux

| Platform | Installer | rekordbox connection |
|---|---|---|
| Mac (Apple Silicon / Intel) | `.dmg` | yes — automatic |
| Windows 10/11 (x64) | `Cue Coach Setup.exe` | yes — automatic |
| Linux (x64) | `.AppImage`, `.deb` | no — rekordbox doesn't run on Linux; import a rekordbox XML export instead |

The app opens as a 420 px panel docked to the right edge of the screen and **kept on top of rekordbox** (on Mac also over a full-screen rekordbox). It starts the bundled rekordbox helper itself and connects automatically; users don't need Python. Quitting the app stops the helper.

- 📌 in the header, or ⇧⌘T / Ctrl+Shift+T, toggles "keep on top"
- View → Side Panel (⌘1 / Ctrl+1) / Practice Decks (⌘2 / Ctrl+2) — the window resizes to fit
- View → Dock to Right Edge (⇧⌘D / Ctrl+Shift+D) puts it back after you move it
- On Windows/Linux the menu bar appears when you press Alt

### Building the installers

Each platform has to be built on that platform, because the helper is compiled per OS. Easiest: push the project to GitHub and run **Build desktop apps** (`.github/workflows/build.yml`) from the Actions tab, or push a tag like `v0.1.0`. It builds Mac arm64, Mac Intel, Windows and Linux and attaches the installers to the run.

To build on your own machine:

```bash
npm install
python3 -m venv .venv && .venv/bin/pip install -r helper/requirements.txt pyinstaller==6.22.3
npm run build:helper
npm run dist:mac      # or dist:win on Windows, dist:linux on Linux
```

On Windows use `.venv\Scripts\python helper\build_helper.py` for the helper step. Installers land in `dist/`.

**Unsigned builds:** there are no signing certificates yet, so macOS says the app is from an unidentified developer (right-click → Open the first time) and Windows SmartScreen asks "Run anyway". Signing needs an Apple Developer ID (plus notarization) and a Windows code-signing certificate.

### Developing

```bash
npm run desktop       # runs from source, uses .venv's Python for the helper
CUECOACH_HELPER_ARGS='--unlocked --db /path/master.db' npm run desktop   # test database
```

## Two layouts

- **Side panel** (default in a narrow window): sits next to a nearly full-screen rekordbox. Shows *Now playing* with its phrase map and where to mix out, *Up next* with the key/tempo match, where to start it and the mix steps, then suggestions and a compact library. With rekordbox connected, "now playing" follows rekordbox and the next track you set becomes "now" once rekordbox logs it. Without the helper, press **Now** on the track you're playing.
- **Practice decks**: the two-deck trainer with waveforms, beatmatch meter and controller input.

Switch in the ☰ menu. **Open as side panel window** opens a 420 px window on the right edge of your screen; shrink rekordbox to fill the rest. `?mode=panel` / `?mode=practice` in the URL also pick a layout.

## Connect to rekordbox (helper)

A small read-only helper reads your rekordbox 6/7 library straight from its database — no XML export needed — and tells the page what rekordbox is playing.

```bash
python3 -m venv .venv
.venv/bin/pip install -r helper/requirements.txt
npm run helper
```

Then click **Connect rekordbox** in the page. The helper:

- serves your whole collection (title, artist, genre, BPM, key, cues, rating, `Energy N` comments)
- reads each track's beat grid and rekordbox **phrase analysis** (Intro / Up / Chorus / Down / Outro) when you load it, so mix points come from rekordbox instead of a guess
- streams the audio file to the page, so you don't need to link your music folder
- reports **now playing** = the newest entry in rekordbox's play history (checked every 3 s); suggestions follow it and skip what's already in the history
- only listens on 127.0.0.1, only answers this page, and never writes to the database

If it can't unlock the database, pass the key: `npm run helper -- --key <key>`.

## What it does

| Feature | How |
|---|---|
| Reads your rekordbox library | rekordbox → File → Export Collection in xml format → **Import rekordbox XML**. Gives BPM, key, beat grid, hot/memory cues, rating. |
| Audio | **Link music folder** (files are found by name) or drop a file on a deck. Files that aren't in the library get an estimated BPM (bar "1" not detected). |
| Beatmatching view | Two decks with scrolling waveforms, beat/bar/phrase grid, a phase meter and tips like "B is 0.6 BPM slow" or "B is 30 ms behind — nudge forward". |
| Where to mix | Per-bar bass energy → intro, first drop, breakdowns, outro. Proposes mix-in points (first downbeat, phrase starts, drop, your cues) and a mix-out bar, plus a step-by-step blend with a live countdown. |
| Next track | Ranks the library by Camelot key, tempo (incl. half/double time), genre, energy (`Energy N` in comments, e.g. from Mixed In Key) and rating. Lift/hold/calm energy. |
| AI coach | Optional. Your Anthropic API key (stays in this browser) → Claude Opus 5.5 picks 3 of the ranked candidates and gives transition tips for your level. |
| Controller | MIDI learn for play, tempo, jog, low EQ, volume and crossfader. macOS lets this app read the controller while rekordbox is using it too. |

## Files

- `js/library.js` — rekordbox XML parser, Camelot keys, demo library
- `js/engine.js` — scoring, phrase/structure detection, mix points, transition plan
- `js/audio.js` — decks (Web Audio), analysis, BPM estimate, beatmatch maths, demo synth
- `js/ai.js` — Claude call (Anthropic TypeScript SDK via CDN, structured JSON output)
- `js/midi.js` — Web MIDI listening and learn
- `desktop/main.cjs`, `desktop/preload.cjs` — Electron shell (window, keep-on-top, starts the helper)
- `helper/build_helper.py` — packs the helper into a standalone program (PyInstaller)
- `.github/workflows/build.yml` — builds all installers on GitHub Actions
- `helper/` — rekordbox helper and its tests
- `test/engine.test.mjs` — unit tests

## Known limits / next steps

- **Now playing may lag behind the decks.** It isn't documented when rekordbox writes a track to its history (on load, after it has played for a while, or later), so "now playing" can trail what you hear. The helper was tested against a fake database built from pyrekordbox's table definitions, not a real rekordbox install, so check the timing with your setup.
- Phrase analysis needs rekordbox's phrase analysis turned on (Preferences → Analysis), and only covers tracks analysed with it.
- Tempo changes the pitch here (no key lock yet).
- Waveforms are single-colour; rekordbox-style 3-band colour would make the bass swap easier to see.
