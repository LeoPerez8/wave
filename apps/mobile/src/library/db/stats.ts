/**
 * The play totals Stats ranks, as thin queries over the library database:
 * they only filter (counted plays in a window) and sum. Top songs are songs
 * still in the library; albums and artists keep the plays of deleted songs.
 * A song's plays count for every artist its credit names, so a collaboration
 * counts for each of them. Grouping into albums and artists, ordering and the
 * cut-off are Core's (`albumPlayTotals`, `artistPlayTotals`, `rankPlays`); so
 * are the all-time listening totals (`listeningTotals`) summed from
 * `songListening`, or from `artistPlays` for one artist's page. Kept free of
 * Expo so the store tests run them against a real SQLite (`testDatabase.ts`).
 */
import {
  readStoredGenres,
  sortKey,
  type ArtistFirstPlay,
  type ArtistStatsInput,
  type CountedListening,
  type CreditedPlayTotals,
  type PlayTotals,
  type RecapSongGenre,
  type SongListening,
  type SongPlayTotals,
  type StatsWindow,
} from "@wave/core";
import { and, eq, gte, inArray, isNotNull, lte, sql, type SQL } from "drizzle-orm";

import { chunks } from "./chunks.ts";
import type { LibraryDatabase } from "./database.ts";
import * as schema from "./schema.ts";

/** Counted plays, streamed ones too, that started within `window`. */
const countedOrStreamedIn = (window: StatsWindow): SQL | undefined => {
  const { playEvents } = schema;
  return and(
    eq(playEvents.counted, true),
    window.from === null ? undefined : gte(playEvents.startedAt, window.from),
    lte(playEvents.startedAt, window.to),
  );
};

/** Counted plays of Library songs that started within `window`. */
const countedIn = (window: StatsWindow): SQL | undefined =>
  and(countedOrStreamedIn(window), isNotNull(schema.playEvents.trackId));

/**
 * The Library song [videoId]'s streamed plays are, or null: the song with that
 * video id (a download of it), else the one with the same [recordingKey]. A
 * streamed play is that song's in every count once it is in the Library.
 */
export const streamedTrack = (videoId: SQL, recordingKey: SQL): SQL<number | null> => sql`coalesce(
  (SELECT min(id) FROM tracks WHERE tracks.video_id = ${videoId}),
  (SELECT min(id) FROM tracks WHERE tracks.recording_key = ${recordingKey}))`;

/** Whose a play is: its Library song's, or the Library song its streamed song is now. */
const playSong = sql`coalesce(play_events.track_id,
  ${streamedTrack(sql`play_events.video_id`, sql`play_events.recording_key`)})`;

/**
 * Each song's counted plays within `window`, in no order: a Library song's,
 * with the streamed plays that are its own now (`streamedTrack`), and a
 * streamed song's (one entry per video id) while the Library has no song of
 * it. Songs that left the Library drop out, as in `trackPlayTotals`.
 */
export const songPlayTotals = (db: LibraryDatabase, window: StatsWindow): SongPlayTotals[] =>
  db
    .all<{
      trackId: number | null;
      videoId: string | null;
      titleSort: string | null;
      title: string | null;
      countedPlays: number;
      listenedMs: number;
      latestPlayAt: number;
    }>(
      sql`WITH plays AS (
        SELECT ${playSong} AS song, video_id, listened_ms, started_at, snapshot, streamed_song
        FROM play_events WHERE ${countedOrStreamedIn(window)}
      ), songs AS (
        -- The title is the latest play's: the only min or max is max(started_at).
        SELECT song AS track_id, CASE WHEN song IS NULL THEN video_id END AS video_id,
          count(*) AS plays, sum(listened_ms) AS listened, max(started_at) AS latest,
          coalesce(json_extract(snapshot, '$.title'), json_extract(streamed_song, '$.title')) AS title
        FROM plays GROUP BY 1, 2
      )
      SELECT tracks.id AS "trackId", songs.video_id AS "videoId", tracks.title_sort AS "titleSort",
        songs.title AS title, songs.plays AS "countedPlays", songs.listened AS "listenedMs",
        songs.latest AS "latestPlayAt"
      FROM songs LEFT JOIN tracks ON tracks.id = songs.track_id
      WHERE tracks.id IS NOT NULL OR songs.video_id IS NOT NULL`,
    )
    .map(({ trackId, videoId, titleSort, title, ...totals }) => ({
      song: trackId === null ? { kind: "yt", videoId: videoId! } : { kind: "library", id: trackId },
      sortKey: titleSort ?? sortKey(title ?? ""),
      ...totals,
    }));

/** What every aggregate sums over its counted plays. */
const sums = {
  countedPlays: sql<number>`count(*)`,
  listenedMs: sql<number>`sum(${schema.playEvents.listenedMs})`,
  latestPlayAt: sql<number>`max(${schema.playEvents.startedAt})`,
};

