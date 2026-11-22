// DJ Life: the expansion pack's front door. It registers with js/packs.js and hands the core's events to the game.
// Switch it on in Settings → Expansion packs. Its save lives apart from the core's, under learn.pack.djlife.
import { registerPack } from '../../packs.js';
import { createDjLife } from './djlifeview.js';

const KEY = 'learn.pack.djlife';
let app = null;

registerPack({
  id: 'djlife',
  name: 'DJ Life',
  blurb: 'Play gigs for money, pay the rent, buy better gear and move out of your parents\' bedroom.',
  start(ctx) { app = createDjLife(ctx, { key: KEY }); },
  stop() { app?.destroy(); app = null; },
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
  },
});
