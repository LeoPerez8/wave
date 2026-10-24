import { and, eq, or, sql, type SQL } from "drizzle-orm";
import { matchingSongWhere } from "./matchingSong.ts";
import { selectPendingFavorites } from "./pendingFavorites.ts";
/** The editable playlist's recommendation inputs, read through the Library store. */
import {
  playlistRecordingMatch,
  type PlaylistRecommendationTrack,
  type PlaylistRecommendationSlot,
} from "@wave/core";
import type { SongRow } from "../LibraryStore.ts";
import {
  libraryRecommendationTrack,
  storedRecommendationTrack,
} from "../playlistRecommendationTracks.ts";
import type { LibraryDatabase } from "./database.ts";
import { addToPlaylist, selectPlaylist, selectPlaylistEntries } from "./playlists.ts";
import { selectSongGenres, songGenresOf, trackQuery } from "./tracks.ts";
import * as schema from "./schema.ts";

/** Current membership and Library recordings; shared with Add's transactional validation. */
const selectPlaylistRecommendationTracks = (
  db: LibraryDatabase,
  playlistId: number,
  offer?: PlaylistRecommendationSlot,
) => {
  if (
    offer === undefined
      ? selectPlaylist(db, playlistId) === null
      : db.get(sql`SELECT 1 FROM playlists WHERE id = ${playlistId} AND NOT deleted`) === undefined
  )
    throw new Error("The playlist no longer exists");
  const entries = selectPlaylistEntries(db, playlistId);
  const candidates =
    offer === undefined
      ? undefined
      : db
          .select({ id: schema.tracks.id })
          .from(schema.tracks)
          .where(
            offer.track.source === "library"
              ? eq(schema.tracks.id, Number(offer.track.id))
              : or(
                  offer.track.videoId === ""
                    ? undefined
                    : eq(schema.tracks.videoId, offer.track.videoId),
                  matchingSongWhere(offer.track),
                ),
          )
          .all()
          .map((row) => row.id);
  const librarySongs = trackQuery(db)
    .where(
      candidates === undefined
        ? undefined
        : sql`${schema.tracks.id} IN (SELECT value FROM json_each(${JSON.stringify(candidates)}))`,
    )
    .all();
  const projected =
    candidates === undefined
      ? undefined
      : [
          ...candidates,
          ...entries.flatMap((entry) => (entry.source === "library" ? [entry.track.id] : [])),
        ];
  const scoped = (column: SQL | typeof schema.tracks.id | typeof schema.favorites.trackId) =>
    projected === undefined
      ? undefined
      : sql`${column} IN (SELECT value FROM json_each(${JSON.stringify(projected)}))`;
  const artistIds =
    candidates === undefined
      ? undefined
      : [
          ...librarySongs.flatMap((song) => song.artistIds),
          ...entries.flatMap((entry) => (entry.source === "library" ? entry.track.artistIds : [])),
        ];
  const names = new Map(
    db
      .select({ id: schema.artists.id, name: schema.artists.name })
      .from(schema.artists)
      .where(
        artistIds === undefined
          ? undefined
          : sql`${schema.artists.id} IN (SELECT value FROM json_each(${JSON.stringify(artistIds)}))`,
      )
      .all()
      .map((a) => [a.id, a.name]),
  );
  const tagged =
    projected === undefined
      ? selectSongGenres(db)
      : db
          .select({ id: schema.tracks.id, genres: schema.tracks.genres })
          .from(schema.tracks)
          .where(scoped(schema.tracks.id))
          .all()
          .flatMap(songGenresOf);
  const genres = new Map(tagged.map((track) => [track.id, track.genres]));
  const favorites = new Set(
    db
      .select({ id: schema.favorites.trackId })
      .from(schema.favorites)
      .where(and(eq(schema.favorites.deleted, false), scoped(schema.favorites.trackId)))
      .all()
      .map((row) => row.id),
  );
  const videos = new Map(
    db
      .select({ id: schema.tracks.id, videoId: schema.tracks.videoId })
      .from(schema.tracks)
      .where(scoped(schema.tracks.id))
      .all()
      .filter((row) => row.videoId !== null)
      .map((row) => [row.id, row.videoId!]),
  );
  const local = (song: SongRow): PlaylistRecommendationTrack =>
    libraryRecommendationTrack(song, names, {
      favorite: favorites.has(song.id),
      downloaded: videos.has(song.id) && song.path !== null,
      videoId: videos.get(song.id) ?? "",
      genres: genres.get(song.id),
    });
  const library = librarySongs.map(local);
  const added = new Map(
    db
      .select({ id: schema.playlistItems.id, addedAt: schema.playlistItems.addedAt })
      .from(schema.playlistItems)
      .where(eq(schema.playlistItems.playlistId, playlistId))
      .all()
      .map((row) => [row.id, row.addedAt]),
  );
  const playlist = entries.map((entry): PlaylistRecommendationTrack => ({
    ...(entry.source === "library"
      ? local(entry.track)
      : storedRecommendationTrack(entry, entry.itemId)),
    ...(added.has(entry.itemId) ? { addedAt: added.get(entry.itemId)! } : {}),
  }));
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
  // One indexed row: `selectPlaylist` would also read every entry and the mosaic covers.
  if (db.get(sql`SELECT 1 FROM playlists WHERE id = ${playlistId} AND NOT deleted`) === undefined)
    throw new Error("The playlist no longer exists");
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
    const input = selectPlaylistRecommendationTracks(tx, playlistId, offer);
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
