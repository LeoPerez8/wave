/**
 * Play history and the Home tab's sections, as queries over the library
 * database. Kept free of Expo so the store tests run them against a real
 * SQLite in plain Node (`testDatabase.ts`); `LibraryStore` calls them.
 */
import {
  rankMostPlayed,
  recentlyPlayedAlbums,
  parseTrackId,
  recordingKey,
  ytSongArtist,
  type MixedSong,
  type YtAlbumSong,
  type PlayEvent,
} from "@wave/core";
import { and, desc, eq, gt, inArray, isNotNull, isNull, max, sql } from "drizzle-orm";

import type { AlbumRow, SongRow } from "../LibraryStore.ts";
import type { LibraryDatabase } from "./database.ts";
import * as schema from "./schema.ts";
import { playRecordingKey, stamped } from "./sync.ts";
import { selectAlbums } from "./albums.ts";
import { streamedTrack } from "./stats.ts";
import { streamedSongsOf } from "./streamedSongs.ts";
import { BY_TITLE, inScope, songColumns, trackQuery, type TrackScope } from "./tracks.ts";

/**
 * A Most Played song with its number of counted plays: a Library song (its
 * streamed plays included), or a streamed song the Library hasn't.
 */
export type MostPlayedRow = MixedSong<YtAlbumSong, SongRow> & { readonly playCount: number };

/** A starred song, with when it was starred (Favorites can be sorted by it). */
export interface FavoriteRow extends SongRow {
  readonly starredAt: number;
}

export interface HomeSections {
  /** Albums by when their newest song entered the library, newest first. */
  readonly recentlyAdded: readonly AlbumRow[];
  /** Albums of the tracks played, the most recently played first. */
  readonly recentlyPlayed: readonly AlbumRow[];
  /** Songs by counted plays (Core's rule), then by their latest counted play, then latest added. */
  readonly mostPlayed: readonly MostPlayedRow[];
  /** Starred songs, the most recently starred first. */
  readonly favorites: readonly SongRow[];
}

/** How many albums each Home shelf shows. */
const SHELF = 12;
/** How many songs each Home list shows. */
const LIST = 10;
/** Recently Played reads this many songs per album it shows, then this many times more until settled. */
const PAGE_GROWTH = 4;

/** What can change about a play while it goes on. */
const progress = (play: PlayEvent) => ({
  listenedMs: Math.round(play.listenedMs),
  durationMs: play.durationMs === null ? null : Math.round(play.durationMs),
  endReason: play.endReason,
  counted: play.counted,
});

/**
 * Records a play as it starts, with its song's recording key, as the play
 * going on now (`ongoing`: the one before, if it never ended, is over, unless
 * it's [overlapping], still fading out in a crossfade and ended on its own);
 * returns its row id, to update it as it goes on.
 */
export const recordPlay = (
  db: LibraryDatabase,
  play: PlayEvent,
  overlapping = false,
  streamedSong?: YtAlbumSong,
): number =>
  db.transaction((tx) => {
    const { playEvents } = schema;
    if (!overlapping)
      tx.update(playEvents).set({ ongoing: false }).where(eq(playEvents.ongoing, true)).run();
    const ref = parseTrackId(play.trackId);
    const videoId = ref?.kind === "yt" ? ref.videoId : null;
    if (videoId !== null && streamedSong?.videoId !== videoId)
      throw new Error("Streamed play needs its queued song");
    const song =
      videoId === null
        ? trackQuery(tx)
            .where(eq(schema.tracks.id, Number(play.trackId)))
            .get()
        : undefined;
    return tx
      .insert(playEvents)
      .values({
        trackId: videoId === null ? Number(play.trackId) : null,
        videoId,
        streamedSong: videoId === null ? null : streamedSong,
        recordingKey:
          videoId === null
            ? playRecordingKey(Number(play.trackId))
            : recordingKey({
                title: streamedSong!.title,
                album: streamedSong!.album,
                albumArtist: streamedSong!.artists[0] ?? "",
                discNumber: null,
                trackNumber: null,
              }),
        startedAt: play.startedAt,
        snapshot:
          videoId !== null
            ? {
                title: streamedSong!.title,
                artist: ytSongArtist(streamedSong!),
                album: streamedSong!.album,
                artworkPath: null,
                thumbPath: null,
                artworkUrl: streamedSong!.artworkUrl,
              }
            : {
                title: song?.title ?? "Unknown song",
                artist: song?.artist ?? "",
                album: song?.album ?? null,
                artworkPath: song?.artworkPath ?? null,
                thumbPath: song?.thumbPath ?? null,
              },
        contextType: play.context?.kind ?? null,
        contextId: play.context?.id ?? null,
        source: play.source,
        ongoing: true,
        ...progress(play),
      })
      .returning({ id: playEvents.id })
      .get().id;
  });

