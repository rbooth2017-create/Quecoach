// Set history: what the room heard, in order, for a tracklist after the gig. DOM-free.
// A session is one run of the app. A track counts once it has played to the room for MIN_SECONDS.

export const MIN_SECONDS = 30;
export const KEEP_SESSIONS = 30;

export function newSession(at = Date.now()) { return { id: `s${at}`, start: at, tracks: [] }; }

/** Add a track the room heard (skips it if it's the one already at the end). */
export function logPlay(session, t, at = Date.now()) {
  if (!t) return session;
  const last = session.tracks.at(-1);
  if (last && last.id === t.id) return session;
  const entry = { id: t.id, title: t.title || 'Unknown track', artist: t.artist || '', bpm: t.bpm ? Math.round(t.bpm * 10) / 10 : null, key: t.camelot || '', at };
  return { ...session, tracks: [...session.tracks, entry] };
}

/** Keep the newest sessions that have tracks, with this one first. */
export function saveSessions(all = [], session) {
  const rest = all.filter((s) => s.id !== session.id && s.tracks?.length);
  return (session.tracks.length ? [session, ...rest] : rest).slice(0, KEEP_SESSIONS);
}

const two = (n) => String(n).padStart(2, '0');
/** "0:00 / 4:12 / 1:03:20" from the session start. */
export function since(start, at) {
  const s = Math.max(0, Math.round((at - start) / 1000)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h ? `${h}:${two(m)}:${two(s % 60)}` : `${m}:${two(s % 60)}`;
}
const dateText = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}`; };

/** A plain tracklist, ready to paste under a mix: "00:00 Artist - Title". */
export function toText(session) {
  const lines = session.tracks.map((t, i) => `${String(i + 1).padStart(2, ' ')}. ${since(session.start, t.at).padStart(7, ' ')}  ${t.artist ? `${t.artist} - ` : ''}${t.title}`);
  return [`Cue Coach set · ${dateText(session.start)}`, '', ...lines, ''].join('\n');
}
const csvCell = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
export function toCSV(session) {
  const rows = [['#', 'Time', 'Artist', 'Title', 'BPM', 'Key'], ...session.tracks.map((t, i) => [i + 1, since(session.start, t.at), t.artist, t.title, t.bpm ?? '', t.key])];
  return `${rows.map((r) => r.map(csvCell).join(',')).join('\r\n')}\r\n`;
}
export function fileBase(session) { return `cue-coach-set-${dateText(session.start).replace(/[: ]/g, '-')}`; }
