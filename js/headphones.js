// Headphones: where the cue (what you hear before the room does) goes, decided from the sound devices.
// A DJ controller like the DDJ-FLX4 is one sound card with 4 outputs: 1-2 to the speakers, 3-4 to the
// headphone socket. Some drivers show the headphones as their own device instead. DOM-free.

/** How the headphone signal can be sent. */
export const MODES = {
  channels: 'Headphone socket on your controller (outputs 3-4)',
  device: 'A separate headphone output',
  speakers: 'No separate headphones: Listen plays quietly through the speakers',
};

const HP_WORDS = /(head ?phones?|phones|cue|monitor|\b3\s*[-/&]\s*4\b|ch(annel)?s? ?3)/i;
const CONTROLLER_WORDS = /(ddj|flx|pioneer|alphatheta|inpulse|hercules|numark|mixtrack|traktor|kontrol|rane|denon|reloop|controller)/i;

/** Does this output's name look like a controller's headphone output? */
export const looksLikeHeadphones = (label = '') => HP_WORDS.test(label) && CONTROLLER_WORDS.test(label);
/** Does this output's name look like a DJ controller? */
export const looksLikeController = (label = '') => CONTROLLER_WORDS.test(label);

/**
 * Pick the headphone route.
 * maxChannels: outputs on the device the speakers play from (ctx.destination.maxChannelCount).
 * outputs: [{ id, label }] every sound output. mainId: the speakers' output ('' = computer default).
 * choice: the user's own pick: 'auto' | 'speakers' | 'channels' | { device: id }.
 * Returns { mode, channels, master: [l, r], cue: [l, r] | null, deviceId, why }.
 */
export function cueRoute({ maxChannels = 2, outputs = [], mainId = '', choice = 'auto' } = {}) {
  const n = Math.max(2, Math.floor(maxChannels || 2));
  const four = n >= 4;
  const channels = { mode: 'channels', channels: 4, master: [0, 1], cue: [2, 3], deviceId: null, why: 'Speakers on outputs 1-2, headphones on outputs 3-4 of the same sound card.' };
  const speakers = (why) => ({ mode: 'speakers', channels: 2, master: [0, 1], cue: null, deviceId: null, why });
  // A controller as a second output: its headphone socket is outputs 3-4 (audio.js falls back to 1-2 if it has only 2).
  const device = (id, label) => (looksLikeController(label) && !looksLikeHeadphones(label)
    ? { mode: 'device', channels: 4, master: [0, 1], cue: [2, 3], deviceId: id, why: `Headphones in ${label}'s headphone socket. The room hears ${mainName()}.` }
    : { mode: 'device', channels: 2, master: [0, 1], cue: [0, 1], deviceId: id, why: `Headphones play from ${label || 'the chosen output'}.` });
  const mainName = () => outputs.find((o) => o.id === mainId)?.label || 'the computer\'s default output';

  if (choice === 'speakers') return speakers('You chose to use Listen through the speakers.');
  if (choice === 'channels') return four ? channels : speakers('This sound output only has 2 channels, so there\'s no headphone socket on it.');
  if (choice && typeof choice === 'object' && choice.device) {
    if (choice.device === mainId) return four ? channels : speakers('The headphones and speakers are the same output.');
    const o = outputs.find((x) => x.id === choice.device);
    return o ? device(o.id, o.label) : speakers('The headphone output you picked isn\'t plugged in.');
  }
  // automatic
  if (four) return channels;
  const hp = outputs.find((o) => o.id !== mainId && looksLikeHeadphones(o.label));
  if (hp) return device(hp.id, hp.label);
  const main = outputs.find((o) => o.id === mainId);
  // Room sound on the laptop (or other speakers), controller plugged in: its headphone socket still works.
  const ctl = !looksLikeController(main?.label) && outputs.find((o) => o.id !== mainId && looksLikeController(o.label));
  if (ctl) return device(ctl.id, ctl.label);
  if (main && looksLikeController(main.label)) return speakers('Your controller only shows 2 outputs to this computer, so headphones can\'t be separate yet. See the tip below.');
  return speakers('Plug in a DJ controller and choose it as the sound output to use its headphone socket.');
}

/**
 * Headphone mix: 0 = only the cue (decks with Listen on), 1 = only what the room hears.
 * Equal power, so the middle isn't quieter. Returns { cue, master } gains.
 */
export function headphoneMix(mix = 0) {
  const x = Math.max(0, Math.min(1, mix));
  return { cue: Math.cos((x * Math.PI) / 2), master: Math.sin((x * Math.PI) / 2) };
}

/** A setup tip for the route, or null. platform: 'win32' | 'darwin' | other. */
export function setupTip(route, { platform = '', mainLabel = '' } = {}) {
  if (route.mode !== 'speakers') return null;
  if (!looksLikeController(mainLabel)) return 'Choose your controller under "Sound comes out of", then plug your headphones into the controller.';
  if (platform === 'win32') return 'On Windows: install the controller\'s driver from the maker\'s website, then in Windows Sound settings open your controller\'s playback device, choose Configure and pick Quadraphonic (4 channels). Restart Cue Coach.';
  if (platform === 'darwin') return 'On a Mac: open Audio MIDI Setup, select your controller and check it shows 4 output channels. Then restart Cue Coach.';
  return 'Your controller needs to show 4 output channels to this computer for the headphone socket to work.';
}
