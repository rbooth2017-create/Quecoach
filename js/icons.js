// Line icons for the Learn app (24×24, drawn for Cue Coach). Use: icon('play', 18).
const P = {
  play: '<path d="M8 5.2v13.6L19 12z" fill="currentColor" stroke="none"/>',
  pause: '<rect x="6.5" y="5" width="4" height="14" rx="1.2" fill="currentColor" stroke="none"/><rect x="13.5" y="5" width="4" height="14" rx="1.2" fill="currentColor" stroke="none"/>',
  restart: '<path d="M6 5v14"/><path d="M18 6l-9 6 9 6z"/>',
  headphones: '<path d="M4 15v-3a8 8 0 0 1 16 0v3"/><rect x="3" y="14" width="5" height="7" rx="2"/><rect x="16" y="14" width="5" height="7" rx="2"/>',
  palette: '<path d="M12 3a9 9 0 1 0 0 18c1.1 0 1.7-.8 1.7-1.6 0-.5-.2-.9-.5-1.2-.3-.3-.5-.7-.5-1.2 0-.9.7-1.6 1.6-1.6H16a5 5 0 0 0 5-5c0-4.1-4-7.4-9-7.4z"/><circle cx="7.5" cy="11.5" r="1.1" fill="currentColor"/><circle cx="10" cy="7.5" r="1.1" fill="currentColor"/><circle cx="14.6" cy="7.6" r="1.1" fill="currentColor"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.6 9.4a2.5 2.5 0 0 1 4.8.9c0 1.7-2.4 2.1-2.4 3.7"/><circle cx="12" cy="17.2" r=".7" fill="currentColor"/>',
  folder: '<path d="M3 7.5A2.5 2.5 0 0 1 5.5 5h3.6l2 2h7.4A2.5 2.5 0 0 1 21 9.5v7a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 16.5z"/>',
  disc: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2.6"/><path d="M12 5.5a6.5 6.5 0 0 1 6.5 6.5" opacity=".55"/>',
  music: '<path d="M9 18V6.5l10-2.2V16"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/>',
  sparkle: '<path d="M12 3.5l1.7 5 5 1.7-5 1.7-1.7 5-1.7-5-5-1.7 5-1.7z"/><path d="M18.5 15.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  chevron: '<path d="M7 10l5 5 5-5"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  level: '<path d="M3 9.5l9-4.5 9 4.5-9 4.5z"/><path d="M7 11.5v4c0 1.2 2.2 2.6 5 2.6s5-1.4 5-2.6v-4"/>',
  keyboard: '<rect x="2.5" y="6" width="19" height="12" rx="2.5"/><path d="M6.5 10h1M10.5 10h1M14.5 10h1M8 14h8"/>',
  eject: '<path d="M12 5l7 8H5z"/><path d="M5 18h14"/>',
  upload: '<path d="M12 16V5M7.5 9.5L12 5l4.5 4.5"/><path d="M5 19h14"/>',
  book: '<path d="M5 4.5A1.5 1.5 0 0 1 6.5 3H19v15H6.5A1.5 1.5 0 0 0 5 19.5z"/><path d="M5 19.5A1.5 1.5 0 0 0 6.5 21H19v-3"/><path d="M9 7.5h6M9 11h4"/>',
  list: '<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1.2" fill="currentColor"/><circle cx="4.5" cy="12" r="1.2" fill="currentColor"/><circle cx="4.5" cy="18" r="1.2" fill="currentColor"/>',
  wand: '<path d="M4 20L15 9"/><path d="M14 4v3M12.5 5.5h3M19 9v2M18 10h2M18 3.5l.6 1.4 1.4.6-1.4.6-.6 1.4-.6-1.4-1.4-.6 1.4-.6z"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2.5"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  circle: '<circle cx="12" cy="12" r="8"/>',
  dot: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3.5" fill="currentColor"/>',
  key: '<circle cx="8" cy="15" r="4.5"/><path d="M11.2 11.8L20 3M16.5 6.5l2.5 2.5M14 9l2 2"/>',
};
export function icon(name, size = 18, extra = '') {
  return `<svg class="ic" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}>${P[name] || ''}</svg>`;
}
