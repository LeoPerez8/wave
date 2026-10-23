import { compareStrings, sortKey } from "./library.ts";
import type { SongSortKey } from "./songSort.ts";
import type { MixedSong } from "./ytDiscover.ts";
import { libraryMatches, type LibrarySongKey, type YtSong } from "./ytMusic.ts";

/** A displayed artist song with its rank, shared by the rows and playback. */
export type RankedArtistSong<S extends YtSong, L> = MixedSong<S, L> & {
  readonly popularRank: number | undefined;
};

const byRank = (
  a: { readonly popularRank: number | undefined },
  b: { readonly popularRank: number | undefined },
): number =>
  (a.popularRank ?? Number.MAX_SAFE_INTEGER) - (b.popularRank ?? Number.MAX_SAFE_INTEGER);

/**
 * The artist's displayed songs and ranks. With Popular and the online list
 * showing, files and streams share YouTube Music's order and consecutive
 * ranks; unranked songs follow in song name order. Library Popular orders
 * the Library's songs by their place in the saved list, gaps kept where it
 * holds songs that aren't shown, the rest after them in [songs]' order.
 * Other sorts keep [songs]' order with no ranks. A null list means no
 * ranking is saved yet.
 * Returns fresh rows so a ranking arriving cannot change an existing queue.
 */
export const artistSongOrder = <S extends YtSong, L extends LibrarySongKey>(
  songs: readonly MixedSong<S, L>[],
  popular: readonly YtSong[] | null,
  context: { readonly sort: SongSortKey; readonly online: boolean },
): RankedArtistSong<S, L>[] => {
  if (context.sort !== "popular" || popular === null)
    return songs.map((row) => ({ ...row, popularRank: undefined }));
  const matches = libraryMatches(
    songs.flatMap((row) => (row.source === "library" ? [row.track] : [])),
  );
  const tracks = new Map<L, number>();
  const videos = new Map<string, number>();
  popular.forEach((song, index) => {
    if (!videos.has(song.videoId)) videos.set(song.videoId, index + 1);
    for (const track of matches(song)) if (!tracks.has(track)) tracks.set(track, index + 1);
  });
  const seenVideos = new Set<string>();
  const ranked = songs
    .filter((row) => {
      if (!context.online || row.source === "library") return true;
      if (seenVideos.has(row.song.videoId)) return false;
      seenVideos.add(row.song.videoId);
      return true;
    })
    .map((row) => ({
      ...row,
      popularRank: row.source === "library" ? tracks.get(row.track) : videos.get(row.song.videoId),
    }));
  // With Library selected only the Library's songs are ranked.
  if (!context.online)
    return (
      ranked
        .map((row) => (row.source === "library" ? row : { ...row, popularRank: undefined }))
        // oxlint-disable-next-line unicorn/no-array-sort -- sorts a fresh array; Hermes lacks toSorted
        .sort(byRank)
    );
  // oxlint-disable-next-line unicorn/no-array-sort -- sorts a fresh array; Hermes lacks toSorted
  ranked.sort(
    (a, b) =>
      byRank(a, b) ||
      compareStrings(
        sortKey(a.source === "library" ? a.track.title : a.song.title),
        sortKey(b.source === "library" ? b.track.title : b.song.title),
      ),
  );
  return ranked.map((row, index) => ({
    ...row,
    popularRank: row.popularRank === undefined ? undefined : index + 1,
  }));
};
