# Cue Coach: competitive review and build-vs-base decision (November 2026)

**Written:** 2026-11-21 · **Branch reviewed:** `learn-app` (commit `a84b6d2` plus the uncommitted mix-timing work in `js/mixplan.js`)
**Follows:** [competitive-benchmark-2026-11.md](competitive-benchmark-2026-11.md) (2026-11-18). That document compared us with coaching apps while we were still a rekordbox side panel. This one compares the **Learn app** (our own decks, mixer and library) with the full DJ applications, and answers whether to keep our own engine.

---

## Bottom line

1. **Keep building on our own engine.** No competitor offers a route that keeps what makes Cue Coach different: coaching that reads the exact deck state every frame, a UI that changes with the user's level, and an AI that can see the whole library. The commercial apps (rekordbox, Serato, Traktor, Engine DJ, djay) have no SDK that would let us do that. VirtualDJ's plugin SDK is real, but it gives us a plugin inside someone else's UI. Mixxx would give us a mature engine, but it is GPL C++/Qt: we would have to rewrite the app in C++/Qt and release all of Cue Coach under the GPL.
2. **Our engine has gaps beginners will notice next to free tools**, and they come before more lessons. In order: **key lock**, a **real headphone cue** on 4-output controllers, **recording plus a per-transition score**, **progress that is saved**, and **more controllers**. Every competitor ships the first three, at least in its paid tier.
3. **Fix one licensing risk now.** `js/controllers.js` is generated from Mixxx's GPL-2.0-or-later mapping files. Rebuild it from manufacturers' MIDI message lists and our own captures, or get legal advice, before we ship a paid or closed-source build (section 6).
4. **Our position is strong and nobody is taking it.** Every major app has added AI over the last year (stems, AI playlists, AI cue points, AI lyrics), but none of them coaches. Their help still pushes beginners towards sync and automix. Our lead is a curriculum built into the decks, help that fades as you level up, and no sync button.

---

## 1. What Cue Coach does today (from the code)

| Area | What's there | Where |
|---|---|---|
| Decks | 2 decks on Web Audio (`AudioBufferSourceNode`): play, cue, jog wheel (scratch/nudge), tempo ±8 % (±16 % at Pro), hot cues, loops, beat jump, banded waveforms, beat/bar/phrase counter | `js/audio.js`, `js/learn.js`, `js/deckmath.js` |
| Beat grids | Our own kick-based tempo and grid fit across the whole track; rekordbox grids and phrases when the helper is connected; grid fine-tuning | `js/beatgrid.js`, helper |
| Mixer | Crossfader, channel volume, 1–3 band EQ (depending on level), filter, "Listen" (a quiet copy of the deck standing in for headphones) | `js/learn.js` |
| Effects | One unit per deck: echo, reverb, trans, HPF/LPF sweep, roll. Pad FX in 2 banks of 8, Beat FX, an 8-pad sampler with sounds synthesised in code | `js/fx.js`, `js/sampler.js` |
| Learning | 12 lessons in 2 tiers (Beginner, Novice) with live checks on the mix state; 4 levels (Starter → Pro) that switch coaching off and tools on; beatmatch-by-ear mode at Confident; plain-word offset hints; mix-timing guide (countdown, part tips) | `js/lessons.js`, `js/levels.js`, `js/lesson.js`, `js/mixplan.js` |
| Library | Music folder (ID3/FLAC tags, cached analysis in IndexedDB), rekordbox 6/7 database through the read-only helper, practice tracks; key/BPM/energy match labels; suggestions | `js/musiclib.js`, `js/tags.js`, `helper/` |
| Set building | Offline energy-curve set builder (4 vibes); Claude set builder and suggestions (key held in the main process) | `js/setbuilder.js`, `js/coachai.js` |
| Controllers | Full Learn-app support for **DDJ-FLX4** (decks, mixer, loops, pads, FX, sampler, lights). Basic maps for DDJ-400/200/SB3, Inpulse 200/300/500 and Mixtrack 3 (from Mixxx) | `js/learnmidi.js`, `js/controllers.js` |
| Platforms | Electron on macOS (arm64/x64), Windows 10/11, Linux (AppImage/deb). Unsigned | `package.json`, `.github/workflows/build.yml` |
| **Missing** | Key lock (tempo changes pitch), a true headphone cue output (the 4-channel spike is parked), recording, quantise, playlists/crates, streaming, stems, sync (left out on purpose), automix, saved progress history, transition scoring, signed installers | — |

