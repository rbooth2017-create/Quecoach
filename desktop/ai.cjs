// Claude for the Learn app, run from the desktop app's main process so the API key never reaches the page.
// The key is encrypted with the operating system's secure storage (Keychain on macOS, DPAPI on Windows).
const fs = require('node:fs');
const path = require('node:path');
const { app, safeStorage } = require('electron');
const SDK = require('@anthropic-ai/sdk');

const Anthropic = SDK.default || SDK;
const MODEL = 'claude-opus-5-5';
const keyFile = () => path.join(app.getPath('userData'), 'anthropic-key.bin');

function readKey() {
  try {
    if (!safeStorage.isEncryptionAvailable()) return null;
    return safeStorage.decryptString(fs.readFileSync(keyFile()));
  } catch { return null; }
}

function status() {
  return { hasKey: !!readKey(), secure: safeStorage.isEncryptionAvailable(), model: MODEL };
}

/** Check the key with a free call (no tokens used), then store it encrypted. */
async function setKey(key) {
  key = String(key || '').trim();
  if (!/^sk-ant-[\w-]{20,}$/.test(key)) return { error: 'That doesn\'t look like an Anthropic API key. It starts with "sk-ant-".' };
  if (!safeStorage.isEncryptionAvailable()) return { error: 'This computer has no secure storage available, so the key can\'t be saved safely.' };
  try {
    await new Anthropic({ apiKey: key, maxRetries: 1, timeout: 20_000 }).models.retrieve(MODEL);
  } catch (err) { return { error: friendlyError(err) }; }
  fs.writeFileSync(keyFile(), safeStorage.encryptString(key), { mode: 0o600 });
  return status();
}

function clearKey() {
  try { fs.unlinkSync(keyFile()); } catch { /* already gone */ }
  return status();
}

function friendlyError(err) {
  if (err instanceof Anthropic.AuthenticationError) return 'Your API key was rejected. Check it in AI Coach settings.';
  if (err instanceof Anthropic.PermissionDeniedError) return 'This API key can\'t use the model Cue Coach needs.';
  if (err instanceof Anthropic.NotFoundError) return 'The AI model isn\'t available for this API key.';
  if (err instanceof Anthropic.RateLimitError) return 'The AI is busy right now (rate limit). Try again in a minute.';
  if (err instanceof Anthropic.APIConnectionError) return 'Couldn\'t reach the AI. Check your internet connection.';
  if (err instanceof Anthropic.APIError) return `The AI service returned an error (${err.status ?? 'unknown'}). Try again shortly.`;
  return err?.message || 'Something went wrong talking to the AI.';
}

/**
 * One structured request. payload = { system, prompt, schema, effort }.
 * Returns { data } (the parsed JSON) or { error } with a message for the user.
 */
async function request(payload) {
  const key = readKey();
  if (!key) return { error: 'NO_KEY' };
  const { system, prompt, schema } = payload || {};
  if (typeof system !== 'string' || typeof prompt !== 'string' || !schema || typeof schema !== 'object') return { error: 'Bad AI request.' };
  if (prompt.length > 400_000) return { error: 'Too much music to send in one go. Try a smaller folder.' };
  const effort = ['low', 'medium', 'high'].includes(payload.effort) ? payload.effort : 'medium';
  try {
    const client = new Anthropic({ apiKey: key, maxRetries: 2, timeout: 180_000 });
    const res = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default', // if the model declines, the API retries on a fallback model automatically
      output_config: { effort, format: { type: 'json_schema', schema } },
      system,
      messages: [{ role: 'user', content: prompt }],
    });
    if (res.stop_reason === 'refusal') return { error: 'The AI declined this request.' };
    if (res.stop_reason === 'max_tokens') return { error: 'The AI\'s answer was too long. Try a shorter set.' };
    const text = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
    return { data: JSON.parse(text), usage: { input: res.usage?.input_tokens, output: res.usage?.output_tokens } };
  } catch (err) {
    if (err instanceof SyntaxError) return { error: 'The AI sent back something unreadable. Try again.' };
    return { error: friendlyError(err) };
  }
}

module.exports = { status, setKey, clearKey, request, MODEL };
