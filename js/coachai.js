// AI set builder and track suggestions for the Learn app (Claude).
// Desktop app: requests go through the main process, which holds the API key (encrypted).
// Plain browser (development): the key is kept in this browser and requests go straight to the API.
import { slimTrack } from './setbuilder.js';
import { friendlyMatch } from './musiclib.js';

const desktop = window.cueDesktop?.ai || null;
const BROWSER_KEY = 'learn.anthropicKey';
const MODEL = 'claude-opus-5-5';

export async function aiStatus() {
  if (desktop) return { ...(await desktop.status()), where: 'desktop' };
  let hasKey = false; try { hasKey = !!localStorage.getItem(BROWSER_KEY); } catch { /* private mode */ }
  return { hasKey, secure: false, model: MODEL, where: 'browser' };
}
export async function aiSetKey(key) {
  if (desktop) return desktop.setKey(key);
  key = String(key || '').trim();
  if (!/^sk-ant-[\w-]{20,}$/.test(key)) return { error: 'That doesn\'t look like an Anthropic API key. It starts with "sk-ant-".' };
  try { localStorage.setItem(BROWSER_KEY, key); } catch { return { error: 'This browser won\'t store the key.' }; }
  return aiStatus();
}
export async function aiClearKey() {
  if (desktop) return desktop.clearKey();
  try { localStorage.removeItem(BROWSER_KEY); } catch { /* ignore */ }
  return aiStatus();
}

async function browserRequest({ system, prompt, schema, effort }) {
  const apiKey = localStorage.getItem(BROWSER_KEY);
  if (!apiKey) return { error: 'NO_KEY' };
  const { default: Anthropic } = await import('https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@1.11.0/+esm');
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 2 });
  try {
    const res = await client.beta.messages.create({
      model: MODEL, max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default',
      output_config: { effort, format: { type: 'json_schema', schema } },
      system, messages: [{ role: 'user', content: prompt }],
    });
    if (res.stop_reason === 'refusal') return { error: 'The AI declined this request.' };
    if (res.stop_reason === 'max_tokens') return { error: 'The AI\'s answer was too long. Try a shorter set.' };
    return { data: JSON.parse(res.content.filter((b) => b.type === 'text').map((b) => b.text).join('')) };
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) return { error: 'Your API key was rejected.' };
    if (err instanceof Anthropic.RateLimitError) return { error: 'The AI is busy right now. Try again in a minute.' };
    if (err instanceof Anthropic.APIConnectionError) return { error: 'Couldn\'t reach the AI. Check your connection.' };
    return { error: err?.message || 'The AI request failed.' };
  }
}

async function ask(payload) {
  const r = desktop ? await desktop.request(payload) : await browserRequest(payload);
  if (r?.error) { const e = new Error(r.error === 'NO_KEY' ? 'Add your Anthropic API key in AI settings first.' : r.error); e.noKey = r.error === 'NO_KEY'; throw e; }
  return r.data;
}

const SYSTEM = 'You are Cue Coach, a friendly, practical DJ teacher inside a learning app with two decks, a crossfader and EQ. '
  + 'Keep every sentence short and in plain words a learner understands. Only use track ids from the list you are given.';

const LEVEL_NOTE = {
  starter: 'a complete beginner: keep tips to matching speed, lining up beats and moving the crossfader slowly',
  improver: 'a beginner who can beatmatch: tips may use the bass dial for a bass swap and 16-bar phrases',
  confident: 'a novice who beatmatches by ear: tips may use bass and treble, phrasing and key changes',
  pro: 'a capable DJ: tips can use full three-band EQ, phrasing, energy and key technique',
};

// ---------- set builder ----------
const SET_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['title', 'story', 'tracks'],
  properties: {
    title: { type: 'string', description: 'A short, fun name for the set.' },
    story: { type: 'string', description: 'Two sentences on how the set flows.' },
    tracks: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false, required: ['id', 'why', 'tip'],
        properties: {
          id: { type: 'string' },
          why: { type: 'string', description: 'Why this track goes here, under 15 words.' },
          tip: { type: 'string', description: 'How to mix into this track, one concrete sentence.' },
        },
      },
    },
  },
};

/** Up to `max` tracks worth showing the AI: the ones that mix best with the start, or a spread of the library. */
function candidatesFor(library, first, max = 160) {
  const usable = library.filter((t) => t.bpm);
  if (usable.length <= max) return usable;
  if (first) return usable.map((t) => [t, t.id === first.id ? 9 : friendlyMatch(first, t).score]).sort((a, b) => b[1] - a[1]).slice(0, max).map((x) => x[0]);
  const step = usable.length / max;
  return Array.from({ length: max }, (_, i) => usable[Math.floor(i * step)]);
}

export async function buildSetAI({ library, minutes, vibe, idea, level, first }) {
  const cands = candidatesFor(library, first);
  const byId = new Map(cands.map((t) => [t.id, t]));
  const prompt = `Plan a ${minutes}-minute DJ set. Vibe: ${vibe}.${idea ? ` The DJ says: "${idea}".` : ''}
The DJ is ${LEVEL_NOTE[level] || LEVEL_NOTE.starter}.
${first ? `Start with this track: ${first.id}.` : 'Pick a good opener.'}
Count about three quarters of each track's minutes as played time, and stop when the set is long enough.
Prefer neighbouring keys (Camelot) and small BPM steps, and shape the energy to the vibe.

Tracks (JSON lines):
${cands.map((t) => JSON.stringify(slimTrack(t))).join('\n')}`;
  const data = await ask({ system: SYSTEM, prompt, schema: SET_SCHEMA, effort: 'medium' });
  const seen = new Set();
  const items = data.tracks.filter((x) => byId.has(x.id) && !seen.has(x.id) && seen.add(x.id)).map((x) => ({ track: byId.get(x.id), why: x.why, tip: x.tip, ai: true }));
  if (!items.length) throw new Error('The AI didn\'t pick any tracks from your library. Try again.');
  return { title: data.title, story: data.story, items };
}

// ---------- next-track suggestions ----------
const PICK_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['note', 'picks'],
  properties: {
    note: { type: 'string', description: 'One sentence on where the music could go next.' },
    picks: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false, required: ['id', 'why', 'tip'],
        properties: { id: { type: 'string' }, why: { type: 'string', description: 'Under 15 words.' }, tip: { type: 'string', description: 'One concrete mixing tip.' } },
      },
    },
  },
};

export async function suggestAI({ current, ranked, played = [], level }) {
  const cands = ranked.slice(0, 25);
  const byId = new Map(cands.map((r) => [r.track.id, r]));
  const prompt = `Playing now: ${JSON.stringify(slimTrack(current))}
Already played: ${JSON.stringify(played.map((t) => t.title))}
The DJ is ${LEVEL_NOTE[level] || LEVEL_NOTE.starter}.

Candidates, already checked for key and tempo by the app (best first):
${cands.map((r) => JSON.stringify({ ...slimTrack(r.track), app_says: r.match.label })).join('\n')}

Pick the best 3 to play next, best first.`;
  const data = await ask({ system: SYSTEM, prompt, schema: PICK_SCHEMA, effort: 'low' });
  return { note: data.note, picks: data.picks.filter((p) => byId.has(p.id)).slice(0, 3).map((p) => ({ ...byId.get(p.id), why: p.why, tip: p.tip })) };
}
