// Your layout: every section can be collapsed to its header, moved up or down within its area, or hidden.
// A section is any element with data-panel="id" (and data-group="area" when it can be reordered).
// Its header holds a button with data-fold="id" that collapses it. The choices are saved and reapplied
// every time a pane is drawn again.

/** The sections, by area, in their default order. `fixed` sections can be hidden but not moved. */
export const PANELS = [
  { id: 'coach', group: 'top', name: 'Coach strip', note: 'The step-by-step tips along the top', fixed: true, noFold: true },
  { id: 'lane', group: 'stage', name: 'Beat lane', note: 'Both decks\' beats, side by side' },
  { id: 'mixplan', group: 'stage', name: 'When to mix', note: 'Countdown, timeline and mix steps' },
  { id: 'decks', group: 'stage', name: 'Decks and mixer' },
  { id: 'library', group: 'stage', name: 'Library' },
  { id: 'lesson', group: 'lessons', name: 'Current lesson' },
  { id: 'course', group: 'lessons', name: 'All lessons' },
  { id: 'setopts', group: 'set', name: 'Set options', note: 'Which music, event, crowd, length and vibe' },
  { id: 'setlist', group: 'set', name: 'Set list' },
];
export const GROUPS = [
  { id: 'stage', name: 'Main area' },
  { id: 'lessons', name: 'Lessons pane' },
  { id: 'set', name: 'Set pane' },
  { id: 'top', name: 'Top' },
];

export const emptyLayout = () => ({ folded: {}, hidden: {}, order: {} });

/** A saved layout, cleaned up: unknown ids dropped, every group's order complete. */
export function normalize(raw) {
  const out = emptyLayout(), known = new Set(PANELS.map((p) => p.id));
  for (const k of ['folded', 'hidden']) for (const [id, on] of Object.entries(raw?.[k] || {})) if (known.has(id) && on) out[k][id] = true;
  for (const g of GROUPS) out.order[g.id] = groupOrder(raw, g.id);
  return out;
}

/** The ids in a group, in the saved order, with any new sections in their default place. */
export function groupOrder(layout, group) {
  const defaults = PANELS.filter((p) => p.group === group).map((p) => p.id);
  const saved = (layout?.order?.[group] || []).filter((id) => defaults.includes(id));
  defaults.forEach((id, i) => {
    if (saved.includes(id)) return;
    // after the section that comes before it by default, so it lands near its usual neighbour
    const prev = defaults.slice(0, i).reverse().find((x) => saved.includes(x));
    saved.splice(prev ? saved.indexOf(prev) + 1 : 0, 0, id);
  });
  return saved;
}

/** Move a section one place up (-1) or down (+1) in its group. Returns a new layout. */
export function move(layout, id, dir) {
  const p = PANELS.find((x) => x.id === id); if (!p || p.fixed) return layout;
  const order = groupOrder(layout, p.group), i = order.indexOf(id), j = i + dir;
  if (j < 0 || j >= order.length) return layout;
  [order[i], order[j]] = [order[j], order[i]];
  return { ...layout, order: { ...layout.order, [p.group]: order } };
}

/** Move a section to sit just before another one in the same group (drag and drop). */
export function moveBefore(layout, id, beforeId) {
  const p = PANELS.find((x) => x.id === id), q = PANELS.find((x) => x.id === beforeId);
  if (!p || p.fixed || id === beforeId || (q && q.group !== p.group)) return layout;
  const order = groupOrder(layout, p.group).filter((x) => x !== id);
  const at = q ? order.indexOf(beforeId) : order.length;
  order.splice(at, 0, id);
  return { ...layout, order: { ...layout.order, [p.group]: order } };
}

export function setFlag(layout, kind, id, on) {
  const next = { ...layout[kind] };
  if (on) next[id] = true; else delete next[id];
  return { ...layout, [kind]: next };
}

/** Make the page match the layout: collapsed, hidden and order on every section under root. */
export function applyLayout(layout, root = document) {
  for (const el of root.querySelectorAll('[data-panel]')) {
    const id = el.dataset.panel, p = PANELS.find((x) => x.id === id); if (!p) continue;
    const folded = !!layout.folded[id];
    el.classList.toggle('folded', folded);
    el.classList.toggle('lay-hidden', !!layout.hidden[id]);
    if (!p.fixed) el.style.order = String(groupOrder(layout, p.group).indexOf(id));
    for (const b of el.querySelectorAll(`[data-fold="${id}"]`)) {
      b.setAttribute('aria-expanded', String(!folded));
      b.title = `${folded ? 'Show' : 'Collapse'} ${p.name.toLowerCase()}`;
    }
  }
}

/** The header button that collapses a section. */
export const foldButton = (id, label, chevron) =>
  `<button type="button" class="fold-btn" data-fold="${id}" aria-expanded="true">${chevron}<span>${label}</span></button>`;