/**
 * Each track's counted plays within `window`, for tracks still in the library,
 * in no order; with [trackIds], only those tracks' (each read through the
 * play events' track index, so a few songs don't cost the whole history).
 */
export const trackPlayTotals = (
  db: LibraryDatabase,
  window: StatsWindow,
  trackIds?: readonly number[],
): PlayTotals[] => {
  const { playEvents, tracks } = schema;
  const read = (only?: readonly number[]) =>
    db
      .select({ id: tracks.id, sortKey: tracks.titleSort, ...sums })
      .from(playEvents)
      .innerJoin(tracks, eq(playEvents.trackId, tracks.id))
      .where(
        and(countedIn(window), only === undefined ? undefined : inArray(playEvents.trackId, only)),
      )
      .groupBy(tracks.id)
      .all();
  // Grouped by track, so each run's rows are its own tracks'.
  return trackIds === undefined ? read() : chunks(trackIds).flatMap(read);
};

/**
 * The artists a song's plays count for (`track_id`, `artist_id`, `position`
 * in its credit): every artist its credit names, or, once the song left the
 * library, those its plays kept (`deleteTracks`). Only artists in the library.
 */
const CREDITED_ARTISTS = sql`
  SELECT track_id, artist_id, position FROM track_artists
  UNION ALL
  SELECT track_id, artist_id, position FROM deleted_track_artists`;

/**
 * Each track's counted plays within `window` (`track_id`, `album_id` of a
 * deleted track, `plays`, `listened`, `latest`), summed from the plays.
 */
const playsIn = (window: StatsWindow): SQL => sql`
  SELECT play_events.track_id AS track_id, max(play_events.album_id) AS album_id,
    ${sums.countedPlays} AS plays, ${sums.listenedMs} AS listened, ${sums.latestPlayAt} AS latest
  FROM play_events WHERE ${countedIn(window)}
  GROUP BY play_events.track_id`;

/**
 * `playsIn` for every counted play up to [to] (all time), from the totals
 * `play_totals` keeps rather than the history: only a track with a counted
 * play stamped after [to] (another phone's clock ahead) has its plays summed
 * again, through the play events' track index.
 */
const playsUpTo = (to: number): SQL => sql`
  SELECT track_id, album_id, counted_plays AS plays, counted_listened_ms AS listened,
    last_counted_at AS latest
  FROM play_totals WHERE counted_plays > 0 AND last_counted_at <= ${to}
  UNION ALL
  SELECT play_events.track_id, max(play_events.album_id), ${sums.countedPlays},
    ${sums.listenedMs}, ${sums.latestPlayAt}
  FROM play_totals CROSS JOIN play_events ON play_events.track_id = play_totals.track_id
  WHERE play_totals.last_counted_at > ${to} AND play_events.counted
    AND play_events.started_at <= ${to}
  GROUP BY play_events.track_id`;

/**
 * Counted plays within `window` per album and credited artist (a compilation
 * gives one row per artist on it, a collaboration one per artist it credits),
 * in no order. Deleted songs still count for their album and artists while
 * those are in the library.
 */
export const creditedPlayTotals = (
  db: LibraryDatabase,
  window: StatsWindow,
): CreditedPlayTotals[] =>
  db
    .all<Omit<CreditedPlayTotals, "primary"> & { primary: number }>(
      sql`WITH plays AS (${window.from === null ? playsUpTo(window.to) : playsIn(window)}),
      credited AS (${CREDITED_ARTISTS}),
      -- Each song's first credited position, once (as a correlated subquery
      -- per row it cost ten times the rest at 10,000 songs on 1,000 albums).
      firsts AS (SELECT track_id, min(position) AS position FROM credited GROUP BY track_id)
      SELECT albums.id AS "albumId", albums.title_sort AS "albumSort",
        artists.id AS "artistId", artists.sort AS "artistSort",
        credited.position = firsts.position AS "primary",
        sum(plays.plays) AS "countedPlays", sum(plays.listened) AS "listenedMs",
        max(plays.latest) AS "latestPlayAt"
      FROM plays
      LEFT JOIN tracks ON tracks.id = plays.track_id
      JOIN albums ON albums.id = coalesce(tracks.album_id, plays.album_id)
      JOIN credited ON credited.track_id = plays.track_id
      JOIN firsts ON firsts.track_id = plays.track_id
      JOIN artists ON artists.id = credited.artist_id
      GROUP BY albums.id, artists.id, "primary"`,
    )
    .map((row) => ({ ...row, primary: row.primary === 1 }));

/**
 * Each played song's listening over all time, one row per song in no order:
 * time listened over every play, its counted plays, its latest play, and the
 * artists its credit names (kept when the song left the library, whose
 * history stays; none if it left before Wave kept them).
 */
