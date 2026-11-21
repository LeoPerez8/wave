/**
 * How the Playlists list shows its playlists (Library › Playlists and the
 * Playlists tab alike), picked from a long press on its title: rows, a grid of
 * two columns, or one large cover per playlist.
 */

import { en } from "./catalogueEn.ts";

/** A way to show playlists. */
export type PlaylistLayout = "list" | "grid" | "large";

/** The layouts in the order the card offers them, each with its entry's label. */
export const PLAYLIST_LAYOUTS: readonly {
  readonly layout: PlaylistLayout;
  readonly label: string;
}[] = [
  { layout: "list", label: en.playlists.layouts.list },
  { layout: "grid", label: en.playlists.layouts.grid },
  { layout: "large", label: en.playlists.layouts.large },
];

/** Where the layout is kept, on the phone and the computer alike (each its own; it doesn't sync). */
export const PLAYLIST_LAYOUT_SETTING = "settings.playlistLayout";

/** The layout of an install that never picked one: today's rows. */
const DEFAULT_PLAYLIST_LAYOUT: PlaylistLayout = "list";

/** The layout a stored value names: nothing stored, or anything unknown, is the list. */
export const parsePlaylistLayout = (stored: string | null): PlaylistLayout =>
  PLAYLIST_LAYOUTS.find(({ layout }) => layout === stored)?.layout ?? DEFAULT_PLAYLIST_LAYOUT;

/** What to store for [layout]: null (nothing) for the default. */
export const storedPlaylistLayout = (layout: PlaylistLayout): string | null =>
  layout === DEFAULT_PLAYLIST_LAYOUT ? null : layout;

/** The layouts the computer's Playlists page switches between: its table, or a grid of covers. */
export const DESKTOP_PLAYLIST_LAYOUTS: readonly PlaylistLayout[] = ["list", "grid"];

/** The computer's layout a stored value names: Large Cards, which it has no room for, is the grid. */
export const desktopPlaylistLayout = (stored: string | null): PlaylistLayout => {
  const layout = parsePlaylistLayout(stored);
  return layout === "large" ? "grid" : layout;
};
