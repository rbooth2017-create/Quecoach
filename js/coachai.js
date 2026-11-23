// AI set builder and track suggestions for the Learn app (Claude).
// Desktop app: requests go through the main process, which holds the API key (encrypted).
// Plain browser (development): the key is kept in this browser and requests go straight to the API.
import { slimTrack, eventBrief } from './setbuilder.js';
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

export async function buildSetAI({ library, minutes, vibe, idea, level, first, event, audience }) {
  const cands = candidatesFor(library, first);
  const byId = new Map(cands.map((t) => [t.id, t]));
  const prompt = `Plan a ${minutes}-minute DJ set.${vibe ? ` Vibe: ${vibe}.` : ''}
${eventBrief({ event, audience })}${idea ? `\nThe DJ says: "${idea}".` : ''}
The DJ is ${LEVEL_NOTE[level] || LEVEL_NOTE.starter}.
${first ? `Start with this track: ${first.id}.` : 'Pick a good opener.'}
Count about three quarters of each track's minutes as played time, and stop when the set is long enough.
Shape the energy to the event and crowd. Prefer neighbouring keys (Camelot) and small BPM steps where the event calls for smooth blends. Make each mixing tip fit the event.

Tracks (JSON lines):
${cands.map((t) => JSON.stringify(slimTrack(t))).join('\n')}`;
  const data = await ask({ system: SYSTEM, prompt, schema: SET_SCHEMA, effort: 'medium' });
  const seen = new Set();
  const items = data.tracks.filter((x) => byId.has(x.id) && !seen.has(x.id) && seen.add(x.id)).map((x) => ({ track: byId.get(x.id), why: x.why, tip: x.tip, ai: true }));
  if (!items.length) throw new Error('The AI didn\'t pick any tracks from your library. Try again.');
  return { title: data.title, story: data.story, items };
}

/**
 * Rework a set the DJ has voted on: keep every 👍 track where it is, replace every 👎 track, follow the
 * DJ's instruction. `set` is the saved set ({ items: [{ id, why, tip, vote }] }). Returns proposed items
 * [{ id, why, tip }] in order plus a title and story; mergeRefined() then puts the 👍 tracks back on their
 * exact slots and drops anything that breaks the rules.
 */
export async function refineSetAI({ library, set, instruction, vibe, minutes, level, from = library, event, audience }) {
  const byId = new Map(library.map((t) => [t.id, t]));
  const inSet = set.items.map((i) => byId.get(i.id)).filter(Boolean);
  const cands = candidatesFor(from, inSet[0] || null).filter((t) => !set.items.some((i) => i.id === t.id));
  const verdict = (v) => (v > 0 ? 'KEEP' : v < 0 ? 'SWAP' : 'open');
  const prompt = `Refine this ${minutes}-minute DJ set.${vibe ? ` Vibe: ${vibe}.` : ''}
${eventBrief({ event, audience })}${instruction ? `\nThe DJ asks: "${instruction}".` : ''}
The DJ is ${LEVEL_NOTE[level] || LEVEL_NOTE.starter}.

The DJ has voted on the current set. Rules:
- KEEP tracks must stay at exactly the same position (1-based) with the same id.
- SWAP tracks must be left out and replaced with different tracks from the library list.
- open tracks may stay, move or be replaced.
- Use each track once. Count about three quarters of each track's minutes as played time.
Return the whole new set in order, with a why and a mixing tip for every track.

Current set, in order (JSON lines):
${set.items.map((i, n) => { const t = byId.get(i.id); return t ? JSON.stringify({ position: n + 1, verdict: verdict(i.vote), ...slimTrack(t) }) : ''; }).filter(Boolean).join('\n')}

Other tracks in the library (JSON lines):
${cands.map((t) => JSON.stringify(slimTrack(t))).join('\n')}`;
  const data = await ask({ system: SYSTEM, prompt, schema: SET_SCHEMA, effort: 'medium' });
  const tracks = data.tracks.filter((x) => byId.has(x.id));
  if (!tracks.length) throw new Error('The AI didn\'t pick any tracks from your library. Try again.');
  return { title: data.title, story: data.story, items: tracks.map((x) => ({ id: x.id, why: x.why, tip: x.tip })) };
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

// ---------- track notes ----------
const TRACK_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['summary', 'when', 'howto', 'next'],
  properties: {
    summary: { type: 'string', description: 'Two sentences: what kind of track this is and how it moves, in plain words.' },
    when: { type: 'string', description: 'One sentence: where in a set it fits best (warm-up, build, peak, cool-down) and why.' },
    howto: { type: 'array', items: { type: 'string' }, description: 'Two or three concrete tips for mixing in and out of this track, using its real times and bars.' },
    next: {
      type: 'array',
      items: { type: 'object', additionalProperties: false, required: ['id', 'why'], properties: { id: { type: 'string' }, why: { type: 'string', description: 'Under 15 words.' } } },
      description: 'Up to two tracks from the candidates that would mix well after this one.',
    },
  },
};