---

## 2. Feature comparison

✅ yes · 🟡 partial or paid tier only · ❌ no · — not applicable. Versions are the latest we found on 2026-11-21. See section 8 for sources.

### 2.1 Versions, price and platforms

| | Latest version found | Price | Platforms | Plays without hardware? |
|---|---|---|---|---|
| **Cue Coach** | 0.1.0 (prototype) | Not set | Mac, Windows, Linux | ✅ designed for mouse and keyboard |
| **rekordbox** | 7.2.19 (7.2.18 dated 2026-08-18) | Free plan; Core ~$10/mo, Creative ~$15/mo, Professional $30/mo ($360/yr). An eligible AlphaTheta controller unlocks Performance mode | Mac, Windows (+ iOS/Android companion apps) | 🟡 Free plan has Performance mode, but not every feature |
| **Serato DJ** | Pro 4.0.8 | Lite free; Pro $11.99/mo or $299; Suite $14.99/mo or $499. Many controllers unlock Lite or Pro | Mac, Windows | 🟡 Pro "Practice Mode": 2 decks, no recording |
| **VirtualDJ** | 2026 (parts 1–3) | Free for home use with no controller; Home ~$4/mo for entry-level controllers; Pro ~$19/mo or $299; Business/Infinity above that | Mac, Windows | ✅ |
| **Traktor Pro** | 4.5.0 (2026-04-22) | $149 one-off, no subscription | Mac, Windows | ✅ |
| **djay** | Pro 5.x | Free tier; PRO $6.99/mo or $49.99/yr, one subscription across devices | Mac, Windows, iOS, Android | ✅ |
| **Engine DJ** | 5.0 (2026-05-13), 5.3 reported | Free with Denon/RANE/Numark hardware | Desktop (Mac, Windows) is **library prep only**; you play on Engine OS hardware | ❌ |
| **Mixxx** | 2.5.6 stable (2026-03-27); 2.6 in beta since 2025-05; `main` is 2.7-alpha | Free, GPL-2.0-or-later | Mac, Windows, Linux | ✅ |

### 2.2 Learning and coaching

| | Cue Coach | rekordbox | Serato | VirtualDJ | Traktor | djay | Engine | Mixxx |
|---|---|---|---|---|---|---|---|---|
| Lessons inside the app | ✅ 12 lessons with live checks | ❌ (videos on the website) | ❌ (DJ Lite tutorial hub on the website) | ❌ | ❌ | 🟡 djay School: video lessons, full course needs PRO | ❌ | ❌ (manual) |
| Checks what you actually did | ✅ every frame | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| UI that grows with your level | ✅ 4 levels | ❌ | 🟡 Lite → Pro is a paywall, not a learning path | ❌ (skins) | ❌ | ❌ | ❌ | ❌ (skins) |
| Beatmatch-by-ear training | ✅ beat lane hidden at Confident | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Mix timing ("start B now") | ✅ countdown and part tips | 🟡 Mix Point Link, phrase analysis | ❌ | 🟡 automix points | ❌ | 🟡 Automix AI | ❌ | ❌ |
| Transition score and progress history | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| AI that talks to you about your set | ✅ Claude set builder and suggestions | 🟡 Track Suggestion (not generative) | ❌ | ✅ AI Assistant / AIPrompt (Pro) | ❌ | 🟡 Automix AI | ❌ | ❌ |

The dedicated coaching apps (Coach DJ Pro, Crossfader, Tribe DJ, Beatmatch PRO, onset) are covered in the 2026-11-18 benchmark. None of them plays the music itself with coaching built into the decks. Coach DJ Pro scores recorded mixes afterwards, Crossfader runs video lessons over your DJ software, and Tribe DJ is VR.

### 2.3 Beatmatching aids

