/**
 * Keeping a mixed list's rows in place while a download finishes. A mixed
 * list (Search's songs, an artist's page with what YouTube Music has) shows
 * the Library's songs, then the YT Music songs the Library lacks. Left to
 * that rule, a finished download would take its song out of the streamed
 * part and into the Library's, somewhere else in the list. Instead, a song
 * the list showed streamed during this visit to its screen keeps its row for
 * the rest of the visit, playing the Library's file once the Library has it,
 * and the Library's part leaves that file out so it shows once. Opening the
 * screen again starts a new visit, which lays the list out by its rule.
 */

import type { DiscoverSong } from "./ytDiscover.ts";
import type { YtSong } from "./ytMusic.ts";

/** The YT Music songs a list has shown streamed during this visit, by video id. */
export type HeldSongs<S extends YtSong = YtSong> = ReadonlyMap<string, S>;

/** A visit's start: the list holds nothing yet. */
export const NO_HELD_SONGS: HeldSongs<never> = new Map<string, never>();

/**
 * [inLibrary] as a list holding [held] sees it: a held song stays among the
 * streamed ones, so it isn't taken out as one the Library has.
 */
export const inLibraryUnlessHeld =
  <S extends YtSong>(held: HeldSongs<S>, inLibrary: (song: S) => boolean) =>
  (song: S): boolean =>
    !held.has(song.videoId) && inLibrary(song);

export interface SongsInPlace<S extends YtSong, L, K> {
  /** The streamed part's rows in their places, each the Library's file once it has the song. */
  readonly songs: readonly DiscoverSong<S, L>[];
  /** The Library's tracks those rows play: the list's Library part leaves them out. */
  readonly tracks: ReadonlySet<K>;
  /**
   * Each of [streamed]'s row in [songs], by video id: a song shown once as
   * an earlier row's Library file plays from that row.
   */
  readonly rowOf: ReadonlyMap<string, number>;
  /**
   * What the list holds from now on: [held] with every song shown here. It's
   * [held] itself when nothing new showed, so a caller can keep it as state.
   */
  readonly held: HeldSongs<S>;
}

/**
 * The streamed part of a mixed list, its rows kept in place: [streamed] are
 * the YT Music songs it shows, in their order (those the Library lacks, and
 * the ones it holds, `inLibraryUnlessHeld`), each the Library's file when
 * [find] has it. Two rows the Library has as one file show it once, in the
 * first's place. [keyOf] tells the Library's tracks apart.
 */
export const songsInPlace = <S extends YtSong, L, K>(
  held: HeldSongs<S>,
  streamed: readonly S[],
  find: (song: S) => L | null,
  keyOf: (track: L) => K,
): SongsInPlace<S, L, K> => {
  const songs: DiscoverSong<S, L>[] = [];
  const rowByTrack = new Map<K, number>();
  const rowOf = new Map<string, number>();
  let next: Map<string, S> | null = null;
  for (const song of streamed) {
    if (!held.has(song.videoId)) {
      next ??= new Map(held);
      next.set(song.videoId, song);
    }
    const track = find(song);
    if (track === null) {
      rowOf.set(song.videoId, songs.length);
      songs.push({ source: "stream", song });
      continue;
    }
    const key = keyOf(track);
    const row = rowByTrack.get(key);
    if (row !== undefined) {
      rowOf.set(song.videoId, row);
      continue;
    }
    rowByTrack.set(key, songs.length);
    rowOf.set(song.videoId, songs.length);
    songs.push({ source: "library", song, track });
  }
  return { songs, tracks: new Set(rowByTrack.keys()), rowOf, held: next ?? held };
};

/**
 * The Library's files of the songs [held] that [find] has now: what the
 * list's Library part leaves out, known before its streamed part is laid out
 * (a list that asks YT Music only when the Library has nothing for it can
 * tell its own downloads apart from what the Library had).
 */
export const heldTracks = <S extends YtSong, L, K>(
  held: HeldSongs<S>,
  find: (song: S) => L | null,
  keyOf: (track: L) => K,
): ReadonlySet<K> => {
  const tracks = new Set<K>();
  for (const song of held.values()) {
    const track = find(song);
    if (track !== null) tracks.add(keyOf(track));
  }
  return tracks;
};
