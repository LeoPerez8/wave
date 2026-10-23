/** The recommendation tracks the Library store's read and the shared paged source both build. */
import {
  showsExplicitBadge,
  type PlaylistRecommendationTrack,
  type StoredPlaylistSong,
} from "@wave/core";
import type { SongRow } from "./LibraryStore.ts";

/** What a Library song's track carries beyond its row: read per song by each source. */
export interface LibrarySongFacts {
  readonly favorite: boolean;
  readonly downloaded: boolean;
  readonly videoId: string;
  readonly genres: readonly string[] | undefined;
}

/** A Library song as a recommendation track, its artists named through [names]. */
export const libraryRecommendationTrack = (
  song: SongRow,
  names: ReadonlyMap<number, string>,
  { favorite, downloaded, videoId, genres }: LibrarySongFacts,
): PlaylistRecommendationTrack => ({
  favorite,
  downloaded,
  id: String(song.id),
  source: "library",
  videoId,
  title: song.title,
  artists: song.artistIds.flatMap((id) => names.get(id) ?? []),
  album: song.album,
  albumId: null,
  durationMs: song.durationMs,
  artworkUrl: song.thumbPath === null ? null : `file://${song.thumbPath}`,
  explicit: showsExplicitBadge(song.explicit),
  genre: song.genre,
  ...(genres === undefined ? {} : { genres }),
  available: song.path !== null,
});

/** Playlist entry [itemId]'s stored song as a recommendation track; only a streamed one plays. */
export const storedRecommendationTrack = (
  entry: StoredPlaylistSong,
  itemId: number,
): PlaylistRecommendationTrack => ({
  ...entry.song,
  albumId: "albumId" in entry.song ? entry.song.albumId : null,
  explicit: "explicit" in entry.song ? entry.song.explicit : false,
  videoId: entry.source === "stream" ? entry.song.videoId : "",
  id: entry.source === "stream" ? `yt:${entry.song.videoId}` : `entry:${itemId}`,
  source: "stream",
  available: entry.source === "stream",
});
