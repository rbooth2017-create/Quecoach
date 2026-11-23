# Build prompts: set list, song structure guide, app tour (November 2026)

Four prompts, one per session. Each one stands on its own: paste it into a fresh Claude Code session in this folder.

**Run them one at a time, in this order.** All four edit `js/learn.js` and `learn.html`, so running two at once would mean conflicting edits. Commit after each one before starting the next.

1. Set list panel (side panel tab, + button, thumbs, Generate / Refine)
2. Set energy chart (energy estimate for every track, plus the build/drop/calm chart)
3. Song structure guide
4. App tour (last, so it points at the finished screen)

The same house rules are repeated in every prompt, so each session gets them.

---

## Prompt 1: Set list panel

```text
Cue Coach (this folder, branch learn-app) is an Electron DJ app for beginners: learn.html + js/learn.js, with DOM-free logic modules in js/ that are unit-tested with `npm test` (node --test test/*.test.mjs).

Build a set list panel in the side panel.

What's there today:
- The side panel (`<aside id="tutor">` in learn.html, renderTutor() in js/learn.js, toggled by #lessonsBtn / the L key, state.paneOpen) shows lessons only.
- A set builder already exists but is hidden in the library's "Set" tab: renderSet(), buildSet(), saveSet(), setItems(), nextSetItem(), loadNextFromSet() in js/learn.js; quickSet(), VIBES, targetEnergy() and setMinutes() in js/setbuilder.js; buildSetAI() in js/coachai.js (Claude, structured JSON output). state.set = { title, story, ai, items: [{ id, why, tip }], played: [] }, saved with store.set('set').
- Library rows have A / B load buttons (see renderList() around the `data-load` buttons).

Build:
1. Side panel tabs: "Lessons | Set". Remember the last tab. Starter and Improver open on Lessons by default, Confident and Pro on Set (js/levels.js decides features per level; add an entry there rather than checking level names in the UI). Move the set builder out of the library's Set tab into the panel and remove that library tab.
2. A + button on every library row (next to A / B) adds the track to the end of the set. If there's no set yet, it starts one ("My set"). Already in the set → the button shows a tick, and pressing it again removes the track. Drag rows in the set to reorder; a small × removes a row.
3. Thumbs up / thumbs down on each set row. The meaning: a verdict on the track for this set. 👍 = keep it, 👎 = swap it out. Store the verdict on the item ({ id, why, tip, vote: 1 | -1 | 0 }). 👎 dims the row but leaves it in place until Refine.
4. Two buttons at the top of the set:
   - Generate: builds a new set from the vibe, length and the "describe the night" text (the existing Build with AI; keep Quick build as the no-AI fallback when no API key is connected).
   - Refine: keeps every 👍 track in its place, replaces every 👎 track, and follows an optional instruction typed in a small box ("more vocals in the middle", "end slower"). Unvoted tracks may move or change. Add refineSetAI({ library, set, instruction, vibe, minutes, level }) in js/coachai.js beside buildSetAI, with the same structured-output pattern and the same rule that it may only pick track ids from the library. Without an API key, Refine falls back to a non-AI version: swap each 👎 track for the best quickSet-style match for its slot (add that as a pure function in js/setbuilder.js).
5. Keep "Load next", "played" marking and the per-mix tip from the current Set tab.

House rules:
- Beginner-first: clean, friendly, plain words, works with mouse and keyboard alone. Match the existing look (CSS variables in learn.html, the icon() helper in js/icons.js). Check light and dark themes.
- Logic goes in DOM-free modules with unit tests: add/remove/reorder/vote and the non-AI refine in js/setbuilder.js, with tests in a new test/setlist.test.mjs. Never add a sync button.
- Don't break the lessons: run `npm test` and make sure every test passes.
- Check it in the browser: start the "web" config from .claude/launch.json with the preview tools, open /learn.html, and try + / ✓, drag to reorder, 👍 / 👎, Quick build and Refine without a key. Look for console errors. If the browser shows old code, the module is cached: fetch the changed files with cache: 'reload' and reload.
- Don't commit. End with what you built, what you checked, and anything you couldn't check (for example the AI paths if there's no API key).
```

---

## Prompt 2: Set energy chart

