/**
 * The order of the Playlists list (Library › Playlists, the Playlists tab and
 * Android Auto's Playlists alike), picked under Sort by on the Playlists
 * title's card: by name, newest first, most recently played first, or the
 * owner's own order (Custom), arranged by dragging.
 */

import { compareStrings } from "./library.ts";
import { moveItem } from "./playlists.ts";
import { readStoredRecord } from "./storedJson.ts";

/** A way to order playlists. */
export type PlaylistSort = "name" | "added" | "played" | "custom";

/** The sorts in the order the card offers them, each with its entry's label. */
export const PLAYLIST_SORTS: readonly {
  readonly sort: PlaylistSort;
  readonly label: string;
}[] = [
  { sort: "name", label: "Name" },
  { sort: "added", label: "Recently Added" },
  { sort: "played", label: "Recently Played" },
  { sort: "custom", label: "Custom" },
];

/**
 * The list's order as the owner left it: the sort, and the order they
 * arranged by hand (Custom's), kept while another sort shows so picking
 * Custom again brings it back. Playlist ids, first to last.
 */
export interface PlaylistOrder {
  readonly sort: PlaylistSort;
  readonly order: readonly number[];
}

/** The order of an install that never picked one: by name, as the list always was. */
const DEFAULT_PLAYLIST_ORDER: PlaylistOrder = { sort: "name", order: [] };

/**
 * The order a stored value holds: nothing stored, or anything unreadable, is
 * by name; a sort this Wave doesn't know is by name, keeping the arranged order.
 */
export const parsePlaylistOrder = (stored: string | null): PlaylistOrder => {
  const record = readStoredRecord(stored);
  const sort =
    PLAYLIST_SORTS.find((choice) => choice.sort === record.sort)?.sort ??
    DEFAULT_PLAYLIST_ORDER.sort;
  const order = Array.isArray(record.order)
    ? record.order.filter((id): id is number => Number.isSafeInteger(id))
    : [];
  return { sort, order };
};

/** What to store for [order]: null (nothing) for the default. */
export const storedPlaylistOrder = ({ sort, order }: PlaylistOrder): string | null =>
  sort === DEFAULT_PLAYLIST_ORDER.sort && order.length === 0
    ? null
    : JSON.stringify({ sort, order });

/** What ordering a playlist takes. */
export interface SortablePlaylist {
  readonly id: number;
  /** Core's `sortKey` of its name. */
  readonly sort: string;
  /** When it was made, in ms since the epoch. */
  readonly createdAt: number;
}

/** What orders the list besides the playlists themselves. */
export interface PlaylistOrdering extends PlaylistOrder {
  /** When a song last played from each playlist, by playlist id (Recently Played). */
  readonly lastPlayed: ReadonlyMap<number, number>;
}

const byName = (a: SortablePlaylist, b: SortablePlaylist): number =>
  compareStrings(a.sort, b.sort) || a.id - b.id;

const newestFirst = (a: SortablePlaylist, b: SortablePlaylist): number =>
  b.createdAt - a.createdAt || byName(a, b);

/**
 * [playlists] in the owner's [order]: those it doesn't hold yet (made or
 * imported since it was arranged) on top, newest first, then the rest as
 * arranged. Ids of playlists gone since are passed over.
 */
const customOrder = <P extends SortablePlaylist>(
  playlists: readonly P[],
  order: readonly number[],
): P[] => {
  const byId = new Map(playlists.map((playlist) => [playlist.id, playlist]));
  const arranged: P[] = [];
  for (const id of order) {
    const playlist = byId.get(id);
    if (playlist === undefined) continue;
    arranged.push(playlist);
    // An id stored twice keeps its first place.
    byId.delete(id);
  }
  // oxlint-disable-next-line unicorn/no-array-sort -- sorts a fresh array; Hermes lacks toSorted
  const unarranged = [...byId.values()].sort(newestFirst);
  return [...unarranged, ...arranged];
};

/** [playlists] in the order [ordering] gives them. */
export const sortPlaylists = <P extends SortablePlaylist>(
  playlists: readonly P[],
  ordering: PlaylistOrdering,
): P[] => {
  const { sort, order, lastPlayed } = ordering;
  if (sort === "custom") return customOrder(playlists, order);
  // Never played sorts after any play.
  const playedAt = (playlist: SortablePlaylist): number =>
    lastPlayed.get(playlist.id) ?? Number.NEGATIVE_INFINITY;
  const latestPlayFirst = (a: SortablePlaylist, b: SortablePlaylist): number =>
    playedAt(b) - playedAt(a) || byName(a, b);
  const compare = sort === "added" ? newestFirst : sort === "played" ? latestPlayFirst : byName;
  // oxlint-disable-next-line unicorn/no-array-sort -- sorts a fresh array; Hermes lacks toSorted
  return [...playlists].sort(compare);
};

/**
 * The order once the owner picks [chosen] on the card, [current] being what
 * the list shows [playlists] by now. Custom brings back the order arranged
 * before; with none (or none of its playlists left) it starts from the order
 * [current] shows them in.
 */
export const choosePlaylistSort = (
  current: PlaylistOrdering,
  chosen: PlaylistSort,
  playlists: readonly SortablePlaylist[],
): PlaylistOrder => {
  if (chosen !== "custom") return { sort: chosen, order: current.order };
  const arranged = new Set(current.order);
  if (playlists.some((playlist) => arranged.has(playlist.id))) {
    return { sort: chosen, order: current.order };
  }
  return { sort: chosen, order: sortPlaylists(playlists, current).map((playlist) => playlist.id) };
};

/**
 * The order after the playlist at [from] of [shown] (the ids in the order on
 * screen) is moved to [to]: Custom, from the order on screen whatever the sort
 * was. Null when it moves nothing (its own place, or past either end).
 */
export const movePlaylist = (
  shown: readonly number[],
  from: number,
  to: number,
): PlaylistOrder | null => {
  const inList = (index: number) => index >= 0 && index < shown.length;
  if (from === to || !inList(from) || !inList(to)) return null;
  return { sort: "custom", order: moveItem(shown, from, to) };
};