/**
 * Notes on one track for the Track tab: what it is, where it fits in a set, how to mix it and what could come
 * next. Only details are sent (title, artist, BPM, key, energy, genre, its parts with times), never audio.
 */
export async function describeTrackAI({ track, parts, candidates = [], level }) {
  const byId = new Map(candidates.map((t) => [t.id, t]));
  const prompt = `Describe this track for a DJ learning to mix. You can't hear it: work from its details and the structure the app found, and don't claim to know how it sounds beyond that.
The DJ is ${LEVEL_NOTE[level] || LEVEL_NOTE.starter}.

Track: ${JSON.stringify(slimTrack(track))}
Its parts, in order (start time, length in bars): ${JSON.stringify(parts)}

Tracks that could come next (JSON lines, checked for key and tempo by the app):
${candidates.map((t) => JSON.stringify(slimTrack(t))).join('\n') || '(none)'}`;
  const data = await ask({ system: SYSTEM, prompt, schema: TRACK_SCHEMA, effort: 'low' });
  return { summary: data.summary, when: data.when, howto: (data.howto || []).slice(0, 3), next: (data.next || []).filter((n) => byId.has(n.id)).slice(0, 2).map((n) => ({ track: byId.get(n.id), why: n.why })) };
}

// ---------- Studio: write a track ----------
const PRODUCER = 'You are Cue Coach Studio, a dance music producer helping a beginner make a club track in a simple loop arranger. '
  + 'Tracks are built from sections (whole phrases) and lanes; each cell holds one loop that repeats for the section.';

/**
 * Ask Claude to write a track: sections, which loop plays in each lane, and new drum/bass/chord/lead patterns.
 * `catalog` lists the built-in loops and the producer's samples; `schema` comes from studiomodel.aiSchema().
 * The answer is checked by studiomodel.projectFromAI() before it is used.
 */
export async function composeTrackAI({ brief, style, bpm, key, catalog, schema }) {
  const prompt = `Write a ${style} track${bpm ? ` at ${bpm} BPM` : ''}${key ? ` in ${key}` : ''}.${brief ? `\nThe producer says: "${brief}".` : ''}

Make it easy for DJs to mix:
- Start with an intro of 32 bars and end with an outro of 32 bars, using only the drums, perc and fx lanes there.
- Every section is 8, 16 or 32 bars. Include at least one build and one drop, and a break between drops.
- Keep the kick on every beat in intros, drops and outros.

Write each new loop as pattern text. First line: what it is (drums, bass, lead or chords), then its sound and options. Each bar is 16 steps (16th notes); loops are 1, 2 or 4 bars; spaces and | are only for reading.
- Drums: one row per drum (kick, clap, hat, open, perc): x = hit, o = soft hit, . = rest. Optional swing=0.1 on the first line.
  drums
  kick  x... x... x... x...
  clap  .... x... .... x...
  hat   o.o. o.o. o.o. o.o.
- Bass and lead: sound is one of sub, reese, acid, pluck (bass) or pluck, saw, bell, acid (lead). Add "follow" so the notes move with the chords (always for bass). A "notes" row has one token per step: a scale degree starts a note (0 = the key's root, 7 = an octave up, -2 = below), _ holds it, . is a rest.
  bass sub follow
  notes . . 0 _ . . 0 _ . . 0 _ . . 7 _
- Chords: sound is stab, organ or pad; they play the progression. A "hits" row of 16 steps (x = play); a pad needs no hits row.
  chords stab
  hits  ..x. .... ..x. ....
Give each loop the lane it plays in (drums or perc for drum loops).
In each section's lanes give a pattern id you wrote, a built-in loop id, a sample id (s:...), or "" for silence. Only put loops in the lane they belong to.

${catalog}`;
  return ask({ system: PRODUCER, prompt, schema, effort: 'medium' });
}
