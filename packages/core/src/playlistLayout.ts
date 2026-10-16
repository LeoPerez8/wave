/**
 * How the Playlists list shows its playlists (Library › Playlists and the
 * Playlists tab alike), picked from a long press on its title: rows, a grid of
 * two columns, or one large cover per playlist.
 */

/** A way to show playlists. */
export type PlaylistLayout = "list" | "grid" | "large";

/** The layouts in the order the card offers them, each with its entry's label. */
export const PLAYLIST_LAYOUTS: readonly {
  readonly layout: PlaylistLayout;
  readonly label: string;
}[] = [
  { layout: "list", label: "List" },
  { layout: "grid", label: "Grid" },
  { layout: "large", label: "Large Cards" },
];

/** The layout of an install that never picked one: today's rows. */
const DEFAULT_PLAYLIST_LAYOUT: PlaylistLayout = "list";

/** The layout a stored value names: nothing stored, or anything unknown, is the list. */
export const parsePlaylistLayout = (stored: string | null): PlaylistLayout =>
  PLAYLIST_LAYOUTS.find(({ layout }) => layout === stored)?.layout ?? DEFAULT_PLAYLIST_LAYOUT;

/** What to store for [layout]: null (nothing) for the default. */
export const storedPlaylistLayout = (layout: PlaylistLayout): string | null =>
  layout === DEFAULT_PLAYLIST_LAYOUT ? null : layout;

/** How many playlists sit side by side in a row of [layout]. */
const PER_ROW: Record<PlaylistLayout, number> = { list: 1, grid: 2, large: 1 };

/**
 * [playlists] as [layout] lays them out, a row at a time and in order: two to
 * a row in the grid (an odd one out alone on the last), one otherwise.
 */
export const playlistLayoutRows = <P>(
  playlists: readonly P[],
  layout: PlaylistLayout,
): (readonly P[])[] => {
  const size = PER_ROW[layout];
  const rows: (readonly P[])[] = [];
  for (let i = 0; i < playlists.length; i += size) rows.push(playlists.slice(i, i + size));
  return rows;
};
