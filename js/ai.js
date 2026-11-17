// Optional AI coach: asks Claude to pick the next track from the rule-based shortlist.
// The API key stays in this browser; requests go straight to the Anthropic API.
import Anthropic from 'https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@1.4.0/+esm';

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['picks', 'set_note'],
  properties: {
    set_note: { type: 'string', description: 'One or two sentences on where the set is heading.' },
    picks: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'why', 'transition_tip'],
        properties: {
          id: { type: 'string', description: 'Track id from the candidate list' },
          why: { type: 'string' },
          transition_tip: { type: 'string', description: 'Concrete technique: EQ, phrase, loop, FX, length of blend.' },
        },
      },
    },
  },
};

const slim = (t) => ({ id: t.id, title: t.title, artist: t.artist, genre: t.genre, bpm: t.bpm, key: t.camelot, energy: t.energy, rating: t.rating });

export async function askCoach({ apiKey, current, history, candidates, direction, level }) {
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
  const prompt = `I'm DJing with rekordbox and a controller. My level: ${level}. I want the energy to go: ${direction}.

Playing now: ${JSON.stringify(slim(current))}
Played earlier in this set (oldest first): ${JSON.stringify(history.map(slim))}

Candidates already filtered for key and tempo (with the app's scores):
${JSON.stringify(candidates.map((c) => ({ ...slim(c.track), score: +c.score.toFixed(2), notes: c.reasons })))}

Pick the best 3 next tracks from the candidates only, in order. For each, say why it fits the set's story, and give one transition tip a ${level} DJ can actually do on a 2-channel controller.`;

  const response = await client.beta.messages.create({
    model: 'claude-opus-5-5',
    max_tokens: 4000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
    system: 'You are a friendly, practical DJ coach. Be concise and specific. Use only track ids from the candidate list.',
    messages: [{ role: 'user', content: prompt }],
  });
  if (response.stop_reason === 'refusal') throw new Error('The model declined this request.');
  const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  const data = JSON.parse(text);
  const byId = new Map(candidates.map((c) => [c.track.id, c]));
  data.picks = data.picks.filter((p) => byId.has(p.id)).map((p) => ({ ...p, cand: byId.get(p.id) }));
  return data;
}