/** Brings a recorded play up to date: listened time, length, how it ended (so far), counted. */
export const updatePlay = (db: LibraryDatabase, id: number, play: PlayEvent): void => {
  db.update(schema.playEvents).set(progress(play)).where(eq(schema.playEvents.id, id)).run();
};

/** Records how a play ended: it no longer changes, so it can go to the Wave account. */
export const endPlay = (db: LibraryDatabase, id: number, play: PlayEvent): void => {
  db.update(schema.playEvents)
    .set({ ...progress(play), ongoing: false })
    .where(eq(schema.playEvents.id, id))
    .run();
};

/** A recorded play with its row id. */
export interface RecordedPlay {
  readonly id: number;
  readonly play: PlayEvent;
}

/**
 * The play going on, as it was last brought up to date; `PlayHistory` picks
 * it back up when JS restarts while the player kept going.
 */
export const latestPlay = (db: LibraryDatabase): RecordedPlay | null => {
  const row = db
    .select()
    .from(schema.playEvents)
    // Imported plays (BlackPlayer's) and plays from the Wave account never went on in this player.
    .where(and(isNull(schema.playEvents.importedFrom), eq(schema.playEvents.ongoing, true)))
    .orderBy(desc(schema.playEvents.id))
    .limit(1)
    .get();
  if (row === undefined) return null;
  return {
    id: row.id,
    play: {
      trackId: row.videoId === null ? String(row.trackId) : `yt:${row.videoId}`,
      context:
        row.contextType === null ? null : { kind: row.contextType, id: row.contextId ?? null },
      startedAt: row.startedAt,
      listenedMs: row.listenedMs,
      durationMs: row.durationMs,
      endReason: row.endReason,
      counted: row.counted,
      source: row.source,
    },
  };
};

/** Albums by id with Tracks in [scope], with their track count and length, in the order of `ids`. */
const albumsInOrder = (
  db: LibraryDatabase,
  ids: readonly number[],
  scope: TrackScope,
): AlbumRow[] => {
  if (ids.length === 0) return [];
  const rows = selectAlbums(db, inArray(schema.albums.id, [...ids]), undefined, scope);
  const byId = new Map(rows.map((row) => [row.id, row]));
  return ids.flatMap((id) => byId.get(id) ?? []);
};

const recentlyAddedAlbums = (db: LibraryDatabase, scope: TrackScope): AlbumRow[] => {
  const { tracks } = schema;
  const ids = db
    .select({ id: tracks.albumId })
    .from(tracks)
    .groupBy(tracks.albumId)
    .orderBy(desc(max(tracks.addedAt)), desc(tracks.albumId))
    .limit(SHELF)
    .all()
    .map((row) => row.id);
  return albumsInOrder(db, ids, scope);
};

/**
 * Albums of the songs played, the latest played first (Core's
 * `recentlyPlayedAlbums`): played songs read by their latest play through
 * `play_totals`, a page at a time, until the page settles the shelf.
 */
const recentlyPlayedShelf = (db: LibraryDatabase, scope: TrackScope): AlbumRow[] => {
  const { playTotals, tracks } = schema;
  for (let page = SHELF * PAGE_GROWTH; ; page *= PAGE_GROWTH) {
    const songs = db
      .select({ albumId: tracks.albumId, lastPlayedAt: playTotals.lastPlayedAt })
      .from(playTotals)
      .innerJoin(tracks, eq(playTotals.trackId, tracks.id))
      .orderBy(desc(playTotals.lastPlayedAt))
      .limit(page)
      .all();
    const ids = recentlyPlayedAlbums(songs, SHELF, songs.length < page);
    if (ids !== null) return albumsInOrder(db, ids, scope);
  }
};

/**
 * Songs by counted plays, then by their latest counted play (Core's
 * `rankMostPlayed`): the top of `play_totals`, read in that order until the
 * list is full, with every streamed song's kept totals (`streamed_totals`),
 * which count for the Library song they are now (`streamedTrack`). With
 * [scope] "files", only songs with a file: no streamed song of its own.
 */