export const songListening = (db: LibraryDatabase): SongListening[] => {
  const { playEvents, tracks } = schema;
  const artists = new Map<number, number[]>();
  for (const link of db.all<{ trackId: number; artistId: number }>(
    sql`WITH credited AS (${CREDITED_ARTISTS})
      SELECT track_id AS "trackId", artist_id AS "artistId" FROM credited
      WHERE track_id IN (SELECT track_id FROM play_events)
      ORDER BY track_id, position`,
  )) {
    const ids = artists.get(link.trackId) ?? [];
    ids.push(link.artistId);
    artists.set(link.trackId, ids);
  }
  return db
    .select({
      trackId: sql<number>`${playEvents.trackId}`,
      inLibrary: sql<boolean>`${tracks.id} IS NOT NULL`.mapWith(Boolean),
      countedPlays: sql<number>`sum(${playEvents.counted})`,
      listenedMs: sql<number>`sum(${playEvents.listenedMs})`,
      lastPlayedAt: sql<number>`max(${playEvents.startedAt})`,
    })
    .from(playEvents)
    .leftJoin(tracks, eq(playEvents.trackId, tracks.id))
    .where(isNotNull(playEvents.trackId))
    .groupBy(playEvents.trackId)
    .all()
    .map(({ trackId, ...song }) => ({ trackId, artistIds: artists.get(trackId) ?? [], ...song }));
};

/**
 * The songs in the library whose credit names [artistId], in no order: the
 * songs their plays count for, which the artist page's stats block counts its
 * songs listened among (Core's `artistStats`).
 */
export const songsCrediting = (db: LibraryDatabase, artistId: number): number[] => {
  const { trackArtists } = schema;
  return db
    .selectDistinct({ id: trackArtists.trackId })
    .from(trackArtists)
    .where(eq(trackArtists.artistId, artistId))
    .all()
    .map((row) => row.id);
};

/** What an artist page's stats block reads, beside the artist and the time (Core's `artistStats`). */
export type ArtistPlays = Pick<ArtistStatsInput, "songIds" | "listening" | "songPlays">;

/**
 * The listening of the songs whose credit names [artistId], kept credits of
 * deleted songs included: `songListening`'s rows for those songs. Reads
 * only those songs' plays: the credits' artist indexes give the songs, the
 * play events' track index their plays.
 */
const artistListening = (db: LibraryDatabase, artistId: number): SongListening[] => {
  const songs = new Map<number, Omit<SongListening, "artistIds"> & { artistIds: number[] }>();
  for (const { artistId: credited, ...song } of db.all<{
    trackId: number;
    inLibrary: number;
    countedPlays: number;
    listenedMs: number;
    lastPlayedAt: number;
    artistId: number;
  }>(
    sql`WITH songs AS (
        SELECT track_id FROM track_artists WHERE artist_id = ${artistId}
        UNION
        SELECT track_id FROM deleted_track_artists WHERE artist_id = ${artistId}
      ), played AS (
        SELECT play_events.track_id AS track_id, sum(play_events.counted) AS counted_plays,
          sum(play_events.listened_ms) AS listened_ms, max(play_events.started_at) AS last_played_at
        FROM songs CROSS JOIN play_events ON play_events.track_id = songs.track_id
        GROUP BY play_events.track_id
      ), credited AS (
        SELECT track_id, artist_id, position FROM track_artists
        WHERE track_id IN (SELECT track_id FROM played)
        UNION ALL
        SELECT track_id, artist_id, position FROM deleted_track_artists
        WHERE track_id IN (SELECT track_id FROM played)
      )
      SELECT played.track_id AS "trackId", tracks.id IS NOT NULL AS "inLibrary",
        played.counted_plays AS "countedPlays", played.listened_ms AS "listenedMs",
        played.last_played_at AS "lastPlayedAt", credited.artist_id AS "artistId"
      FROM played
      JOIN credited ON credited.track_id = played.track_id
      LEFT JOIN tracks ON tracks.id = played.track_id
      ORDER BY played.track_id, credited.position`,
  )) {
    const known = songs.get(song.trackId);
    if (known === undefined) {
      songs.set(song.trackId, { ...song, inLibrary: song.inLibrary === 1, artistIds: [credited] });
    } else known.artistIds.push(credited);
  }
  return [...songs.values()];
};

/**
 * The genre tags of the songs [ids] still in the library, in no order: the
 * genre each is filed under and, for a multi-value tag, every value (Core's
 * `recap` ranks their families).
 */
