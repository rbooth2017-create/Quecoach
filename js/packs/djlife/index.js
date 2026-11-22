// DJ Life: the expansion pack's front door. It registers with js/packs.js and hands the core's events to the game.
// Switch it on in Settings → Expansion packs. Its save lives apart from the core's, under learn.pack.djlife.
import { registerPack } from '../../packs.js';
import { createDjLife } from './djlifeview.js';
import { loadLife } from './save.js';
import { money, weekOf } from './economy.js';
import { homeById } from './homes.js';

const KEY = 'learn.pack.djlife';
let app = null;

registerPack({
  id: 'djlife',
  name: 'DJ Life',
  blurb: 'Play gigs for money, pay the rent, buy better gear and move out of your parents\' bedroom.',
  start(ctx) { app = createDjLife(ctx, { key: KEY }); },
  stop() { app?.destroy(); app = null; },
  /** For the start screen: null with no save yet, otherwise where you are. */
  resume() {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(KEY)); } catch { /* no save */ }
    if (!saved || typeof saved !== 'object') return null;
    const l = loadLife(saved);
    if (!l.intro && !l.history.length) return null; // switched on once, never played
    return { title: `Week ${weekOf(l.day) + 1}`, line: `${money(l.cash)} · ${homeById(l.home).name}${l.gig ? ` · Tonight: ${l.gig.offer.title}` : ''}` };
  },
  reset() { try { localStorage.removeItem(KEY); } catch { /* private mode */ } },
  on: {
    mixFinished: (d) => app?.mixFinished(d),
    frame: (d) => app?.frame(d),
  },
  filters: {
    venue: (id) => app?.venue(id),
    venueName: (name) => app?.venueName(name),
    vibe: (v, c) => app?.vibe(v, c),
    gigHud: () => app?.hud(),
    resultGigLine: (line) => app?.resultLine(line),
    openMap: () => (app ? (app.openBoard(), true) : undefined),
    openRoom: () => (app ? (app.openRoom(), true) : undefined),
  },
});
