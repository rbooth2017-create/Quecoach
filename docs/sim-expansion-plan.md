# Cue Coach: "DJ Life", a sim expansion pack (plan)

> **Status (22 Nov 2026):** milestones 1–8 are built. Hooks: `js/packs.js`. Pack: `js/packs/djlife/`. Tests: `test/djlife.test.mjs`. Switch it on in Settings → Expansion packs. Still to do: milestone 9 (payday sounds, a fans feed, a balancing pass after real play).

*Draft, 22 Nov 2026. A plan for an add-on that turns Cue Coach's Play view into a DJ life sim: you play gigs to earn money, pay rent, upgrade your home and gear, and build a reputation from the bedroom to the main room.*

---

## 1. The idea in one paragraph

Today the Play view already has a career: five venues (bedroom → house party → The Basement → Warehouse → main room), stars for every mix, and a crowd that reacts. **DJ Life** wraps that in a sim. Each in-game week you get a board of gig offers. You pick one, play it for real on the decks (actual mixing, scored by the existing mix report), and get paid based on how well you did and how happy the crowd was. You spend the money on rent, a better place to live and better gear. Your reputation decides which gigs you're offered. The DJing stays real: **you can't buy skill**. Money buys comfort, looks and access, but every gig is still won by mixing well.

---

## 2. How it works as an add-on

### 2.1 Rules for the pack

1. **Off by default, on with one switch.** Settings → "Expansion packs" → DJ Life on/off. When it's off, the app behaves exactly as it does now.
2. **It never touches the core save.** The pack keeps its own save (`learn.pack.djlife`). Turning it off, or deleting its save, leaves your lessons, levels, career and mix history untouched.
3. **The core doesn't import the pack.** The core gets a small hook system; the pack plugs into it. If the pack folder were deleted, the app would still run.
4. **Logic is DOM-free and tested**, like the rest of the app (`career.js`, `playscore.js`, `mixreport.js`). The money and gig maths live in plain modules with `node --test` tests; the screens are separate.
5. **No real money, ever.** Everything is in-game cash. No in-app purchases, no ads.

### 2.2 The small change the core needs: a pack hook system

A new file, `js/packs.js` (about 60 lines), gives the core a way to tell packs what happened and to let packs add to the screen:

```js
// js/packs.js
const packs = [];
export function registerPack(pack) { packs.push(pack); }
export function activePacks() { return packs.filter((p) => p.enabled()); }

// events: the core says "this happened", packs react
export function emit(event, data) {
  for (const p of activePacks()) p.on?.[event]?.(data);
}

// filters: the core asks "anything to change about this?", packs can adjust it
export function filter(name, value, ctx) {
  return activePacks().reduce((v, p) => p.filters?.[name]?.(v, ctx) ?? v, value);
}
```

Then the core calls these at a handful of points that already exist:

| Where in the core | Hook | What DJ Life does with it |
|---|---|---|
| `onMixReport()` in `js/learn.js` (around line 1172), after a mix is scored | `emit('mixFinished', { report, stars, career })` | Counts the mix towards the current gig |
| `update()` in `js/playview.js`, where the crowd's vibe is worked out (around line 483) | `emit('frame', { vibe, venue, dt })` | Tracks the crowd's average vibe for tips |
| `update()` in `js/playview.js` | `filter('vibeRate', rate, { gear })` | Gear bonuses: better speakers lift the crowd a little faster |
| Play view top bar (`pv-top-r`) | `filter('topChips', [])` | Adds the wallet chip (cash) and the calendar chip (day / week) |
| Venue map (`openMap()`) | `filter('mapScreen', html)` | Replaced by the gig board while the pack is on |
| Booking screen (`openBooked()`) | `filter('bookingFlow', defaultFlow)` | The "you've been booked" step becomes accepting a gig offer |
| Play view backdrop (`.pv-scene`) | `filter('sceneLayers', [])` | Draws the gear you own (lights, speakers, posters) into the room |
| Settings panel | `filter('settingsRows', [])` | The on/off switch and "Reset DJ Life save" |

That's the whole core change: one new file and about eight one-line calls. Everything else lives in the pack.

### 2.3 The pack's folder

```
js/packs/djlife/
  index.js        registers the pack: hooks, filters, enabled()
  economy.js      DOM-free: cash, rent, payouts, prices          (tested)
  gigs.js         DOM-free: makes the weekly gig board            (tested)
  gear.js         data: every item you can buy, and what it does
  homes.js        data: every place you can live
  save.js         load / check / migrate the pack's save
  djlifeview.js   the screens: gig board, shop, home, week summary
  djlife.css      styles, in the same Afterhours neon look
test/
  djlife-economy.test.mjs
  djlife-gigs.test.mjs
  djlife-save.test.mjs
```