const mostPlayedSongs = (db: LibraryDatabase, scope: TrackScope): MostPlayedRow[] => {
  const { playTotals, tracks, artists, albums, artwork } = schema;
  const top = db
    .select({
      ...songColumns,
      countedPlays: playTotals.countedPlays,
      lastCountedAt: playTotals.lastCountedAt,
    })
    .from(playTotals)
    .innerJoin(tracks, inScope(eq(playTotals.trackId, tracks.id), scope))
    .innerJoin(artists, eq(tracks.artistId, artists.id))
    .innerJoin(albums, eq(tracks.albumId, albums.id))
    .leftJoin(artwork, eq(tracks.artworkHash, artwork.hash))
    .where(gt(playTotals.countedPlays, 0))
    .orderBy(
      desc(playTotals.countedPlays),
      desc(playTotals.lastCountedAt),
      desc(playTotals.trackId),
    )
    .limit(LIST)
    .all();
  const streamed = db.all<{
    videoId: string;
    trackId: number | null;
    countedPlays: number;
    lastCountedAt: number | null;
  }>(sql`SELECT video_id AS "videoId",
      ${streamedTrack(sql`streamed_totals.video_id`, sql`nullif(streamed_totals.recording_key, '')`)} AS "trackId",
      counted_plays AS "countedPlays", last_counted_at AS "lastCountedAt"
    FROM streamed_totals WHERE counted_plays > 0`);
  const listed = new Set(top.map((song) => song.id));
  const counted = [
    ...new Set(streamed.flatMap(({ trackId }) => (trackId === null ? [] : [trackId]))),
  ];
  // The songs streamed plays count for, in [scope], with their files' own plays.
  const credited =
    counted.length === 0
      ? []
      : db
          .select({
            id: tracks.id,
            countedPlays: sql<number>`coalesce(${playTotals.countedPlays}, 0)`,
            lastCountedAt: playTotals.lastCountedAt,
          })
          .from(tracks)
          .leftJoin(playTotals, eq(playTotals.trackId, tracks.id))
          .where(
            and(
              inArray(tracks.id, counted),
              scope === "files" ? isNotNull(tracks.path) : undefined,
            ),
          )
          .all();
  const inScopeIds = new Set([...listed, ...credited.map((song) => song.id)]);
  const ranked = rankMostPlayed(
    [...top, ...credited.filter((song) => !listed.has(song.id))],
    streamed.filter(({ trackId }) =>
      trackId === null ? scope === "library" : inScopeIds.has(trackId),
    ),
    LIST,
  );
  const rows = new Map<number, SongRow>(
    top.map(({ countedPlays: _plays, lastCountedAt: _at, ...row }) => [row.id, row]),
  );
  // Only songs streamed plays lifted into the list are read here.
  const lifted = ranked.flatMap(({ song }) =>
    song.kind === "library" && !rows.has(song.id) ? [song.id] : [],
  );
  if (lifted.length > 0)
    for (const row of trackQuery(db, scope).where(inArray(tracks.id, lifted)).all())
      rows.set(row.id, row);
  const songs = streamedSongsOf(
    db,
    ranked.flatMap(({ song }) => (song.kind === "yt" ? [song.videoId] : [])),
  );
  return ranked.flatMap(({ song, countedPlays }): MostPlayedRow[] => {
    if (song.kind === "library") {
      const track = rows.get(song.id);
      return track === undefined ? [] : [{ source: "library", track, playCount: countedPlays }];
    }
    const streamedSong = songs.get(song.videoId);
    return streamedSong === undefined
      ? []
      : [{ source: "stream", song: streamedSong, playCount: countedPlays }];
  });
};

const recentFavorites = (db: LibraryDatabase, scope: TrackScope): SongRow[] => {
  const { favorites, tracks, artists, albums, artwork } = schema;
  return db
    .select(songColumns)
    .from(favorites)
    .innerJoin(tracks, inScope(eq(favorites.trackId, tracks.id), scope))
    .innerJoin(artists, eq(tracks.artistId, artists.id))
    .innerJoin(albums, eq(tracks.albumId, albums.id))
    .leftJoin(artwork, eq(tracks.artworkHash, artwork.hash))
    .where(eq(favorites.deleted, false))
    .orderBy(desc(favorites.addedAt), desc(favorites.trackId))
    .limit(LIST)
    .all();
};

