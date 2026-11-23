# Cue Coach — competitive benchmark (November 2026)

**Goal:** teach people to DJ properly without relying on sync, suggest the best sets and next tracks to keep the party going, and stay simpler than everything else. Phase 2 coaches more advanced skills.

**Bottom line:** no other product gives **live, hands-on coaching on top of the DJ software people already use**. That's our lead, and it's real. But there are four gaps where competitors are ahead:

1. **We don't measure progress.** Competitors score every attempt. We tick steps, but we never say "you're getting better".
2. **Our beat meter can become a crutch, just like sync.** We have no stage where we take the help away and check that the user can do it by ear.
3. **We pick the next track, but we don't plan a set.** Competitors already order whole sets by energy.
4. **Rekordbox 7 now marks where vocals are, even on the free plan.** We ignore that, so we can suggest a mix point where two vocals clash.

---

## 1. Who we're up against

| Category | Products | What they do well | What they don't do |
|---|---|---|---|
| **DJ software** | rekordbox 7, Serato DJ Pro 4, Traktor Pro 4, VirtualDJ 2026, djay Pro 5, Engine DJ 5 | Track suggestions, stems, automix, AI cue points, phrase analysis | They teach almost nothing while you play. Their help pushes users toward sync and automix. |
| **Live coaching apps** | **Coach DJ Pro**, Crossfader Coach, Tribe DJ, onset | Mix scoring, video lessons, AI chat, virtual controllers | None of them watches you mix in your real software and coaches you in real time |
| **Courses** | Crossfader, DJ Carlo (Studio.com), DevStar/FaderPro, djay DJ School, DJLearn | Structured lessons, beatmatching by ear, human feedback | Video only and not live; feedback comes days later |
| **Ear training** | Beatmatch PRO | Matching tempo by ear, scored out of 100%, daily challenge | Not on real gear, no mixing |
| **Prep tools** | Mixed In Key 11, Lexicon, DJ.Studio 5 | Energy 1–10, key, cue points, play history, phrase detection | Not live and not for teaching |

**Biggest threat: Coach DJ Pro (coachdj.net).** It's local-first on Mac and Windows, reads rekordbox and Serato libraries, scores recorded mixes on 7 measures (beat alignment in ms, tempo, structure, Camelot harmony, bass/mids/highs, per transition), offers a **Live Assistant** that detects the playing track and suggests what to play next, and builds setlists by BPM, key and energy. It costs €27–89 for life or €7.99 a month, and has a free plan. It's the product closest to ours. Where it's weaker: its feedback comes after the mix, and it doesn't watch the controller or coach you step by step.

**Next biggest: Crossfader Coach.** It plays lessons over your DJ software and gives feedback on uploaded mixes (a score per transition, notes pinned to timestamps, one thing to work on next). It has the biggest course catalogue and is sorted by controller (FLX2, FLX4, and others).

---

## 2. Feature by feature

✅ we have it · 🟡 we have part of it · ❌ we don't have it

### Learning to mix without sync

| Feature | Us | Best competitor |
|---|---|---|
| Live step-by-step coaching while you use your own DJ software | ✅ 15 steps, ticked automatically from the controller | Nobody does this live. Crossfader Coach plays lessons over your software. |
| Live beat meter on rekordbox's own decks | ✅ beat view reads rekordbox's waveforms | Nobody |
| Advice in plain words ("Deck 2 is 40 ms behind — push the jog") | ✅ | Nobody does this live |
| **Beatmatching by ear: help that fades out** | ❌ the meter is always on | Beatmatch PRO, DJ Carlo, DevStar |
| **Score for each transition** | ❌ | Coach DJ Pro (7 measures), Crossfader Mix Feedback |
| **Progress over time, streaks, skill level** | ❌ nothing saved | onset (repeat practice at spaced intervals), Beatmatch PRO, course apps |
| Ordered lessons (a curriculum) | 🟡 one routine for mixing a track in | Crossfader (50+ lessons per controller), DJ School |
| Practice with no controller or music | 🟡 practice decks and demo synth | Tribe DJ (virtual FLX4/FLX2, starter packs), Serato Practice Mode |
| Key lock in the practice decks | ❌ (changing tempo changes pitch) | Every DJ app |
| Waveforms coloured by frequency band | ❌ one colour | rekordbox, Serato, Engine DJ 5 (RGB) |

