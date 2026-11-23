// The set's energy shape (build, peak, breather, cool-down), drawn as a small chart. DOM-free.
import { targetEnergy, PLAYED_SHARE } from './setbuilder.js';
import { energyOf } from './energy.js';

/** Plain-word labels for the shape of a set, from each track's energy in order (nulls are skipped over). */
export function shapeLabels(energies) {
  const idx = energies.map((e, i) => (e == null ? null : i)).filter((i) => i != null);
  const out = energies.map(() => null);
  if (idx.length < 3) return out;
  const vals = idx.map((i) => energies[i]);
  const max = Math.max(...vals);
  // peak: the highest stretch
  idx.forEach((i, k) => { if (vals[k] >= max - 0.5) out[i] = 'Peak'; });
  // builds: rising over 2+ tracks before a track
  for (let k = 2; k < idx.length; k++) if (!out[idx[k]] && vals[k] > vals[k - 1] && vals[k - 1] > vals[k - 2]) out[idx[k]] = 'Build';
  // drops of 2 or more: a breather, or the cool-down if nothing climbs back after it
  for (let k = 1; k < idx.length; k++) {
    if (vals[k] <= vals[k - 1] - 2 && !out[idx[k]]) {
      const after = vals.slice(k + 1);
      out[idx[k]] = after.some((v) => v >= vals[k] + 2) ? 'Breather' : after.every((v) => v <= vals[k]) ? 'Cool-down' : 'Drop';
    }
  }
  // the final fall
  const last = idx.length - 1;
  if (!out[idx[last]] && vals[last] < vals[last - 1] && vals[last] < max - 1) out[idx[last]] = 'Cool-down';
  return out;
}

/**
 * Points for the set chart: one per track, placed by played minutes, with the vibe's target and a warning
 * when a track is more than 2 off the target. items: [{ track, played?, next? }].
 */
export function setArc(items, vibe = null) {
  const mins = items.map((i) => (i.track.duration > 0 ? i.track.duration / 60 : 5) * PLAYED_SHARE);
  const total = mins.reduce((a, b) => a + b, 0) || 1;
  let t = 0;
  const energies = items.map((i) => energyOf(i.track));
  const labels = shapeLabels(energies);
  return items.map((i, k) => {
    const x0 = t / total; t += mins[k];
    const mid = (x0 + t / total) / 2, e = energies[k];
    const target = vibe ? targetEnergy(vibe, mid) : null;
    const off = e != null && target != null && Math.abs(e - target) > 2;
    return { id: i.track.id, x: mid, x0, x1: t / total, energy: e, estimated: i.track.energy == null && e != null, target, label: labels[k], played: !!i.played, next: !!i.next,
      warn: off ? `${e > target ? 'Higher' : 'Lower'} than the plan for this point: try a track around energy ${Math.round(target)}` : null };
  });
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** The set's energy as a small SVG chart: the vibe's target as a soft line, one dot per track joined up. */
export function energyChartSVG(points, { width = 300, height = 86, vibe = null } = {}) {
  if (!points.length) return '';
  const padX = 8, top = 16, bottom = 14, h = height - top - bottom;
  const X = (x) => padX + x * (width - padX * 2), Y = (e) => top + h - ((e - 1) / 9) * h;
  const known = points.filter((p) => p.energy != null);
  const target = vibe ? Array.from({ length: 31 }, (_, i) => `${X(i / 30).toFixed(1)},${Y(targetEnergy(vibe, i / 30)).toFixed(1)}`).join(' ') : '';
  const line = known.map((p) => `${X(p.x).toFixed(1)},${Y(p.energy).toFixed(1)}`).join(' ');
  const dots = points.map((p) => {
    const e = p.energy ?? (p.target ?? 5), cx = X(p.x), cy = Y(e);
    const cls = ['ec-dot', p.energy == null && 'unknown', p.played && 'played', p.next && 'next', p.warn && 'warn'].filter(Boolean).join(' ');
    const tip = p.energy == null ? 'Energy not analysed yet' : `Energy ${p.energy}${p.estimated ? ' (estimated)' : ''}${p.warn ? `. ${p.warn}` : ''}`;
    return `<g class="${cls}" data-eid="${esc(p.id)}"><title>${esc(tip)}</title><circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${p.next ? 5.5 : 4.5}"/>${p.warn ? `<text x="${cx.toFixed(1)}" y="${(cy - 8).toFixed(1)}" text-anchor="middle" class="ec-warn">!</text>` : ''}</g>`;
  }).join('');
  // one label per run of the same word, at the run's first point
  const labels = points.map((p, i) => (p.label && p.label !== points[i - 1]?.label ? `<text x="${X(p.x).toFixed(1)}" y="${height - 2}" text-anchor="middle" class="ec-label">${esc(p.label)}</text>` : '')).join('');
  return `<svg viewBox="0 0 ${width} ${height}" class="echart" role="img" aria-label="Set energy: ${esc(known.map((p) => p.energy).join(', ') || 'not analysed yet')}">
    <text x="${padX}" y="10" class="ec-axis">Energy</text>
    ${target ? `<polyline points="${target}" class="ec-target"/>` : ''}
    ${known.length > 1 ? `<polyline points="${line}" class="ec-line"/>` : ''}${dots}${labels}</svg>`;
}
