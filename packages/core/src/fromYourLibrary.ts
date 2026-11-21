/**
 * Home's From your library: the owner's playlists by how much they were
 * played. A play counts for a playlist when it is a counted play whose play
 * context is that playlist, streamed songs' plays included. Playlists played
 * in the recent window (`recentWindow.ts`) come first, by their plays in it;
 * the rest fill in after them by their plays of all time. A playlist never
 * played is left out.
 */
import type { PlayEvent } from "./playEvents.ts";
import { isRecent } from "./recentWindow.ts";

/** How many playlists the section's row holds. */
export const FROM_YOUR_LIBRARY_PLAYLISTS = 10;

/** What From your library reads of a play. */
export type PlaylistPlayEvent = Pick<PlayEvent, "context" | "startedAt" | "counted">;

/** A playlist's counted plays, as From your library ranks them. */
export interface PlaylistPlays {
  /** The playlist's id. */
  readonly id: number;
  /** Its counted plays in the recent window. */
  readonly recentPlays: number;
  /** Its counted plays of all time, the recent ones among them. */
  readonly plays: number;
  /** When its latest counted play started. */
  readonly latestPlayAt: number;
}

/**
 * The playlist a play context's id names, or null: playlists are known by
 * their number, so anything else names none.
 */
export const playlistOfContextId = (id: string | null): number | null => {
  if (id === null || id.trim() === "") return null;
  const playlistId = Number(id);
  return Number.isSafeInteger(playlistId) ? playlistId : null;
};

/**
 * Each playlist's counted plays among [events], with those inside the recent
 * window that ends at [now] counted apart, in playlist id order. A play that
 * isn't counted, or whose play context isn't a playlist, adds nothing.
 */
export const playlistPlays = (
  events: Iterable<PlaylistPlayEvent>,
  now: number,
): PlaylistPlays[] => {
  const byPlaylist = new Map<number, PlaylistPlays>();
  for (const { context, startedAt, counted } of events) {
    if (!counted || context?.kind !== "playlist") continue;
    const id = playlistOfContextId(context.id);
    if (id === null) continue;
    const so = byPlaylist.get(id);
    byPlaylist.set(id, {
      id,
      recentPlays: (so?.recentPlays ?? 0) + (isRecent(startedAt, now) ? 1 : 0),
      plays: (so?.plays ?? 0) + 1,
      latestPlayAt: Math.max(so?.latestPlayAt ?? startedAt, startedAt),
    });
  }
  // oxlint-disable-next-line unicorn/no-array-sort -- sorts a fresh copy; Hermes lacks toSorted
  return [...byPlaylist.values()].sort((a, b) => a.id - b.id);
};

/**
 * The section's playlists, of the [playlists] the owner has and each one's
 * [plays] (`playlistPlays`): those played in the recent window first, the
 * most played in it on top, then the rest by their plays of all time. Equal
 * plays fall back to plays of all time, the latest play, the name and the
 * id, so the order never depends on how either list arrived. Playlists never
 * played are left out, and plays of a playlist the owner no longer has show
 * nothing. Empty when no playlist was played, and then Home leaves the
 * section out.
 */
export const fromYourLibrary = <P extends { readonly id: number; readonly sort: string }>(
  playlists: readonly P[],
  plays: readonly PlaylistPlays[],
): P[] => {
  const playsOf = new Map(plays.map((entry) => [entry.id, entry]));
  return (
    playlists
      .flatMap((playlist) => {
        const entry = playsOf.get(playlist.id);
        return entry === undefined || entry.plays <= 0 ? [] : [{ playlist, entry }];
      })
      // oxlint-disable-next-line unicorn/no-array-sort -- sorts a fresh copy; Hermes lacks toSorted
      .sort(
        (a, b) =>
          b.entry.recentPlays - a.entry.recentPlays ||
          b.entry.plays - a.entry.plays ||
          b.entry.latestPlayAt - a.entry.latestPlayAt ||
          (a.playlist.sort < b.playlist.sort ? -1 : a.playlist.sort > b.playlist.sort ? 1 : 0) ||
          a.playlist.id - b.playlist.id,
      )
      .slice(0, FROM_YOUR_LIBRARY_PLAYLISTS)
      .map(({ playlist }) => playlist)
  );
};