### Next track and set planning

| Feature | Us | Best competitor |
|---|---|---|
| Next-track ranking (key, BPM including half and double time, genre, energy, rating) | ✅ | rekordbox Track Suggestion (5 modes: Era, Mood, Association, Collection Radar, Streaming Radar) |
| AI picks the next track and says why | ✅ Claude, adjusted to the user's level | VirtualDJ AI prompt (Pro licence), Coach DJ Pro Live Assistant |
| Follows what's playing in rekordbox | ✅ play history plus reading the deck headers | Coach DJ Pro detects the track from audio |
| Mix points that follow phrases | ✅ rekordbox phrase data | rekordbox Mix Point Link, DJ.Studio 5 |
| **Avoiding vocal clashes** | ❌ | rekordbox 7.2.16 vocal positions (free plan) |
| **Planning a whole set around an energy curve** | ❌ | Coach DJ Pro setlist generator, djay Automix, DJ.Studio |
| **Suggestions based on what other DJs play next** | ❌ | VirtualDJ GeniusDJ |
| **Learning from the user's past sets** | ❌ (we use play history only to skip tracks) | Lexicon 1.10 play history and session ratings |
| One-tap "the crowd is…" signal to steer suggestions | ❌ (nobody has this either) | — chance to be first |
| Streaming sources (Spotify, TIDAL, SoundCloud) | ❌ | rekordbox, Serato, djay, Tribe DJ |

### Platform and trust

| Item | Us | Note |
|---|---|---|
| rekordbox | ✅ | Reads the database directly, no XML needed |
| Serato DJ Lite/Pro, djay | ❌ (the guide still works without the connection) | Serato Lite comes free with many beginner controllers. Coach DJ Pro already supports Serato. |
| Controllers with automatic tracking | 🟡 FLX4, 400, 200 | **DDJ-FLX2 is missing** — the beginner controller with the most courses aimed at it. FLX6, REV1, XDJ-RR are missing too. |
| Signed installers | ❌ | "Unidentified developer" and SmartScreen warnings scare off beginners |
| Price | — | To beat: Coach DJ Pro €27 lifetime / €7.99 a month. Crossfader courses about £58–115. |

---

## 3. What to build next (P0 = must have, P1 = should have, P2 = nice to have)

### P0 — the core promise: teaching real skill