/** Library › Favorites: starred songs with when each was starred, the most recent first. */
export const listFavorites = (db: LibraryDatabase): FavoriteRow[] => {
  const { favorites, tracks, artists, albums, artwork } = schema;
  return db
    .select({ ...songColumns, starredAt: favorites.addedAt })
    .from(favorites)
    .innerJoin(tracks, eq(favorites.trackId, tracks.id))
    .innerJoin(artists, eq(tracks.artistId, artists.id))
    .innerJoin(albums, eq(tracks.albumId, albums.id))
    .leftJoin(artwork, eq(tracks.artworkHash, artwork.hash))
    .where(eq(favorites.deleted, false))
    .orderBy(desc(favorites.addedAt), ...BY_TITLE)
    .all();
};

/** The ids of every starred track (unstarred ones, tombstones, aren't). */
export const selectFavoriteTrackIds = (db: LibraryDatabase): number[] =>
  db
    .select({ trackId: schema.favorites.trackId })
    .from(schema.favorites)
    .where(eq(schema.favorites.deleted, false))
    .all()
    .map((row) => row.trackId);

/**
 * The recording key (Core's `recordingKey`) of every song ever played, each
 * once, including songs whose files have since left the Library. Discover
 * mixes leave them out.
 */
export const playedRecordingKeys = (db: LibraryDatabase): string[] =>
  db
    .selectDistinct({ key: schema.playEvents.recordingKey })
    .from(schema.playEvents)
    .where(and(isNotNull(schema.playEvents.recordingKey), isNotNull(schema.playEvents.trackId)))
    .all()
    .flatMap((row) => (row.key === null ? [] : [row.key]));

/** SQLite caps the variables in one statement; batches stay well under it. */
const BATCH = 500;

/**
 * Stars ([on]) or unstars many tracks in one transaction, stamping each star
 * that changes (`changeStamp`). Tracks starred already keep when they were
 * starred; unstarring leaves the star as a tombstone, and starring again
 * brings it back.
 */
export const setFavorites = (
  db: LibraryDatabase,
  trackIds: readonly number[],
  on: boolean,
  now: number,
): void => {
  const { favorites } = schema;
  db.transaction((tx) => {
    for (let start = 0; start < trackIds.length; start += BATCH) {
      const batch = trackIds.slice(start, start + BATCH);
      if (on)
        tx.insert(favorites)
          .values(batch.map((trackId) => ({ trackId, addedAt: now, changedAt: now })))
          .onConflictDoUpdate({
            target: favorites.trackId,
            set: { addedAt: now, deleted: false, ...stamped(favorites, now) },
            setWhere: eq(favorites.deleted, true),
          })
          .run();
      else
        tx.update(favorites)
          .set({ deleted: true, ...stamped(favorites, now) })
          .where(and(inArray(favorites.trackId, batch), eq(favorites.deleted, false)))
          .run();
    }
  });
};

/** Home's sections that follow plays: they change as songs are played, nothing else does. */
export type HomePlays = Pick<HomeSections, "recentlyPlayed" | "mostPlayed">;

/** Recently Added, which only songs entering or leaving the library change. */
export const homeAdded = (
  db: LibraryDatabase,
  scope: TrackScope = "library",
): Pick<HomeSections, "recentlyAdded"> => ({ recentlyAdded: recentlyAddedAlbums(db, scope) });

/** Recently Played and Most Played, read from the play totals (`play_totals`). */
export const homePlays = (db: LibraryDatabase, scope: TrackScope = "library"): HomePlays => ({
  recentlyPlayed: recentlyPlayedShelf(db, scope),
  mostPlayed: mostPlayedSongs(db, scope),
});

/** Favorites, which stars change. */
export const homeFavorites = (
  db: LibraryDatabase,
  scope: TrackScope = "library",
): Pick<HomeSections, "favorites"> => ({ favorites: recentFavorites(db, scope) });

/** The Home tab's sections, of the Tracks in [scope] (Android Auto's Home: those with a file). */
export const homeSections = (db: LibraryDatabase, scope: TrackScope = "library"): HomeSections => ({
  ...homeAdded(db, scope),
  ...homePlays(db, scope),
  ...homeFavorites(db, scope),
});