| | Cue Coach | rekordbox | Serato | VirtualDJ | Traktor | djay | Engine | Mixxx |
|---|---|---|---|---|---|---|---|---|
| Sync button | ❌ **on purpose** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Phase meter / beat lane | ✅ beat lane with dots and plain-word offset | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Tells you which way to nudge, in words | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Key lock | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Quantise | ❌ | ✅ | ✅ (Pro) | ✅ | ✅ | ✅ | ✅ | ✅ |
| Beat-grid accuracy for tracks with tempo changes | 🟡 one fixed tempo per track | ✅ dynamic grids | ✅ | ✅ 2026 "fluid beatgrid" (AI, needs a GPU) | ✅ flexible grids (Traktor 4) | ✅ (djay Pro 5 beatgridding) | ✅ | ✅ |
| Colour waveforms by band | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ RGB since 5.0 | ✅ |

### 2.4 Library management

| | Cue Coach | rekordbox | Serato | VirtualDJ | Traktor | djay | Engine | Mixxx |
|---|---|---|---|---|---|---|---|---|
| Local files and tags | ✅ (ID3, FLAC) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Playlists / crates you can edit | ❌ | ✅ | ✅ (new library in 4.0) | ✅ | ✅ | ✅ | ✅ | ✅ |
| Read another app's library | ✅ rekordbox 6/7 database | — | 🟡 | ✅ | 🟡 | 🟡 | ✅ rekordbox/Serato/Traktor import | ✅ rekordbox, Serato, Traktor |
| Key and energy | ✅ Camelot; energy from tags | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ (key) |
| Phrase / structure analysis | ✅ ours plus rekordbox's | ✅ | ❌ | 🟡 | ❌ | 🟡 | ❌ | ❌ |
| Streaming (Beatport, Beatsource, SoundCloud, TIDAL…) | ❌ | ✅ (+ Spotify on supported hardware since 7.2.18) | ✅ | ✅ | ✅ Beatport/Beatsource FLAC | ✅ | ✅ | 🟡 |
| USB export for club players | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ |

### 2.5 Controllers

| | Cue Coach | rekordbox | Serato | VirtualDJ | Traktor | djay | Engine | Mixxx |
|---|---|---|---|---|---|---|---|---|
| Supported controllers | 1 full (FLX4) + 7 basic | AlphaTheta/Pioneer range plus some others | 100+ | Very large; most need Home or Pro | NI plus a growing list (3 Numark entry models added in 4.5) | 100+ (Windows store listing) | Engine hardware only | ~160 mappings in the repo |
| Users can map controllers (MIDI learn) | 🟡 learn in the old side panel, not in the Learn app | ✅ | ✅ (Pro) | ✅ | ✅ | ✅ | — | ✅ (XML + JS) |
| Uses the controller's own sound card for a headphone cue | ❌ (spike parked) | ✅ | ✅ | ✅ | ✅ | ✅ | — | ✅ |

### 2.6 Effects

| | Cue Coach | rekordbox | Serato | VirtualDJ | Traktor | djay | Engine | Mixxx |
|---|---|---|---|---|---|---|---|---|
| Beat-synced FX | ✅ 6 types | ✅ many (Beat FX, Pad FX, Sound Color FX) | ✅ (iZotope) | ✅ many, and plugins | ✅ ~40 | ✅ | ✅ | ✅ (+ LV2 on Linux) |
| Filter per channel | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Sampler | ✅ 8 built-in sounds | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Stems | ❌ | ✅ | ✅ | ✅ (Stems 2.0) | ✅ (iZotope RX, 4 stems) | ✅ (Neural Mix 2.0) | ✅ | 🟡 in 2.6 beta |
| Recording | ❌ | ✅ | 🟡 not in Practice Mode | ✅ | ✅ | ✅ | ✅ | ✅ |

**What this shows:** we win on teaching, and that column is ours alone. On engine basics (key lock, quantise, recording, headphone cue, playlists) we're behind **free** tools: Mixxx, Serato Practice Mode, rekordbox Free and VirtualDJ's free home use. A beginner can switch to any of these at no cost, so the basics are the gap to close first.

---

## 3. Gaps to close first

Ranked by how soon a beginner trying the app would hit them, and by how much each one supports the coaching promise.