```text
Cue Coach (this folder, branch learn-app) is an Electron DJ app for beginners: learn.html + js/learn.js, with DOM-free logic modules in js/ unit-tested with `npm test`.

Add a visual cue for how a set builds, drops and calms down: an energy chart at the top of the set list in the side panel's Set tab (the panel built in the previous step: renderSet / state.set in js/learn.js, VIBES and targetEnergy() in js/setbuilder.js).

The data problem first: track.energy (1–10) only exists when the user's tags or rekordbox comments carry it ("Energy 7", e.g. from Mixed In Key). Most tracks have none.
1. Estimate energy for every analysed track. js/beatgrid.js already has barEnergies(samples, sampleRate, grid) (per-bar low-end energy) and bandPeaks(). Write a pure estimateEnergy({ barEnergies, bands, bpm }) → 1..10 in js/beatgrid.js (or a new js/energy.js) using loudness across the track's main (non-intro, non-outro) bars, high-frequency density and tempo. Keep it simple and explainable. Store it next to the cached analysis (see how js/musiclib.js persists analysis and GRID_VERSION) as energyEst, and use track.energy ?? track.energyEst everywhere energy is read (setbuilder, scoring, slimTrack for the AI). Tracks that haven't been analysed yet have no value: analyse set tracks in the background when a set is built, the same way the library analyses tracks today.
2. Calibrate against the tracks that do have a tagged energy: add a test with a few synthetic buffers (quiet/sparse vs loud/dense) checking the order is right, and keep the estimate within 1–10.

The chart:
3. A compact SVG (about 80 px tall, full panel width): x = time through the set (each track's width ∝ its played minutes, setMinutes() / PLAYED_SHARE), y = energy 1–10.
   - The vibe's target curve as a soft line (targetEnergy(vibe, t)).
   - One dot or bar per track at its energy, in set order, joined by a line, so the set's shape is visible.
   - Plain-word labels where the shape changes: "Build", "Peak", "Drop", "Breather", "Cool-down". Work out the labels with a pure function from the energy sequence (rises over 2+ tracks = Build, the highest stretch = Peak, a fall of ≥2 = Drop or Breather, the final fall = Cool-down), with tests.
   - A track more than 2 points off the target curve gets a small warning mark and a tooltip ("Big jump down here: try a track around energy 6"). Played tracks are dimmed; the next track is highlighted; hovering a dot highlights its row and the other way round.
   - Unknown energy: a hollow dot at the line, labelled "not analysed yet".
4. The chart updates live when tracks are added, removed, reordered, voted or refined.

House rules:
- Beginner-first: clean, friendly, plain words; mouse and keyboard only. Match the existing look (CSS variables in learn.html, both themes) and use the colour tokens, not new hard-coded colours. Keep it readable at the panel's narrow width.
- Logic in DOM-free modules with unit tests; `npm test` must pass.
- Check it in the browser: start the "web" config from .claude/launch.json with the preview tools, open /learn.html, build a set from Practice tracks (Quick build works without an API key), and confirm the chart, labels, warnings and hover linking. Look for console errors. If old code shows, re-fetch the changed modules with cache: 'reload' and reload.
- Don't commit. End with what you built, what you checked, and how good the energy estimate looked against tagged tracks.
```

---

## Prompt 3: Song structure guide