1. **Help that fades out as the user improves.** Each skill moves through four levels: *Guided* (meter and steps on) → *Hint* (meter only when you're more than 30 ms off) → *By ear* (meter hidden, revealed after you call "matched") → *Mastered*. Move up automatically after N clean attempts in a row. This answers "no reliance on auto beatmatch". Without it our meter is just sync with extra steps.
2. **Score each transition from data we already capture live.** We have more than Coach DJ Pro, which only hears the recording: phase error over time (ms), how long the tempo took to settle, whether PLAY landed on the phrase, overlap of the two basslines (low EQ from the controller), level match, key clash, energy step. Show one score and **one thing to fix next**, the way Crossfader does.
3. **Save progress.** Keep each session, each transition's score, the level for each skill, and a streak. Show it on a simple "Your progress" card. Nobody else ties progress to live mixing.

### P1 — smarter suggestions and set planning

4. **Mix points that avoid vocal clashes.** Read rekordbox's vocal-position data through the helper (check that pyrekordbox exposes it; if not, use the ANLZ files). Don't suggest blending over two vocals at once, and teach "bring the next track in under the outro, not over the vocal".
5. **Plan a set around an energy curve.** The user chooses a curve (warm-up / peak hour / closing) and a length. We build an ordered set with key and energy steps, then *coach* along it. When they go off plan, we plan again from where they are.
6. **One-tap "Floor: 🔥 / 😐 / 🥶".** A crowd signal for the suggestion ranking and the AI. It keeps the interface simple, nobody else has it, and it fits "keep the party going". Save it with the session so we learn what worked.
7. **Add DDJ-FLX2 support** (there's a Mixxx mapping to import), then FLX6 and REV1.

### P2 — polish and reach

8. Key lock and waveforms coloured by frequency band in the practice decks, so the bass swap is visible.
9. Sign and notarise the installers before any public beta.
10. Look at the Serato DJ Lite connection (history and database). It's the second-biggest beginner group.

### Keeping it simple (applies to everything above)
- The Mix page shows **one** current step, one score and one next action. Everything else is folded away.
- New users start with a 2-minute first win: demo tracks, beatmatch with the meter, get a score, and see their progress card.
- Don't add stems, FX or loops to the beginner view. That's Phase 2.

---

## 4. Phase 2 skills to plan for

Ordered by how often DJs need them, mapped to what competitors teach in videos only:

| Skill | How we'd sense it live |
|---|---|
| EQ blending beyond the bass swap (handing off mids and highs) | All three EQ bands from MIDI |
| Phrase-length transitions (16/32 bars) and double drops | Phrase map plus timing of play and fader moves |
| Loops to make an intro or outro longer | Loop buttons from MIDI, bar alignment |
| Filter and echo-out transitions, FX on the beat | FX and filter MIDI, beat phase |
| **Stem transitions** (vocal off before the blend). rekordbox, Serato and djay all have stems now. | Stem pads from MIDI |
| Harmonic energy boosts (+1, +2, +7 on the Camelot wheel) | Key data we already have |
| Reading the crowd and recovering a set | Floor signal plus set plan |
| Moving to club CDJs (USB export, tempo range, no sync on older players) | Checklist plus "club mode" practice with no meter and ±6% tempo range |

---

## 5. Caveats
- Competitor details come from vendor pages and reviews checked on 2026-11-18. onset's site returned 404, so its details (30-lesson curriculum, MIDI scoring) come from search snippets only. Prices change, and Coach DJ Pro shows launch discounts.
- I haven't checked whether pyrekordbox exposes rekordbox's vocal-position data. Check that before committing to item 4.
- This benchmark compares feature lists. It doesn't include hands-on testing of competitor apps.

### Sources
- rekordbox: [7.2.16 release](https://rekordbox.com/en/2026/07/rekordbox-v7216-release-information/), [release notes](https://rekordbox.com/en/support/releasenote/), [7 FAQ (Track Suggestion modes)](https://rekordbox.com/en/support/faq/rekordbox7/), [DJing features](https://rekordbox.com/en/feature/djing/), [free vocal detection](https://www.aifordjsglobal.com/blog/rekordbox-ai-vocal-detection-free/), [rekordbox 7 launch](https://www.digitaldjtips.com/rekordbox-7-launched/)
- Serato: [DJ Pro](https://serato.com/dj/pro), [4.0 overview](https://support.serato.com/hc/en-us/articles/14173738028175-Software-Overview-Serato-DJ-Pro-4-0)
- VirtualDJ: [2026 AI assistant](https://musictech.com/news/gear/virtualdj-2026/), [features](https://virtualdj.com/products/virtualdj/features.html)
- djay: [djay Pro 5](https://www.engadget.com/ai-joins-you-in-the-dj-booth-with-algoriddims-djay-pro-5-150007224.html), [release notes](https://www.algoriddim.com/djay-pro-mac/releasenotes), [DJ School](https://help.algoriddim.com/user-manual/djay-ios/tips/tutorials)
- Engine DJ / Traktor: [best AI DJ software 2026](https://cortexdj.com/best-ai-dj-software-2026.html), [Lexicon updates](https://www.lexicondj.com/dj-software-updates)
- Prep tools: [Mixed In Key energy level](https://mixedinkey.com/workflows/use-energy-level-detection/), [Lexicon 1.10](https://www.digitaldjtips.com/lexicon-1-10-brings-serato-4-0-support-track-timeline-play-history/), [DJ.Studio 5](https://www.aimusicpreneur.com/ai-tools-news/dj-studio-5-whats-new-phrase-detection-smart-beatgrid/)
- Coaching: [Coach DJ Pro](https://coachdj.net/en/), [Crossfader](https://wearecrossfader.co.uk/), [Tribe DJ](https://dj.tribexr.com/), [DJ Carlo / Studio.com](https://studio.com/apps/dj/dj), [onset](https://onsetdj.com/), [Beatmatch PRO](https://interspacemusic.com/blog/beatmatch-pro-free-app-gamifies-dj-beatmatching-practice/), [DJLearn](https://djlearn.de/en)
