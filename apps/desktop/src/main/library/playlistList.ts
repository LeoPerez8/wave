/**
 * The Playlists list's order and layout on this computer (Core's `playlistSort.ts` and
 * `playlistLayout.ts`), kept as the phone keeps its own: on the device, under the same keys, not
 * synced. The page, the sidebar and every read of the list (selection, menus) follow the order.
 */
import type { LibraryDatabase } from "@wave/client/db/database";
import { selectPlaylistsLastPlayed } from "@wave/client/db/playlists";
import {
  PLAYLIST_LAYOUT_SETTING,
  PLAYLIST_ORDER_SETTING,
  choosePlaylistSort,
  desktopPlaylistLayout,
  movePlaylist,
  parsePlaylistOrder,
  sortKey,
  sortPlaylists,
  storedPlaylistLayout,
  storedPlaylistOrder,
  type PlaylistLayout,
  type PlaylistOrder,
  type PlaylistSort,
  type SortablePlaylist,
} from "@wave/core";
import { sql } from "drizzle-orm";
import type { PlaylistListView } from "../../shared/playlists.ts";
import { preference, savePreference } from "../preferences.ts";

const NEVER_PLAYED: ReadonlyMap<number, number> = new Map();

const readOrder = (db: LibraryDatabase): PlaylistOrder =>
  parsePlaylistOrder(preference(db, PLAYLIST_ORDER_SETTING) ?? null);

// The default stores nothing on the phone; here an empty value reads back as it.
const keepOrder = (db: LibraryDatabase, order: PlaylistOrder): void =>
  savePreference(db, PLAYLIST_ORDER_SETTING, storedPlaylistOrder(order) ?? "");

const livePlaylists = (db: LibraryDatabase): SortablePlaylist[] =>
  db
    .all<{
      id: number;
      name: string;
      createdAt: number;
    }>(sql`SELECT id, name, created_at AS createdAt FROM playlists WHERE deleted=0`)
    .map(({ id, name, createdAt }) => ({ id, sort: sortKey(name), createdAt }));

/** What orders the list now: the kept order, and Recently Played's plays when it's the sort. */
const ordering = (db: LibraryDatabase) => {
  const order = readOrder(db);
  const lastPlayed = order.sort === "played" ? selectPlaylistsLastPlayed(db) : NEVER_PLAYED;
  return { ...order, lastPlayed };
};

/** Every playlist's id, in the order the Playlists list shows them. */
export const sortedPlaylistIds = (db: LibraryDatabase): number[] =>
  sortPlaylists(livePlaylists(db), ordering(db)).map((playlist) => playlist.id);

/** The list's sort. */
export const playlistListSort = (db: LibraryDatabase): PlaylistSort => readOrder(db).sort;

/** The list's sort, layout and order, for the page's controls and Move Up and Move Down. */
export const playlistListView = (db: LibraryDatabase): PlaylistListView => ({
  sort: playlistListSort(db),
  layout: desktopPlaylistLayout(preference(db, PLAYLIST_LAYOUT_SETTING) || null),
  ids: sortedPlaylistIds(db),
});

/** Sorts the list by [sort]; Custom brings back the order arranged before (Core's `choosePlaylistSort`). */
export const sortPlaylistList = (db: LibraryDatabase, sort: PlaylistSort): void =>
  keepOrder(db, choosePlaylistSort(ordering(db), sort, livePlaylists(db)));

/** Shows the list as [layout]. */
export const showPlaylistListAs = (db: LibraryDatabase, layout: PlaylistLayout): void =>
  savePreference(db, PLAYLIST_LAYOUT_SETTING, storedPlaylistLayout(layout) ?? "");

/**
 * Moves the playlist [playlistId] to place [to] (from 0) of the list as it shows, in Custom only.
 * False when it moves nothing: another sort, a playlist not listed, its own place, or off an end.
 */
export const movePlaylistInList = (
  db: LibraryDatabase,
  playlistId: number,
  to: number,
): boolean => {
  if (readOrder(db).sort !== "custom") return false;
  const shown = sortedPlaylistIds(db);
  const moved = movePlaylist(shown, shown.indexOf(playlistId), to);
  if (moved === null) return false;
  keepOrder(db, moved);
  return true;
};
