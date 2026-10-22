import { and, eq } from "drizzle-orm";
import { selectPendingFavorites } from "./pendingFavorites.ts";
/** The editable playlist's recommendation inputs, read through the Library store. */
import {
  showsExplicitBadge,
  playlistRecordingMatch,
  type PlaylistRecommendationTrack,
  type PlaylistRecommendationSlot,
} from "@wave/core";
import type { SongRow } from "../LibraryStore.ts";
import type { LibraryDatabase } from "./database.ts";
import { selectCandidateCatalog } from "./candidateCatalog.ts";
import { addToPlaylist, selectPlaylist, selectPlaylistEntries } from "./playlists.ts";
import { selectSongGenres, trackQuery } from "./tracks.ts";
import * as schema from "./schema.ts";

/** Current membership and Library recordings; shared with Add's transactional validation. */
const selectPlaylistRecommendationTracks = (db: LibraryDatabase, playlistId: number) => {
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
  const videos = new Map(
    db
      .select({ id: schema.tracks.id, videoId: schema.tracks.videoId })
      .from(schema.tracks)
      .all()
      .filter((row) => row.videoId !== null)
      .map((row) => [row.id, row.videoId!]),
  );
  const local = (song: SongRow): PlaylistRecommendationTrack => ({
    favorite: favorites.has(song.id),
    downloaded: videos.has(song.id) && song.path !== null,
    id: String(song.id),
    source: "library",
    videoId: videos.get(song.id) ?? "",
    title: song.title,
    artists: song.artistIds.flatMap((id) => names.get(id) ?? []),
    album: song.album,
    albumId: null,
    durationMs: song.durationMs,
    artworkUrl: song.thumbPath === null ? null : `file://${song.thumbPath}`,
    explicit: showsExplicitBadge(song.explicit),
    genre: song.genre,
    ...(genres.has(song.id) ? { genres: genres.get(song.id)! } : {}),
    available: song.path !== null,
  });
  const librarySongs = trackQuery(db).all();
  const library = librarySongs.map(local);
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
  return { playlist, library, librarySongs };
};

export const selectPlaylistRecommendationInput = (db: LibraryDatabase, playlistId: number) => {
  const tracks = selectPlaylistRecommendationTracks(db, playlistId);
  const favoriteVideos = new Set(selectPendingFavorites(db).map((song) => song.videoId));
  const feedback = db
    .select({
      track: schema.playlistRecommendationFeedback.track,
      value: schema.playlistRecommendationFeedback.value,
    })
    .from(schema.playlistRecommendationFeedback)
    .where(eq(schema.playlistRecommendationFeedback.playlistId, playlistId))
    .all();
  return {
    ...tracks,
    catalog: selectCandidateCatalog(db),
    favoriteVideos,
    feedback,
  };
};
export type PlaylistRecommendationInput = ReturnType<typeof selectPlaylistRecommendationInput>;

/** A key belongs to one visible offer; retries cannot count its signal twice. */
export const dismissPlaylistRecommendation = (
  db: LibraryDatabase,
  playlistId: number,
  offer: PlaylistRecommendationSlot,
  now: number,
): boolean => {
  if (selectPlaylist(db, playlistId) === null) throw new Error("The playlist no longer exists");
  return (
    db
      .insert(schema.playlistRecommendationFeedback)
      .values({ playlistId, offerKey: offer.key, track: offer.track, value: -1, createdAt: now })
      .onConflictDoNothing()
      .returning({ key: schema.playlistRecommendationFeedback.offerKey })
      .all().length === 1
  );
};

/** Membership and its positive signal commit together; a failed write rolls both back. */
export const acceptPlaylistRecommendation = (
  db: LibraryDatabase,
  playlistId: number,
  offer: PlaylistRecommendationSlot,
  now: number,
): boolean =>
  db.transaction((tx) => {
    const input = selectPlaylistRecommendationTracks(tx, playlistId);
    const feedback = schema.playlistRecommendationFeedback;
    if (
      tx
        .select({ key: feedback.offerKey })
        .from(feedback)
        .where(and(eq(feedback.playlistId, playlistId), eq(feedback.offerKey, offer.key)))
        .get() !== undefined
    )
      return false;
    const available = input.library.filter((track) => track.available !== false);
    // A download may have completed since the offer appeared; prefer its Library recording.
    const local =
      offer.track.source === "library"
        ? available.find((track) => track.id === offer.track.id)
        : playlistRecordingMatch(available)(offer.track);
    if (offer.track.source === "library" && local == null)
      throw new Error("This song is no longer available");
    const track = local ?? offer.track;
    if (
      playlistRecordingMatch(input.playlist)(track) !== null ||
      input.playlist.some((song) => song.id === track.id)
    )
      return false;
    const result = addToPlaylist(
      tx,
      playlistId,
      [
        track.source === "library"
          ? { source: "library", trackId: Number(track.id) }
          : { source: "stream", song: track },
      ],
      now,
    );
    if (result.added !== 1) return false;
    tx.insert(feedback)
      .values({ playlistId, offerKey: offer.key, track, value: 1, createdAt: now })
      .run();
    return true;
  });