`learn.html` loads the pack with one `<script type="module">` line that imports `js/packs/djlife/index.js`. The Electron build already ships everything under `js/**`, so no build changes are needed.

### 2.4 How it fits with skill levels and the career

The app's core idea is that **skill unlocks tools** (`js/levels.js`): Starter gets the coach, Pro gets the full EQ. The sim must not break that. So:

- **Levels still decide which tools are on screen.** Buying gear never switches on a tool you haven't earned by skill.
- **The venue ladder stays the same.** Each venue still sits on a level. To be offered gigs at a venue you need: the skill level (from mixing well, as now), enough **reputation**, and the **minimum gear** the venue expects (no one books a DJ for the Warehouse who turns up with a toy controller).
- **The career save keeps working.** While DJ Life is on, the existing career (`js/career.js`) still counts your stars and streak, and "booked at the next venue" becomes "the next venue starts sending you offers".

---

## 3. How the game works

### 3.1 The loop

```
   ┌──────────── Monday: the gig board ─────────────┐
   │  3–5 offers, based on your reputation + gear   │
   └───────────────────────┬────────────────────────┘
                           ▼
        Pick a gig  (or practise at home, or rest)
                           ▼
     Play it for real in the Play view: N mixes
     scored by the mix report, crowd vibe tracked
                           ▼
     Payday: fee × how well you played + tips
     Reputation goes up (or down)
                           ▼
     Spend: rent, gear, home upgrades, music
                           ▼
          Sunday: week summary → next week
```

Time moves in **days**, not real hours. Playing a gig or practising uses up a day. Each week has 7 days; rent is due on Sunday. You can play as many gigs as fit in your week, but most weeks only have 2–3 offers worth taking.

### 3.2 Gigs

Every gig offer has:

| Field | Example |
|---|---|
| Venue | The Basement |
| Night | Friday |
| Fee | £60 |
| Length | 4 mixes |
| Crowd wants | "High energy, house and disco" (energy + genre, matched against the tags in your library) |
| Needs | Reputation 40+, a mid-range controller |
| Bonus goal (optional) | "No trainwrecks", "Keep the floor above 70 %", "Finish on a 3-star mix" |

Gig lengths grow with the venues: bedroom streams 2 mixes, house party 3, The Basement 4, Warehouse 5, main room 6.

**Playing it** is the existing Play view, unchanged: the same decks, the same coach (if your level has it), the same crowd. The pack just keeps score across the gig's mixes.

**Getting paid:**

```
performance = average mix score / 100              (0 … 1, from js/mixreport.js)
pay         = fee × (0.5 + 0.5 × performance)      (turn up and play badly: half the fee)
tips        = crowd size × average vibe × tipRate  (vibe from js/playscore.js)
bonus       = +25 % of the fee if the bonus goal was met
```

**Reputation** (0–100) goes up after a good gig, down a little after a bad one, and slowly drifts down if you don't play for a couple of weeks. It decides which venues send offers and how good the fees are.

A gig can't be "lost" mid-way. If it goes badly, you still finish it, get a smaller payment and a short, kind note about what to practise (the mix report already knows which lesson fixes each part of the score).

### 3.3 Money out

| Cost | How it works |
|---|---|
| Rent | Every Sunday, set by where you live |
| Travel | Small cost per gig; bigger venues are further away |
| Gear | One-off purchases in the shop |
| Home upgrades | Moving house, or decorating the room you're in |
| Music | Optional "record bag" packs that complete a gig's genre request (see 3.6) |

**Going broke is soft.** If you can't pay rent, you move back to the bedroom at your parents' place (free) and keep your gear. No game over, no losing progress on the decks.

### 3.4 Your home

Homes are a mix of looks and real game effects:

| Home | Rent / week | What it gives you |
|---|---|---|
| Bedroom at your parents' | Free | Practise only; the starting room |
| Shared flat | £40 | Host house parties (a gig type you organise yourself: you set the price, friends come) |
| Studio flat | £90 | Room for a proper booth; record mixtapes that gain fans while you sleep |
| Warehouse loft | £180 | Host your own club nights; bigger home parties |
| Studio house | £350 | Your own label: release mixes, run a residency |

Each home has a few **decor slots** (posters, plants, record shelves, LED strips) that just look nice. They show up behind the decks in the Play view, using the same scene layers the venues use today.

