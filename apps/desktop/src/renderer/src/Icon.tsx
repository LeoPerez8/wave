const paths: Record<string, string> = {
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
  forward: "m9 5 7 7-7 7",
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