```text
Cue Coach (this folder, branch learn-app) is an Electron DJ app for beginners: learn.html + js/learn.js, with DOM-free logic modules in js/ unit-tested with `npm test`.

Build a "How songs are built" guide: one clear page of instructions on how dance tracks are structured and where to mix them, which also uses the track loaded on deck A as the example.

What's there:
- js/mixplan.js has PART_INFO / partInfo(): plain-word descriptions of Intro, Build ("Up"), Drop ("Chorus"), Breakdown ("Down"), Outro, Verse and Bridge, with mixing advice for each.
- js/learn.js colours phrase sections (PHRASE_COLORS, phraseColor) and draws a phrase bar on each deck; tracks carry track.phrases ([{ label, start, end }]) and track.grid ({ bpm, firstDownbeat }); js/engine.js has barLen, beatLen, timeOfBar.
- Lessons live in js/lessons.js (12 lessons; "Counting beats and bars", "Mix on the phrase" and "The bass swap" are the related ones).

Build:
1. Content, in this order, each section short (2–4 sentences plus a picture), written for someone who has never DJed:
   - Beats and bars: 4 beats make a bar, count "1-2-3-4", the "1" is the downbeat.
   - Phrases: 8 bars, then 16 and 32; why changes happen on phrase boundaries.
   - The parts of a track: Intro, Build, Drop, Breakdown, Outro (and Verse / Bridge for vocal tracks). Reuse PART_INFO's wording so the guide and the deck labels agree, and use the same colours as the phrase bar.
   - Where to mix: in over the next track's intro, out over this track's outro, start on a phrase "1", swap the bass on a phrase change; what goes wrong otherwise (two drops clash, a vocal over a vocal, a breakdown with no beat to match).
   - A one-screen cheat sheet at the end.
2. Pictures as inline SVG drawn from data (not image files): a bar of 4 beat dots, a 16-bar phrase grid, and a typical track timeline coloured by part. Add one "Mix map" picture of two overlapping tracks: track A's outro under track B's intro, with the bass swap point marked.
3. "Your track": if deck A has a track with phrases, draw its real structure (coloured by part, with bar numbers and times), mark the best mix-in and mix-out points (use the existing mix-point logic in js/engine.js / js/mixplan.js), and offer "Jump to the outro" / "Jump to the drop" buttons that seek the deck. If there's no track, show the generic timeline with "Load a track to see its structure".
4. Where it lives: a "How songs are built" entry in the side panel's Lessons tab (above the lesson list), a link from the Help (?) menu, and a "Learn more" link from the phrase-related lessons (Counting beats and bars, Mix on the phrase). It opens as a readable page view in the side panel, wide enough to read, with a Back button and keyboard focus handled. Put the content and the SVG builders in a DOM-free js/songguide.js (functions returning data or SVG strings) with a test that the sections render and that the part names match PART_INFO.

House rules:
- Beginner-first: clean, friendly, plain words, no jargon without explaining it. Match the existing look (CSS variables in learn.html, both themes, the icon() helper). Never mention sync as a way to mix.
- `npm test` must pass.
- Check it in the browser: start the "web" config from .claude/launch.json with the preview tools, open /learn.html, open the guide with and without a track on deck A (Practice tracks have phrases), try the Jump buttons, and check light and dark themes and a narrow window. Look for console errors. If old code shows, re-fetch the changed modules with cache: 'reload' and reload.
- Don't commit. End with what you built, what you checked, and screenshots of the guide.
```

---

## Prompt 4: App tour

```text
Cue Coach (this folder, branch learn-app) is an Electron DJ app for beginners: learn.html + js/learn.js, with DOM-free logic modules in js/ unit-tested with `npm test`.

Build a short, skippable first-run tour of the app. It points out where things are; it doesn't teach DJing (the lessons in js/lessons.js already teach the controls by doing). The goal is a new user knowing their way around in under a minute.

1. 7–9 stops, each a highlight on one area plus a short card (title, one or two sentences, Back / Next / Skip tour, "3 of 8"):
   decks (play, cue, jog wheel, speed fader, Key lock from Improver), the beat lane, the mixer (crossfader, EQ, Listen), the library (music sources, the A / B / + buttons), the side panel (Lessons and Set tabs, How songs are built), the level menu (what changes as you level up), the AI coach, the help menu. Read the current DOM to find each element; don't hard-code positions.
2. Stops adapt to the level: only show what's on screen at the current level (js/levels.js featuresFor()). Skip any stop whose element isn't visible.
3. Behaviour: starts once, after the welcome screen and the first music source are chosen; remembered as done (the `store` helper in js/learn.js). Restart it from the Help (?) menu ("Take the tour") and from the menu bar's help menu in the desktop app (see desktop/main.cjs menus and how they message the page). Esc or Skip ends it. Arrow keys move. Focus moves to the card and back afterwards; the highlighted area isn't clickable during the tour. It repositions on resize and scrolls the target into view. Respects prefers-reduced-motion.
4. Put the stop list and the "which stops apply" logic in a DOM-free js/tour.js with tests (level filtering, ordering, done/restart state). Keep the overlay code small; no tour library.

House rules:
- Beginner-first: clean, friendly, plain words. Match the existing look (CSS variables in learn.html, both themes, icon() helper).
- `npm test` must pass.
- Check it in the browser: start the "web" config from .claude/launch.json with the preview tools, open /learn.html with a fresh state (clear the learn.* keys in localStorage), and go through the tour at Starter and at Pro, at a wide and a narrow window size, with the mouse and with the keyboard. Look for console errors. If old code shows, re-fetch the changed modules with cache: 'reload' and reload.
- Don't commit. End with what you built, what you checked, and a screenshot of two stops.
```
