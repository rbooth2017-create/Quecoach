// Expansion packs: add-ons that plug into Cue Coach without the core importing them. A pack registers itself;
// the core tells packs what happened (emit) and lets them adjust a few things (filter). With no pack switched on,
// every emit does nothing and every filter hands the value straight back. DOM-free.

const packs = [];
let started = null; // the core's context, once the app has booted
let readOn = () => ({});
let writeOn = () => {};

/** Where the on/off switches live (the core passes its storage in, so tests can use a plain object). */
export function setSwitchStore(read, write) { readOn = read; writeOn = write; }

/**
 * pack: { id, name, blurb, on: { event: fn }, filters: { name: fn(value, ctx) }, start(ctx), stop(), reset() }
 * Registering twice with the same id replaces the old one.
 */
export function registerPack(pack) {
  if (!pack?.id) throw new Error('A pack needs an id');
  const i = packs.findIndex((p) => p.id === pack.id);
  if (i >= 0) packs.splice(i, 1, pack); else packs.push(pack);
  if (started && isOn(pack.id)) pack.start?.(started);
}

export const listPacks = () => packs.map((p) => ({ id: p.id, name: p.name, blurb: p.blurb || '', on: isOn(p.id) }));
export const isOn = (id) => !!readOn()[id];
const active = () => packs.filter((p) => isOn(p.id));

/** Switch a pack on or off. Its own save is left alone either way. */
export function setOn(id, on) {
  const p = packs.find((x) => x.id === id); if (!p) return;
  const was = isOn(id);
  writeOn({ ...readOn(), [id]: !!on });
  if (!started || was === !!on) return;
  if (on) p.start?.(started); else p.stop?.();
}

/** The core has booted: start every pack that's switched on. */
export function startPacks(ctx) {
  started = ctx;
  for (const p of active()) p.start?.(ctx);
}

/** Forget a pack's progress (it's switched off and on again so it starts fresh). */
export function resetPack(id) {
  const p = packs.find((x) => x.id === id); if (!p) return;
  const on = isOn(id);
  if (on && started) p.stop?.();
  p.reset?.();
  if (on && started) p.start?.(started);
}

/** The core says "this happened". A pack that throws never breaks the app. */
export function emit(event, data) {
  for (const p of active()) {
    const fn = p.on?.[event]; if (!fn) continue;
    try { fn(data); } catch (err) { console.error(`[pack ${p.id}] ${event}`, err); }
  }
}

/** The core asks "anything to change about this?". undefined from a pack means "no change". */
export function filter(name, value, ctx) {
  let v = value;
  for (const p of active()) {
    const fn = p.filters?.[name]; if (!fn) continue;
    try { const out = fn(v, ctx); if (out !== undefined) v = out; } catch (err) { console.error(`[pack ${p.id}] ${name}`, err); }
  }
  return v;
}

/** For tests: forget every pack. */
export function _clearPacks() { packs.length = 0; started = null; }