export const songGenres = (db: LibraryDatabase, ids: readonly number[]): RecapSongGenre[] => {
  const { tracks, genres } = schema;
  return chunks(ids).flatMap((only) =>
    db
      .select({ id: tracks.id, genre: genres.name, genres: tracks.genres })
      .from(tracks)
      .leftJoin(genres, eq(tracks.genreId, genres.id))
      .where(inArray(tracks.id, only))
      .all()
      .map((row) => {
        const values = readStoredGenres(row.genres);
        return { id: row.id, genre: row.genre, genres: values.length === 0 ? null : values };
      }),
  );
};

/**
 * When each of the artists [ids] had their first counted play ever, deleted
 * songs' kept credits included, in no order; an artist never played isn't
 * listed (Core's `recap` tells the period's discoveries from these). Reads
 * only those artists' songs' plays, through the play events' track index.
 */
export const artistFirstPlays = (db: LibraryDatabase, ids: readonly number[]): ArtistFirstPlay[] =>
  chunks(ids).flatMap((only) =>
    db.all<ArtistFirstPlay>(
      sql`WITH credited AS (${CREDITED_ARTISTS})
        SELECT credited.artist_id AS id, min(play_events.started_at) AS "firstPlayAt"
        FROM credited CROSS JOIN play_events ON play_events.track_id = credited.track_id
        WHERE credited.artist_id IN (${sql.join(
          only.map((id) => sql`${id}`),
          sql`, `,
        )}) AND play_events.counted
        GROUP BY credited.artist_id`,
    ),
  );

/**
 * A play of a Library song or a streamed one, as the listening totals count
 * them (`listeningSums`): not a synced play still waiting for its song.
 */
const libraryOrStreamed = sql`(play_events.track_id IS NOT NULL OR play_events.video_id IS NOT NULL)`;

/** A quarter hour: every time zone's offset is a whole number of them. */
const QUARTER_HOUR_MS = 15 * 60_000;

/**
 * The whole history's counted listening, summed per quarter hour (each row
 * starts at its quarter hour), deleted and streamed songs included: what Core's
 * `availableRecaps` and `recap` read. A quarter hour never straddles a local
 * month or day, so the sums lose nothing a Recap needs, at a fraction of the rows.
 */
export const countedListening = (db: LibraryDatabase): CountedListening[] => {
  const { playEvents } = schema;
  const quarter = sql<number>`(${playEvents.startedAt} / ${QUARTER_HOUR_MS}) * ${QUARTER_HOUR_MS}`;
  return db
    .select({ startedAt: quarter, listenedMs: sql<number>`sum(${playEvents.listenedMs})` })
    .from(playEvents)
    .where(and(eq(playEvents.counted, true), libraryOrStreamed))
    .groupBy(quarter)
    .all();
};

/** Bounded raw-event keyset; even an all-skipped page advances its cursor. */
export interface CountedListeningPage {
  readonly rows: readonly CountedListening[];
  readonly next: number | null;
}

export const countedListeningPage = (db: LibraryDatabase, after: number): CountedListeningPage => {
  // Materialization bounds the aggregate itself: no grouped whole-history scan or OFFSET.
  const rows = db.all<{
    startedAt: number | null;
    listenedMs: number;
    next: number | null;
    size: number;
  }>(sql`
    WITH page AS MATERIALIZED (
      SELECT id, started_at, listened_ms, counted FROM play_events
      WHERE id > ${after} AND ${libraryOrStreamed} ORDER BY id LIMIT 512
    )
    SELECT (started_at / ${QUARTER_HOUR_MS}) * ${QUARTER_HOUR_MS} AS "startedAt",
      sum(listened_ms) AS "listenedMs", NULL AS next, 0 AS size
    FROM page WHERE counted GROUP BY (started_at / ${QUARTER_HOUR_MS}) * ${QUARTER_HOUR_MS}
    UNION ALL SELECT NULL, 0, max(id), count(*) FROM page`);
  const cursor = rows.pop()!;
  return {
    rows: rows.map(({ startedAt, listenedMs }) => ({ startedAt: startedAt!, listenedMs })),
    next: cursor.size < 512 ? null : cursor.next,
  };
};

/**
 * What [artistId]'s page reads for its stats block, from that artist's songs
 * alone, however long the rest of the history: the songs in the library whose
 * credit names them (`songsCrediting`), those songs' listening over all time,
 * deleted songs included (`songListening`'s rows for them), and the counted
 * plays up to [now] of those still in the library that have one
 * (`trackPlayTotals`).
 */
export const artistPlays = (db: LibraryDatabase, artistId: number, now: number): ArtistPlays => {
  const listening = artistListening(db, artistId);
  const played = listening.filter((song) => song.inLibrary && song.countedPlays > 0);
  return {
    songIds: songsCrediting(db, artistId),
    listening,
    songPlays:
      played.length === 0
        ? []
        : trackPlayTotals(
            db,
            { from: null, to: now },
            played.map((song) => song.trackId),
          ),
  };
};