| # | Gap | Why first | Effort | Notes |
|---|---|---|---|---|
| 1 | **Key lock** | Every competitor has it. Without it, matching tempo bends the pitch, which sounds wrong and teaches bad habits for key mixing. | M | `signalsmith-stretch` (MIT) is already a dependency and runs in the parked spike. Move the decks from `AudioBufferSourceNode.playbackRate` to an AudioWorklet stretch node. Keep key lock off at Starter ("like a record"), as an option from Improver. |
| 2 | **Real headphone cue on 4-output controllers** | "Listen" is a stand-in. Beatmatching by ear needs a separate headphone signal. The FLX4 already works for everything else. | M | Bring back the 4-channel spike (`deckmath.outputPlan`). Test Electron/Chromium multichannel output on macOS (Core Audio) and Windows (WASAPI; Chromium has no ASIO). |
| 3 | **Record the mix and score each transition** | Nobody scores a transition live. We already have every input: phase error over time, bass overlap from the EQ, level match, whether play landed on the phrase, key clash. A recording gives the user something to listen back to. | M | `MediaRecorder` on the master bus. Score shown under the lesson card with **one** thing to fix. This was P0 #2 in the benchmark. |
| 4 | **Saved progress** | Levels currently go up from a count of clean mixes. Users need to see their history, and we need it to move people up and down levels. | S | Sessions, scores and level per skill in IndexedDB. A "Your progress" card. |
| 5 | **Controllers beyond the FLX4** | DDJ-FLX2, DDJ-400 and Inpulse 200/300 are the beginner best-sellers. Today only the FLX4 has full Learn-app support. | S–M each | Build from manufacturer MIDI lists (see section 6). Add MIDI learn to the Learn app as a fallback. |
| 6 | **Playlists** | Even beginners want "tonight's tracks". The set builder already produces ordered lists, but nothing saves them. | S | Save set-builder output as a playlist; manual playlists second. |
| 7 | **Quantise for cues and loops** | Mouse users can't hit a beat exactly, and it's free in every other app. | S | Snap to the grid. Off at Starter, so users still learn timing. |
| 8 | **Signed installers** | Same as the benchmark: "unidentified developer" warnings put beginners off. | S (plus cost) | Apple Developer ID and a Windows code-signing certificate. |

