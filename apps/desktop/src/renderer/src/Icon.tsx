const paths: Record<string, string> = {
  missing: "M6 6l12 12M6 18 18 6",
  home: "m3 10 9-7 9 7v11h-6v-7H9v7H3Z",
  search: "M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0",
  songs: "M9 18V5l12-2v13M9 8l12-2M9 18c0 4-7 4-7 0s7-4 7 0M21 16c0 4-7 4-7 0s7-4 7 0",
  albums: "M3 3h18v18H3ZM15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0",
  artists: "M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0M4 22v-3a8 8 0 0 1 16 0v3",
  playlists: "M3 5h14M3 10h14M3 15h8M16 14l6 4-6 4Z",
  genres: "m12 2 9 5v10l-9 5-9-5V7ZM3 7l9 5 9-5M12 12v10",
  favorites: "m12 2 3 6 7 1-5 5 1 8-6-4-6 4 1-8-5-5 7-1Z",
  settings:
    "M12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8M10 2h4l1 3 3 1 3-1 2 4-2 3 1 3-2 4-3-1-3 2-1 3h-4l-1-3-3-1-3 1-2-4 2-3-1-3 2-4 3 1 3-2Z",
  back: "m15 5-7 7 7 7",
  /** Tabler's horizontal sliders, as the phone's Discover header has. */
  adjustments:
    "M12 6a2 2 0 1 0 4 0 2 2 0 1 0-4 0M4 6h8m4 0h4M6 12a2 2 0 1 0 4 0 2 2 0 1 0-4 0M4 12h2m4 0h10M15 18a2 2 0 1 0 4 0 2 2 0 1 0-4 0M4 18h11m4 0h1",
  forward: "m9 5 7 7-7 7",
  pause: "M8 4v16M16 4v16",
  mute: "M3 9h4l5-5v16l-5-5H3ZM16 9l6 6m0-6-6 6",
  play: "m8 4 13 8-13 8Z",
  previous: "M4 4v16M20 4 7 12l13 8Z",
  next: "M20 4v16M4 4l13 8-13 8Z",
  shuffle: "M3 5h3c6 0 6 14 12 14h3m-4-4 4 4-4 4M3 19h3c6 0 6-14 12-14h3m-4-4 4 4-4 4",
  repeat: "m17 2 4 4-4 4M3 10V6h18M7 22l-4-4 4-4m14 0v4H3",
  lyrics: "M3 3h18v15H8l-5 4ZM7 8h10M7 12h8",
  queue: "M3 5h18M3 10h18M3 15h10M17 14l5 4-5 4Z",
  volume: "M3 9h4l5-5v16l-5-5H3ZM16 8a7 7 0 0 1 0 8m3-12a12 12 0 0 1 0 16",
  sleep: "M20 15a9 9 0 0 1-11-11 9 9 0 1 0 11 11",
  menu: "M5 11v2m7-2v2m7-2v2",
  folder: "M3 7V4h6l3 3h9v14H3Z",
  add: "M12 4v16M4 12h16",
  download: "M12 3v12m-5-5 5 5 5-5M4 21h16",
  discover: "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0M16 8l-2 6-6 2 2-6Z",
  magicQueue:
    "M3 6h10M3 11h10M3 16h7M18 3l1 3 3 1-3 1-1 3-1-3-3-1 3-1ZM17 14l.8 2.2 2.2.8-2.2.8L17 20l-.8-2.2-2.2-.8 2.2-.8Z",
  playlist: "M3 4h12M3 9h12M3 14h6M15 20V9l6-1M15 20c0 2.7-4 2.7-4 0s4-2.7 4 0",
  /** A collaborative playlist: two people. */
  collaborative:
    "M12 8a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0M2 20v-1a6.5 6.5 0 0 1 13 0v1M15.5 4.6a3.5 3.5 0 0 1 0 6.8M18 13.5a6.5 6.5 0 0 1 4 6v.5",
  close: "M6 6l12 12M6 18 18 6",
  minus: "M4 12h16",
  grip: "M4 9h16M4 15h16",
  stats: "M4 20h16M6 16v-4m6 4V5m6 11V9",
  /** Tabler's language glyph, as the phone's Translate button has. */
  translate: "M4 5h7M9 3v2c0 4.4-2.2 8-5 8M5 9c0 2.1 3 3.9 6.7 4M12 20l4-9 4 9M19.1 18h-6.2",
  /** Tabler's microphone 2, as the phone's Karaoke button has. */
  karaoke: "M15 12.9a5 5 0 1 0-3.9-3.9M15 12.9l-3.9-3.9-7.5 8.6a2 2 0 1 0 2.8 2.8Z",
  history: "M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l4 2",
  /** A small window over a large one. */
  miniPlayer: "M3 4h18v16H3ZM12 12h6v5h-6Z",
  /** Out to the corners: back to the main window. */
  showMain: "M14 4h6v6M20 4l-7 7M10 20H4v-6M4 20l7-7",
  up: "m5 15 7-7 7 7",
  down: "m5 9 7 7 7-7",
  /** Search's Recognize button, as the phone's. */
  microphone:
    "M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3M5 11a7 7 0 0 0 14 0M12 18v3M8 21h8",
  /** Tabler's share 3, as the phone's Share Lyrics button has. */
  share: "M13 4v4C6.4 9 4 14.8 3 20c0 .2 5.4-6 10-6v4l8-7Z",
  /** Four squares: the Playlists page's grid of covers. */
  grid: "M4 4h7v7H4ZM13 4h7v7h-7ZM4 13h7v7H4ZM13 13h7v7h-7Z",
};
export function Icon({ name, size = 20 }: { readonly name: string; readonly size?: number }) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={paths[name] ?? paths.songs} />
    </svg>
  );
}
