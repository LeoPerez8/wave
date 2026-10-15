/**
 * More from this artist (Android Auto's player screen): which of the current
 * track's artist's songs come first. The queue engine's `moreFromArtist`
 * command then adds the next `MORE_FROM_ARTIST` of them that aren't queued.
 */
import { compareAlbumTracks } from "./library.ts";
import { rankPlays, type PlayTotals } from "./stats.ts";

/** One of the artist's songs, with what orders it on its album. */
export interface ArtistRankingSong {
  readonly id: number;
  readonly albumId: number;
  readonly discNumber: number | null;
  readonly trackNumber: number | null;
  readonly titleSort: string;
  /** The file; null for a missing song. */
  readonly path: string | null;
}

export interface ArtistRankingInput {
  /** The artist page's albums, in page order: their albums, then Appears on. */
  readonly albumIds: readonly number[];
  /** The artist page's songs, in any order. */
  readonly songs: readonly ArtistRankingSong[];
  /** All-time counted plays per song (the store's `trackPlayTotals`); other songs' are ignored. */
  readonly plays: readonly PlayTotals[];
}

/**
 * The artist's songs as queue track ids: the played ones first, the most
 * played first (Stats' rule, `rankPlays`), then the unplayed ones album by
 * album in page order, each album by disc and track.
 */
export const artistRanking = (input: ArtistRankingInput): string[] => {
  const songIds = new Set(input.songs.map((song) => song.id));
  const ranked = rankPlays(
    input.plays.filter((totals) => songIds.has(totals.id)),
    Number.POSITIVE_INFINITY,
  ).map((totals) => totals.id);
  const playedIds = new Set(ranked);
  const albumOrder = new Map(input.albumIds.map((id, index) => [id, index]));
  const pageIndex = (song: ArtistRankingSong): number =>
    albumOrder.get(song.albumId) ?? Number.MAX_SAFE_INTEGER;
  const unplayed = input.songs
    .filter((song) => !playedIds.has(song.id))
    // oxlint-disable-next-line unicorn/no-array-sort -- sorts a fresh array; Hermes lacks toSorted
    .sort(
      (a, b) => pageIndex(a) - pageIndex(b) || a.albumId - b.albumId || compareAlbumTracks(a, b),
    );
  return [...ranked, ...unplayed.map((song) => song.id)].map(String);
};
