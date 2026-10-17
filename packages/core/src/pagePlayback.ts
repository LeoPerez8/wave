import type { QueueSong } from "./playlistEntries.ts";
import type { YtSong } from "./ytMusic.ts";

/**
 * What a page's Play, Shuffle and taps play (Search's song results, an artist's
 * or an album's page, a playlist): the Library's tracks alone, or the mixed
 * list (the Library's files, the rest streamed, a playlist's unsearched
 * songs searched as they're about to play).
 */
export type PagePlayback<S extends YtSong, L> =
  | { readonly kind: "library"; readonly tracks: readonly L[] }
  | { readonly kind: "mixed"; readonly songs: readonly QueueSong<S, L>[] };

/** What a list plays once its missing songs are left out, and where it starts. */
export interface PlayableSongs<T> {
  readonly songs: readonly T[];
  /** The tapped song's place among [songs]; undefined: the top, or shuffled. */
  readonly startIndex: number | undefined;
}

/**
 * What a list's Play, Shuffle or a tap plays when some of its [songs] are
 * missing songs (a Track the Wave account has and this phone has no file
 * for): only those [hasFile] says have one, in list order, from the tapped
 * one at [startIndex]. A tapped missing song plays nothing (null), as does a
 * list with no file. When [hasFile] is a type guard, what plays has its type.
 */
export function skipMissingSongs<T, P extends T>(
  songs: readonly T[],
  startIndex: number | undefined,
  hasFile: (song: T) => song is P,
): PlayableSongs<P> | null;
export function skipMissingSongs<T>(
  songs: readonly T[],
  startIndex: number | undefined,
  hasFile: (song: T) => boolean,
): PlayableSongs<T> | null;
export function skipMissingSongs<T>(
  songs: readonly T[],
  startIndex: number | undefined,
  hasFile: (song: T) => boolean,
): PlayableSongs<T> | null {
  const tapped = startIndex === undefined ? undefined : songs[startIndex];
  if (tapped !== undefined && !hasFile(tapped)) return null;
  const playable = songs.filter(hasFile);
  if (playable.length === 0) return null;
  return {
    songs: playable,
    startIndex:
      startIndex === undefined ? undefined : songs.slice(0, startIndex).filter(hasFile).length,
  };
}

/**
 * The missing song a tap on [songs] at [startIndex] downloads (docs/spec.md,
 * "Missing songs": tapping one downloads it), or null when the tapped song
 * has a file ([hasFile]) or nothing was tapped (Play, Shuffle).
 */
export const tappedMissingSong = <T>(
  songs: readonly T[],
  startIndex: number | undefined,
  hasFile: (song: T) => boolean,
): T | null => {
  const tapped = startIndex === undefined ? undefined : songs[startIndex];
  return tapped === undefined || hasFile(tapped) ? null : tapped;
};

/**
 * One rule for every page: a page with YouTube Music's songs among its own is an
 * integrated view, and plays [songs] as they stand, in page order; any other
 * plays the Library's songs alone, so nothing streams outside an integrated view.
 */
export const pagePlayback = <S extends YtSong, L>(
  songs: readonly QueueSong<S, L>[],
): PagePlayback<S, L> =>
  songs.some((song) => song.source !== "library")
    ? { kind: "mixed", songs }
    : {
        kind: "library",
        tracks: songs.flatMap((song) => (song.source === "library" ? [song.track] : [])),
      };
