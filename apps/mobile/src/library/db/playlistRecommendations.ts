import { eq } from "drizzle-orm";
import { selectPendingFavorites } from "./pendingFavorites.ts";
/** The editable playlist's recommendation inputs, read through the Library store. */
import { showsExplicitBadge, type PlaylistRecommendationTrack } from "@wave/core";
import type { SongRow } from "../LibraryStore.ts";
import type { LibraryDatabase } from "./database.ts";
import { selectCandidateCatalog } from "./candidateCatalog.ts";
import { selectPlaylist, selectPlaylistEntries } from "./playlists.ts";
import { selectSongGenres, trackQuery } from "./tracks.ts";
import * as schema from "./schema.ts";

export const selectPlaylistRecommendationInput = (db: LibraryDatabase, playlistId: number) => {
  if (selectPlaylist(db, playlistId) === null) throw new Error("The playlist no longer exists");
  const names = new Map(
    db
      .select({ id: schema.artists.id, name: schema.artists.name })
      .from(schema.artists)
      .all()
      .map((a) => [a.id, a.name]),
  );
  const genres = new Map(selectSongGenres(db).map((track) => [track.id, track.genres]));
  const favorites = new Set(
    db
      .select({ id: schema.favorites.trackId })
      .from(schema.favorites)
      .where(eq(schema.favorites.deleted, false))
      .all()
      .map((row) => row.id),
  );
  const downloads = new Set(
    db
      .select({ id: schema.tracks.id, videoId: schema.tracks.videoId })
      .from(schema.tracks)
      .all()
      .filter((row) => row.videoId !== null)
      .map((row) => row.id),
  );
  const favoriteVideos = new Set(selectPendingFavorites(db).map((song) => song.videoId));
  const local = (song: SongRow): PlaylistRecommendationTrack => ({
    favorite: favorites.has(song.id),
    downloaded: downloads.has(song.id) && song.path !== null,
    id: String(song.id),
    source: "library",
    videoId: "",
    title: song.title,
    artists: song.artistIds.flatMap((id) => names.get(id) ?? []),
    album: song.album,
    albumId: null,
    durationMs: song.durationMs,
    artworkUrl: song.thumbPath === null ? null : `file://${song.thumbPath}`,
    explicit: showsExplicitBadge(song.explicit),
    genre: song.genre,
    genres: genres.get(song.id),
    available: song.path !== null,
  });
  const library = trackQuery(db).all().map(local);
  const playlist = selectPlaylistEntries(db, playlistId).map(
    (entry): PlaylistRecommendationTrack =>
      entry.source === "library"
        ? local(entry.track)
        : {
            ...entry.song,
            albumId: "albumId" in entry.song ? entry.song.albumId : null,
            explicit: "explicit" in entry.song ? entry.song.explicit : false,
            videoId: entry.source === "stream" ? entry.song.videoId : "",
            id: entry.source === "stream" ? `yt:${entry.song.videoId}` : `entry:${entry.itemId}`,
            source: "stream",
            available: entry.source === "stream",
          },
  );
  return { playlist, library, catalog: selectCandidateCatalog(db), favoriteVideos };
};
export type PlaylistRecommendationInput = ReturnType<typeof selectPlaylistRecommendationInput>;
