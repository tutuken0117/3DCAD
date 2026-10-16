/** ツールバー用の簡単な SVG アイコン（24x24, stroke=currentColor） */
const wrap = (body: string) =>
  `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

export const ICONS: Record<string, string> = {
  select: wrap('<path d="M5 3l13 8-6 1.5L9 19z" fill="currentColor" fill-opacity=".15"/>'),
  line: wrap('<path d="M4 20L20 4"/><circle cx="4" cy="20" r="1.6" fill="currentColor"/><circle cx="20" cy="4" r="1.6" fill="currentColor"/>'),
  rect: wrap('<rect x="4" y="6" width="16" height="12" fill="currentColor" fill-opacity=".12"/>'),
  circle: wrap('<circle cx="12" cy="12" r="8" fill="currentColor" fill-opacity=".12"/><circle cx="12" cy="12" r="1" fill="currentColor"/>'),
  pushpull: wrap('<path d="M4 15l8 4 8-4-8-4z" fill="currentColor" fill-opacity=".12"/><path d="M12 13V3M9 6l3-3 3 3"/>'),
  move: wrap('<path d="M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3"/>'),
  rotate: wrap('<path d="M20 12a8 8 0 1 1-3-6.2"/><path d="M20 4v5h-5"/>'),
  tape: wrap('<rect x="3" y="8" width="12" height="10" rx="2"/><circle cx="9" cy="13" r="2"/><path d="M15 15h6M18 13v4"/>'),
  eraser: wrap('<path d="M16 3l5 5-10 10H6l-3-3z" fill="currentColor" fill-opacity=".12"/><path d="M11 21h10"/>'),
  paint: wrap('<path d="M5 13l7-7 6 6-7 7z" fill="currentColor" fill-opacity=".15"/><path d="M18 14c1.5 2 2 3 2 4a2 2 0 0 1-4 0c0-1 .5-2 2-4z"/>'),
  coord: wrap('<circle cx="12" cy="10" r="3"/><path d="M12 21s-7-6.5-7-11a7 7 0 0 1 14 0c0 4.5-7 11-7 11z"/>'),
  expand: wrap('<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>'),
  furniture: wrap('<path d="M5 11V7a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v4"/><path d="M3 11h18v5H3z"/><path d="M5 16v3M19 16v3"/>'),
  walk: wrap('<circle cx="12" cy="4.5" r="2"/><path d="M10 21l1.5-6-2-2 1-5 3 2 2 3"/><path d="M11.5 8l-3 2-1 3"/><path d="M13 15l2 6"/>'),
  orbit: wrap('<ellipse cx="12" cy="12" rx="9" ry="4"/><path d="M12 3a4 9 0 0 1 0 18"/><path d="M19 9l2 3-3 1"/>'),
  pan: wrap('<path d="M8 13V6a1.5 1.5 0 0 1 3 0v6M11 11V4.5a1.5 1.5 0 0 1 3 0V11M14 11V6a1.5 1.5 0 0 1 3 0v8a6 6 0 0 1-6 6h-1a6 6 0 0 1-5-3l-2.5-4a1.5 1.5 0 0 1 2.5-1.5L8 13"/>'),
  underlay: wrap('<path d="M3 7l9-4 9 4-9 4z"/><path d="M3 12l9 4 9-4M3 17l9 4 9-4"/>'),
  profile: wrap('<path d="M3 17l6 3 12-5-6-3z" fill="currentColor" fill-opacity=".12"/><path d="M9 20V11l6-4 6 3v5M9 11l-6-2v8M15 7l-6-2-6 4"/>'),
  sheet: wrap('<rect x="4" y="3" width="13" height="17" rx="1"/><path d="M7 7h7M7 10h7M7 13h4M17 8l3 1v12l-11-1"/>'),
  install: wrap('<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8"/><path d="M12 7v6M9 10.5l3 3 3-3"/>'),
  present: wrap('<rect x="3" y="4" width="18" height="12" rx="1"/><path d="M12 16v4M8 20h8"/><path d="M7 13l3-3 2 2 4-4"/>'),
  undo: wrap('<path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>'),
  redo: wrap('<path d="M15 14l5-5-5-5"/><path d="M20 9H10a6 6 0 0 0 0 12h3"/>'),
  ar: wrap('<path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3"/><path d="M12 7l4 2.5v5L12 17l-4-2.5v-5z"/>'),
  fit: wrap('<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>'),
  zoom: wrap('<circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5M8 11h6M11 8v6"/>'),
};
