/**
 * How the queue asks for the playing song's search when it's unsearched
 * (docs/spec.md, YT Music, "Unavailable entries"). The queue only waits for
 * the answer; `playingSearches.ts`, which searches the queue's songs as
 * they're about to play, answers it (`setPlayingSearcher`), so the queue
 * needn't import the Library store or YT Music, which the app runtime that
 * builds the queue imports.
 */
import type { UnsearchedSettlement, YtAlbumSong } from "@wave/core";

/**
 * Searches the unsearched song [trackId] stands for with the playing
 * priority, or joins the search for it already going on, and settles it in
 * the playlists; null when the search was given up.
 */
export type PlayingSearcher = (
  trackId: string,
) => Promise<UnsearchedSettlement<YtAlbumSong> | null>;

let searcher: PlayingSearcher | null = null;

/** Who answers the queue's searches: `playingSearches.ts`, once services start. */
export const setPlayingSearcher = (next: PlayingSearcher): void => {
  searcher = next;
};

/** The playing song's search; failed when no searcher is set yet. Never rejects. */
export const searchPlaying: PlayingSearcher = (trackId) =>
  searcher === null
    ? Promise.resolve({ kind: "failed", reason: "failed" })
    : searcher(trackId).catch(() => ({ kind: "failed", reason: "failed" }) as const);