### 3.5 Gear

Gear is the main thing to save up for. It **never** changes the mixing maths (your beats are as matched as you make them). It changes how the crowd feels, which gigs you can take and how you look.

| Slot | Tiers (cheap → top) | Effect |
|---|---|---|
| Controller | Toy → Starter 2-deck → Club 2-deck → 4-deck | Venue requirement; looks on stage |
| Headphones | Earbuds → Basic → Studio → Pro club | Small "focus" bonus: mistakes upset the crowd a bit less |
| Speakers (home) | Laptop → Desk monitors → Studio monitors | Home-party crowd vibe rises faster |
| Lights | Desk lamp → LED strip → Moving heads → Lasers | Crowd vibe lifts a little faster at your own parties |
| Laptop | Old → Decent → Fast | Cosmetic, plus unlocks mixtape recording at the studio flat |
| Outfit / merch | Hoodie → Logo tee → Stage look | Reputation bonus per gig (small) |

Bonuses are small on purpose (5–15 %). A great mix with cheap gear still beats a bad mix with expensive gear.

### 3.6 Music and the crowd's taste

Each gig asks for an energy and a style. The pack checks the songs you actually play against their tags and energy (`js/energy.js`, `js/tags.js`). Playing what the crowd asked for gives a small vibe boost. Because the music is the player's own library, the pack **never sells real songs**. "Record bags" are just in-game badges that say "you dug for disco this week", giving a reputation bonus at disco gigs, nothing more.

### 3.7 Fans and social (later)

A simple fan counter: good gigs and released mixtapes add fans, fans raise your reputation slowly over time. Later a fake social feed could show crowd reactions ("that bass swap at 1am 🔥"). Not needed for the first version.

### 3.8 Example first weeks

> **Week 1.** You live at your parents', £0. The board has two offers: a bedroom livestream (2 mixes, £10) and a friend's house party (3 mixes, £25, needs reputation 5). You do the stream, get 2 stars on both mixes: £9 + £2 tips, reputation 0 → 6. Now the party is open.
>
> **Week 3.** £85 saved. You buy Basic headphones (£40). The Basement starts sending offers once you hit Improver level and reputation 25.
>
> **Week 8.** Moving into a shared flat (£40/week) lets you host your own house parties. Rent is now a real decision.

---

## 4. Numbers to start with (to tune later)

| | Bedroom | House party | The Basement | Warehouse | Main room |
|---|---|---|---|---|---|
| Mixes per gig | 2 | 3 | 4 | 5 | 6 |
| Base fee | £10 | £25 | £60 | £180 | £600 |
| Reputation to get offers | 0 | 5 | 25 | 50 | 80 |
| Skill level needed | Starter | Starter | Improver | Confident | Pro |
| Gear needed | – | – | Starter controller | Club controller | Club controller + Pro headphones |

Keep every number in one table in `economy.js` so balancing is one file.

---

## 5. Building it, step by step

Each milestone is playable on its own.

1. **Hooks in the core.** Add `js/packs.js` and the eight calls from section 2.2. With no pack registered, nothing changes (run `npm test` to check).
2. **Empty pack.** `js/packs/djlife/index.js` registers, adds the on/off switch and a wallet chip showing £0.
3. **Economy + save.** `economy.js` and `save.js`, with tests: payouts, rent, going broke, loading an old or broken save.
4. **Gigs.** `gigs.js` makes a week's board from reputation, level and gear (seeded random, so tests are repeatable). The gig board screen replaces the venue map. Playing a gig counts mixes through the `mixFinished` hook; payday screen at the end.
5. **Week cycle.** Days, Sunday rent, the week summary screen.
6. **Shop + gear.** `gear.js` catalogue, shop screen, gear requirements on gigs, the small vibe bonuses.
7. **Homes.** `homes.js`, moving house, decor slots drawn into the Play view scene.
8. **Hosting your own parties.** The first home-based gig type.
9. **Polish.** Sounds for payday, the week summary, fans, balancing pass.

A first fun version is milestones 1–5: play gigs, get paid, pay rent.

---

## 6. Open questions

- **Should gear ever unlock tools?** This plan says no, so the learning path stays honest. A "hard mode" could make it so (no hot cues until you own a controller with pads), as an option.
- **Real time or turns?** This plan uses turns (a day per gig). Real-time weeks could feel more like a life sim, but would punish people who play once a week.
- **Does the existing venue map stay?** Proposed: while DJ Life is on, the gig board replaces it; the map comes back when the pack is off.
- **Name.** "DJ Life" is a placeholder.
