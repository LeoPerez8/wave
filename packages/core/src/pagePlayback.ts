import type { MixedSong } from "./ytDiscover.ts";
import type { YtSong } from "./ytMusic.ts";

/**
 * What a page's Play, Shuffle and taps play (Search's song results, an artist's
 * or an album's page): the Library's tracks alone, or the mixed list (the
 * Library's files, the rest streamed).
 */
export type PagePlayback<S extends YtSong, L> =
  | { readonly kind: "library"; readonly tracks: readonly L[] }
  | { readonly kind: "mixed"; readonly songs: readonly MixedSong<S, L>[] };

/**
 * One rule for every page: a page with YouTube Music's songs among its own is an
 * integrated view, and plays [songs] as they stand, in page order; any other
 * plays the Library's songs alone, so nothing streams outside an integrated view.
 */
export const pagePlayback = <S extends YtSong, L>(
  songs: readonly MixedSong<S, L>[],
): PagePlayback<S, L> =>
  songs.some((song) => song.source === "stream")
    ? { kind: "mixed", songs }
    : {
        kind: "library",
        tracks: songs.flatMap((song) => (song.source === "library" ? [song.track] : [])),
      };