**Deliberately not now:** stems (a heavy model, needs a GPU or a long analysis, and it's a Phase 2 skill), streaming (licensing deals), USB export, DVS, video, lighting, 4 decks. None of these teaches a beginner to mix, and they make the screen busier.

---

## 4. Build vs base: the options

### Option A: keep our own engine (Electron + Web Audio + JS) ✅ **recommended**

**Gain / keep**
- Coaching reads the real engine state every frame (`lessons.js` checks `s.offsetMs`, `alignedFor`, `eqLow` and so on). No other route gives exact, low-latency state without guessing.
- One table (`levels.js`) controls what's on screen. Rebuilding that level-by-level UI on a skin system (Mixxx, VirtualDJ) would be far harder.
- Licence freedom: closed source, a paid tier, or open-core later. Our choice.
- AI access to the library and the decks, already built.
- Speed: ~6.6 k lines of JS with unit tests, and one language across UI, engine and tests.

**Lose / risk**
- We have to build the engine basics ourselves (section 3). They're well understood, and the hardest one (time-stretch) is already solved by an MIT library.
- Audio latency and robustness in Chromium: there's no ASIO on Windows, so we rely on WASAPI. Measure on mid-range Windows laptops before promising a "pro" experience.
- Analysis quality (tempo changes, odd meters) is weaker than tools with a decade of tuning. Mitigated by importing rekordbox grids when they're available.

### Option B: fork or embed Mixxx ❌

**What Mixxx offers:** a mature engine (Rubber Band and SoundTouch time-stretch, key lock, quantise, sync, 4 decks plus samplers), ~160 controller mappings with JS scripting, rekordbox/Serato/Traktor library import, recording and broadcasting, stems in 2.6, Mac/Windows/Linux, and an active project (7.4 k GitHub stars, commits daily as of 2026-11-20).

**The cost:**
- **Licence.** Mixxx is GPL-2.0-or-later. If we distribute a modified Mixxx, or a program that links Mixxx code, the whole program must be released under the GPL with source. Selling it is allowed, but anyone can then rebuild and give away our coaching, levels and AI integration. Closed-source or app-store-only distribution is effectively ruled out. (Apple's App Store terms and the GPL are a known conflict, which matters if we ever want iPad.)
- **Stack rewrite.** Mixxx is C++/Qt (QML and legacy widget skins). Our UI, lessons and levels are HTML/JS. "Base on Mixxx" means rewriting the product in C++/Qt, or running Mixxx headless and talking to it over a bridge it doesn't officially have.
- **No coaching hook.** Mixxx has no plugin API for this. The nearest hook is the controller-scripting engine (JS that can read and write control values). Driving a coach from it would mean posing as a fake MIDI device, which is fragile and still inside Mixxx's UI.
- **Upstream pace.** 2.6 has been in beta since May 2025 and still isn't on GitHub Releases as of 2026-11-21. A fork would also have to keep merging upstream.

**Where Mixxx does help us (without copying code):** as a reference for behaviour (how its jog, scratch and quantise feel), and as a source of facts about controllers. Read its manual and behaviour, not its source, when designing our own versions.

**Alternative under this option:** contribute a "learning mode" upstream to Mixxx as a separate open-source effort. Good for reach, but it doesn't build our product.

### Option C: plugin or SDK inside a commercial app

| App | Public extension route | Could it host Cue Coach? |
|---|---|---|
| **VirtualDJ** | ✅ C++ **Plugin SDK v8** (DSP, video and "general" plugins; SDK package dated 2021) plus **VDJScript** for controller mappings and commands | Partly. A general plugin can read deck state and send commands, so a "VirtualDJ coach" overlay is possible. But we wouldn't own the UI or the levels, it's Windows/Mac C++, and much of what users need sits behind VirtualDJ's paid tiers. **Worth considering later as a distribution channel ("Club mode for VirtualDJ users"), not as the base.** |
| **rekordbox** | ❌ No SDK. Read-only routes: the encrypted database (we already use it via the pyrekordbox-based helper), XML export, Pro DJ Link on the network for CDJs | No. Stays our "Club mode" connection. |
| **Serato DJ** | ❌ No public SDK (hardware partners only); library files on disk | No. Read the library at most. |
| **Traktor** | ❌ No SDK; MIDI out and controller mapping only | No. |
| **djay** | ❌ No public SDK (hardware and streaming partners only) | No. |
| **Engine DJ** | ❌ No SDK. StageLinQ network protocol (reverse-engineered by the community) shows now-playing and deck state from hardware | No base. StageLinQ could feed a future "Club mode" for Denon users. |

### Option D: license a commercial audio engine

- **Superpowered** (C++/WASM audio SDK with DJ-oriented players, FX and time-stretch): pricing is "contact sales". It would replace our Web Audio deck internals while keeping our JS app. That's a fallback if Web Audio's latency or CPU use proves unacceptable on Windows.
- **zplane élastique** (the industry time-stretch, used by several DJ apps) and **Rubber Band** (GPL or a commercial licence): an upgrade path for key-lock quality if signalsmith-stretch isn't good enough.

These replace engine parts, not the product, so they fit **inside** Option A.

### Decision

| | A: own engine | B: Mixxx | C: VirtualDJ plugin | D: licensed engine parts |
|---|---|---|---|---|
| Keeps live coaching and the level UI | ✅ | 🟡 after a rewrite | 🟡 overlay only | ✅ |
| Licence freedom | ✅ | ❌ GPL | 🟡 tied to VDJ | ✅ (paid) |
| Time to close engine gaps | 🟡 weeks per gap | ✅ already there | ✅ already there | 🟡 integration work |
| Keeps our stack and tests | ✅ | ❌ | ❌ | ✅ (WASM) |
| Reach | Our installers | Mixxx users | VDJ users | Our installers |

**Recommendation:** Option A. Close gaps 1–4 in section 3 next. Keep Option D (Superpowered or élastique) as the escape hatch if a Windows latency test fails. Revisit Option C (a VirtualDJ coach plugin) once the Learn app is out, as a second channel next to rekordbox Club mode.

---

## 5. Validation before committing more engine work

1. **Windows latency test:** run an Electron build on a mid-range Windows 11 laptop with an FLX4. Measure jog-to-sound and play-to-sound latency and check for dropouts with key lock on both decks. If it's over ~20 ms or glitchy, look at Superpowered.
2. **Key-lock quality:** blind A/B of signalsmith-stretch at ±8 % on house, hip-hop and vocal tracks against rekordbox's key lock.
3. **Multichannel output:** confirm that Chromium opens 4 outputs on the FLX4 on macOS and Windows without extra drivers.

---

## 6. Licensing risk: the controller maps

`scripts/import-mixxx.mjs` downloads Mixxx's `*.midi.xml` mapping files and writes the MIDI numbers into `js/controllers.js`, with a GPL-2.0-or-later attribution header. Those files are part of a GPL project (individual files can carry other licences; Debian's copyright file lists some mappings as MIT/Expat).

- **The argument for:** a list of which MIDI message each control sends is a fact about the hardware, and facts generally aren't protected by copyright. We copy no script code.
- **The argument against:** our file is machine-generated from GPL files and says so. In a dispute, that's not where we want to start, especially for a paid closed-source app.
- **Fix (S):** rebuild the controller tables from the **manufacturers' own MIDI message lists** (Pioneer publishes these for most DDJ models; check the FLX4/FLX2 pages) and from our own captures with the hardware. Keep a provenance note per controller. Until then, either keep the build open source or get a lawyer to confirm the "facts only" view. The FLX4 extras in `js/learnmidi.js` (lights, meters) need the same provenance check.

---

## 7. Caveats

- Prices are US list prices found on 2026-11-21 and change often. rekordbox's Core and Creative prices come from a localised copy of its plan page, and VirtualDJ's from VirtualDJ's forum and third-party guides. Check the vendors' pages before quoting them externally.
- "Latest version" is the newest release we could find. VirtualDJ ships 2026 features in parts, and some articles describe features as coming rather than released.
- No hands-on testing of competitor apps. Some ✅ cells (for example, analysis quality) are vendor claims.
- Legal points in sections 4 and 6 are not legal advice. GPL questions about linking and distribution should go to a lawyer before release.
- Coaching-app details (Coach DJ Pro, Crossfader, onset, Tribe DJ) were not checked again; see the 2026-11-18 benchmark. A search for Coach DJ Pro on 2026-11-21 returned nothing new.

---

## 8. Sources (accessed 2026-11-21 unless noted)

**rekordbox**
- [Release notes](https://rekordbox.com/en/support/releasenote/) (7.2.19, 7.2.18 dated 2026-08-18) · [7.2.16 release, 2026-07](https://rekordbox.com/en/2026/07/rekordbox-v7216-release-information/) · [7.2.14, 2026-04 (SMART CUE)](https://rekordbox.com/en/2026/04/rekordbox-v7214-release-information/)
- [Plans & pricing](https://rekordbox.com/en/plan/) · [Plans FAQ (rekordbox 7)](https://rekordbox.com/en/support/faq/plans-7) · [Free plan guide (2020)](https://rekordbox.com/en/2020/05/subscription-plans-guide-free/)

**Serato**
- [DJ Pro pricing](https://serato.com/dj/pro/pricing) · [DJ Pro 4.0.8 download](https://serato.com/dj/pro/downloads/4.0.8) · [DJ Pro 4.0 library overhaul (MusicRadar)](https://www.musicradar.com/music-tech/this-next-track-is-a-four-watermelon-banger-serato-dj-4-0-overhauls-the-dj-softwares-library-with-new-search-tools-easier-analysis-and-an-emoji-rating-system) · [Practice mode / laptop DJing](https://serato.com/dj/pro?currency=usd) · [System requirements](https://support.serato.com/hc/en-us/articles/227883108-System-requirements)

**VirtualDJ**
- [Price page](https://virtualdj.com/products/virtualdj/price.html) · [VirtualDJ HOME (free home use)](https://virtualdj.com/products/virtualdj/home.html) · [Buy](https://virtualdj.com/buy/) · [Licence forum thread, 2025-12](https://virtualdj.com/forums/266569/VirtualDJ_Technical_Support/Licenses.html) · [Pricing question (forum)](https://virtualdj.com/forums/260590/VirtualDJ_Technical_Support/Pricing_question.html)
- [VirtualDJ 2026 (Digital DJ Tips)](https://www.digitaldjtips.com/virtualdj-2026/) · [2026 part 2 (DJ Life)](https://djlifemag.com/2026/02/virtualdj-2026-part-2-expands-ai-driven-dj-tools/) · [Fluid beatgridding](https://www.digitaldjtips.com/virtualdj-2026-brings-fluid-beatgridding-ai-video-visuals/) · [ShoutOut](https://www.digitaldjtips.com/virtualdj-2026-adds-ai-shout-outs-no-mic-needed/)
- [Developers](https://virtualdj.com/wiki/Developers.html) · [Plugin SDK 8](https://virtualdj.com/wiki/PluginSDK8.html) · [Controller definition](https://virtualdj.com/wiki/ControllerDefinition.html) · [SDK request thread, 2025](https://virtualdj.com/forums/265480/VirtualDJ_Plugins/Request_for_Full_Version_of_VirtualDJ_8_SDK.html)

**Traktor**
- [Official update status (4.5.0, 2026-04-22)](https://community.native-instruments.com/discussion/43/) · [What's new in 4.5](https://support.native-instruments.com/hc/en-us/articles/360017233958) · [Traktor Pro 4 review, $149](https://www.digitaldjtips.com/reviews/traktor-pro-4-review/)

**djay**
- [djay Pro 5 review ($7/mo, $50/yr)](https://www.digitaldjtips.com/reviews/algoriddim-djay-pro-5/) · [Free vs Pro](https://help.algoriddim.com/topic/first-steps/free-vs-pro) · [djay School tutorials](https://help.algoriddim.com/user-manual/djay-ios/tips/tutorials) · [Neural Mix and AudioShake (MusicTech)](https://www.musictech.com/news/gear/algoriddim-free-update-djay-pro-improved-stem-separation-audioshake/) · [Hardware](https://help.algoriddim.com/user-manual/djay-pro-mac/hardware) · [Microsoft Store listing](https://apps.microsoft.com/detail/9p9rb7zf49xk)

**Engine DJ**
- [Introducing Engine DJ 5.0](https://enginedj.com/news/articles/introducing-engine-dj-5-0) · [5.0 release notes](https://support.numark.com/en/support/solutions/articles/69000878658-engine-dj-5-0-release-notes) · [Engine DJ 5.3 (Crossfader)](https://wearecrossfader.co.uk/blog/engine-dj-5-3/) · [Downloads](https://enginedj.com/downloads) · ["Make Engine Desktop playable" thread](https://community.enginedj.com/t/we-need-to-make-engine-desktop-playable-like-traktor/61994)

**Mixxx**
- [GitHub repository](https://github.com/mixxxdj/mixxx) (releases API: 2.5.6 on 2026-03-27 is the latest; `LICENSE` header reads "Mixxx 2.7-alpha", GPL v2 or later; 164 `.midi.xml` mappings in `res/controllers`) · [2.5.6 release](https://mixxx.org/news/2026-03-27-mixxx-2_5_6-released/) · [2.6 beta, 2025-05-11](https://mixxx.org/news/2025-05-11-mixxx-2_6_beta-released/) · [STEM mixing GSoC 2024](https://mixxx.org/news/2024-08-26-STEM-Mixing) · [DDJ-FLX4 mapping manual](https://manual.mixxx.org/2.6/fi/hardware/controllers/pioneer_ddj_flx4) · [Debian copyright for Mixxx mappings](https://sources.debian.org/copyright/license/mixxx/2.3.3~dfsg-2)

**Engines and MIDI lists**
- [Superpowered pricing](https://superpowered.com/pricing) · [Superpowered licensing](https://docs.superpowered.com/getting-started/licensing/) · [zplane licensing](https://licensing.zplane.de/licensing)
- Pioneer MIDI message lists, for example [DDJ-SB3](https://www.pioneerdj.com/-/media/pioneerdj/software-info/controller/ddj-sb3/ddj-sb3_midi_message_list_e2.pdf) and [XDJ-AZ](https://www.pioneerdj.com/-/media/pioneerdj/software-info/system/xdj-az/xdj-az_midi_message_list_e1.pdf). No FLX4 list found in search; check the product's support page.

**Pricing round-ups (third party; use with care)**
- [DJ.Studio 2026 subscriptions guide](https://dj.studio/blog/dj-software-subscriptions-buyers-guide) · [DJ.Studio price guide 2026](https://dj.studio/blog/professional-dj-software-price-guide) · [Digital DJ Tips: DJ software 2026](https://www.digitaldjtips.com/?p=2795710)
