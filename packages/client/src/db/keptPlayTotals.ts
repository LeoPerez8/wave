/**
 * Kept play totals (#1349): what Stats, Home's sections and the Magic Queue
 * rank by, read from the per-day and per-block sums that migration
 * `0065_kept_play_totals` keeps (`keptTotalsMigration.ts`) rather than summed
 * from the history on every read. Core plans which rows a window reads
 * (`keptTotalsPlan`) and credits streamed songs (`streamedCredits`); this
 * module settles what the triggers leave owed and reads the totals. Kept free
 * of Expo so the store tests run it against a real SQLite (`testDatabase.ts`).
 */
import {
  keptTotalsPlan,
  rankEntityPlays,
  releaseTitle,
  sortKey,
  type CreditedPlayTotals,
  type KeptTotalsPlan,
  type SongPlayTotals,
  type StatsWindow,
  type YtAlbumSong,
} from "@wave/core";
import { sql, type SQL } from "drizzle-orm";

import type { AlbumRow, ArtistRow } from "../types.ts";
import { selectAlbums } from "./albums.ts";
import { selectArtists } from "./artists.ts";
import type { LibraryDatabase } from "./database.ts";
import { songKeySql } from "./keptTotalsMigration.ts";
import type {
  OnlineAlbum,
  OnlineArtist,
  PlayedAlbum,
  PlayedArtist,
  PlayedEntityTotal,
  PlayedEntityTotals,
} from "./playedEntities.ts";
import { playedLibraryRows, playedResolver, type PlayedLibraryRows } from "./playedLibrary.ts";
import * as schema from "./schema.ts";
import { streamedSongsOf } from "./streamedSongs.ts";

// Written into the statements: bound, a block's length (past 2^31) would be a real and divide exactly.
const DAY_MS = 86_400_000;
const BLOCK_MS = 32 * DAY_MS;

/** What a song's plays count for: an album, an artist, a Stats credit row or a ranked song. */
export type CreditKind = "album" | "artist" | "credit" | "song";

interface Credit {
  readonly kind: CreditKind;
  readonly entity: string;
  readonly weight: number;
  readonly albumId: number | null;
  readonly artistId: number | null;
}

interface KeptState {
  readonly generation: number;
  readonly seededThrough: number;
  readonly seedUntil: number;
}

const keptState = (db: LibraryDatabase): KeptState =>
  db.get<KeptState>(sql`SELECT generation, seeded_through AS "seededThrough",
    seed_until AS "seedUntil" FROM kept_totals_state WHERE id = 1`);

const owedSongs = (db: LibraryDatabase, state: 0 | 1, limit: number): string[] =>
  db
    .all<{ song: string }>(
      sql`SELECT song FROM played_songs WHERE state = ${state} ORDER BY song LIMIT ${limit}`,
    )
    .map((row) => row.song);

/**
 * Whether the kept totals hold every play: seeded, summed and credited. While
 * they don't, readers sum from the history and the startup job settles them.
 */
export const keptTotalsSettled = (db: LibraryDatabase): boolean => {
  const kept = keptState(db);
  return (
    kept.seededThrough >= kept.seedUntil &&
    db.get<{ owed: number }>(sql`SELECT EXISTS (SELECT 1 FROM played_songs WHERE state < 2) AS owed`)
      .owed === 0
  );
};

/** Names the songs of the plays after the last one seeded, up to [rows] plays (an upgrade's history). */
const seed = (db: LibraryDatabase, kept: KeptState, rows: number) => {
  const to = Math.min(kept.seedUntil, kept.seededThrough + rows);
  db.transaction((tx) => {
    tx.run(sql`INSERT INTO played_songs (song, track_id, video_id, recording_key, state)
      SELECT DISTINCT ${sql.raw(songKeySql("e"))}, e.track_id, e.video_id, e.recording_key, 0
      FROM play_events AS e WHERE e.id > ${kept.seededThrough} AND e.id <= ${to}
      ON CONFLICT (song) DO UPDATE SET state = 0`);
    tx.run(sql`INSERT INTO played_recordings (recording_key, counted_plays)
      SELECT recording_key, count(*) FROM play_events
      WHERE id > ${kept.seededThrough} AND id <= ${to} AND counted AND recording_key IS NOT NULL
      GROUP BY recording_key
      ON CONFLICT (recording_key) DO UPDATE SET counted_plays = counted_plays + excluded.counted_plays`);
    tx.run(sql`INSERT INTO playlist_play_buckets (context_id, span, bucket, counted_plays, latest_play_at)
      SELECT * FROM (
        SELECT context_id, 0, started_at / ${sql.raw(String(DAY_MS))} AS bucket, count(*), max(started_at)
        FROM play_events WHERE id > ${kept.seededThrough} AND id <= ${to} AND counted
          AND context_type = 'playlist' AND context_id IS NOT NULL GROUP BY context_id, bucket
        UNION ALL
        SELECT context_id, 1, started_at / ${sql.raw(String(BLOCK_MS))} AS bucket, count(*), max(started_at)
        FROM play_events WHERE id > ${kept.seededThrough} AND id <= ${to} AND counted
          AND context_type = 'playlist' AND context_id IS NOT NULL GROUP BY context_id, bucket
      ) WHERE true
      ON CONFLICT (context_id, span, bucket) DO UPDATE SET
        counted_plays = counted_plays + excluded.counted_plays,
        latest_play_at = max(latest_play_at, excluded.latest_play_at)`);
    tx.run(sql`UPDATE kept_totals_state SET seeded_through = ${to} WHERE id = 1`);
  });
};

/** The plays of the song [key], through the index its kind has. */
const playsOf = (key: string): SQL => {
  const rest = key.slice(2);
  if (key.startsWith("t:")) return sql`e.track_id = ${Number(rest)}`;
  if (key.startsWith("v:")) {
    const bar = rest.indexOf("|");
    return sql`e.video_id = ${rest.slice(0, bar)}
      AND coalesce(e.recording_key, '') = ${rest.slice(bar + 1)}`;
  }
  return sql`e.track_id IS NULL AND e.video_id IS NULL AND e.recording_key = ${rest}`;
};

/** Sums each of [songs]' days and blocks again from their counted plays. */
const sumSongs = (db: LibraryDatabase, songs: readonly string[]) => {
  db.transaction((tx) => {
    for (const song of songs) {
      tx.run(sql`DELETE FROM play_buckets WHERE song = ${song}`);
      tx.run(sql`INSERT INTO play_buckets (song, span, bucket, counted_plays, listened_ms, latest_play_at)
        SELECT ${song}, 0, e.started_at / ${sql.raw(String(DAY_MS))}, count(*), sum(e.listened_ms), max(e.started_at)
        FROM play_events AS e WHERE e.counted AND ${playsOf(song)} GROUP BY 3
        UNION ALL
        SELECT ${song}, 1, e.started_at / ${sql.raw(String(BLOCK_MS))}, count(*), sum(e.listened_ms), max(e.started_at)
        FROM play_events AS e WHERE e.counted AND ${playsOf(song)} GROUP BY 3`);
    }
    tx.run(sql`UPDATE played_songs SET state = 1 WHERE state = 0
      AND song IN (SELECT value FROM json_each(${JSON.stringify(songs)}))`);
  });
};

/** Core's resolver as the Library stood at a generation, with every streamed song's release. */
interface Resolver {
  readonly generation: number;
  readonly rows: PlayedLibraryRows;
  readonly releases: YtAlbumSong[];
  readonly known: Set<string>;
  resolve: ReturnType<typeof playedResolver>;
}

const resolvers = new WeakMap<object, Resolver>();

/** The connection [db] runs on: a transaction shares its database's, so both find one resolver. */
const connectionOf = (db: LibraryDatabase): object =>
  (db as unknown as { readonly session?: object }).session ?? db;

const releaseOf = (song: YtAlbumSong): string | null =>
  song.album === null || song.albumId == null ? null : `${releaseTitle(song.album)}|${song.albumId}`;

/** The resolver of [generation]: kept between settles, built again (a whole-Library read) when it moved. */
const resolverOf = (db: LibraryDatabase, generation: number): Resolver => {
  const cached = resolvers.get(connectionOf(db));
  if (cached?.generation === generation) return cached;
  const videos = db
    .all<{ videoId: string }>(
      sql`SELECT DISTINCT video_id AS "videoId" FROM played_songs WHERE video_id IS NOT NULL`,
    )
    .map((row) => row.videoId);
  const releases = [...streamedSongsOf(db, videos).values()].filter(
    (song) => releaseOf(song) !== null,
  );
  const rows = playedLibraryRows(db);
  const resolver: Resolver = {
    generation,
    rows,
    releases,
    known: new Set(releases.map((song) => releaseOf(song)!)),
    resolve: playedResolver(rows, releases),
  };
  resolvers.set(connectionOf(db), resolver);
  return resolver;
};

/** Whether crediting [songs] would build Core's resolver: a whole-Library read. */
const needsResolver = (db: LibraryDatabase, songs: readonly string[], generation: number) =>
  songs.some((song) => song.startsWith("v:")) && resolvers.get(connectionOf(db))?.generation !== generation;

/** An online album, artist or song as the latest played song crediting it names it. */
interface OnlineEntity {
  readonly kind: CreditKind;
  readonly entity: string;
  readonly sortKey: string;
  readonly item: unknown;
  readonly playedAt: number;
}

interface Settled {
  readonly credits: Credit[];
  readonly songTrack: number | null;
  readonly online: boolean;
  readonly albumHint: string | null;
}

const count = (credits: Map<string, Credit>, credit: Omit<Credit, "weight">) => {
  const key = `${credit.kind}\u0000${credit.entity}`;
  const previous = credits.get(key);
  credits.set(key, { ...credit, weight: (previous?.weight ?? 0) + 1 });
};

/**
 * A Library song's plays count, as `creditedPlayTotals` sums them, for each
 * artist its credit names (kept when it left the Library), for its album once
 * per primary credit, for each such Stats row, and for the song.
 */
const libraryCredits = (db: LibraryDatabase, tracks: readonly number[]) => {
  const settled = new Map<number, Map<string, Credit>>(
    tracks.map((id) => [
      id,
      new Map([
        [
          `song\u0000t:${id}`,
          { kind: "song", entity: `t:${id}`, weight: 1, albumId: null, artistId: null },
        ],
      ]),
    ]),
  );
  for (const row of db.all<{ trackId: number; albumId: number; artistId: number; primary: number }>(
    sql`WITH wanted AS (SELECT value AS track_id FROM json_each(${JSON.stringify(tracks)})),
      links AS (
        SELECT track_id, artist_id, position FROM track_artists
          WHERE track_id IN (SELECT track_id FROM wanted)
        UNION ALL
        SELECT track_id, artist_id, position FROM deleted_track_artists
          WHERE track_id IN (SELECT track_id FROM wanted)
      ),
      firsts AS (SELECT track_id, min(position) AS position FROM links GROUP BY track_id),
      kept AS (
        SELECT wanted.track_id, coalesce(tracks.album_id, play_totals.album_id) AS album_id
        FROM wanted LEFT JOIN tracks ON tracks.id = wanted.track_id
        LEFT JOIN play_totals ON play_totals.track_id = wanted.track_id
      )
      SELECT links.track_id AS "trackId", albums.id AS "albumId", artists.id AS "artistId",
        links.position = firsts.position AS "primary"
      FROM links JOIN firsts ON firsts.track_id = links.track_id
      JOIN kept ON kept.track_id = links.track_id
      JOIN albums ON albums.id = kept.album_id
      JOIN artists ON artists.id = links.artist_id`,
  )) {
    const credits = settled.get(row.trackId)!;
    const ids = { albumId: row.albumId, artistId: row.artistId };
    count(credits, { kind: "artist", entity: String(row.artistId), ...ids });
    if (row.primary === 1) count(credits, { kind: "album", entity: String(row.albumId), ...ids });
    count(credits, {
      kind: "credit",
      entity: `${row.albumId}:${row.artistId}:${row.primary}`,
      ...ids,
    });
  }
  return settled;
};

/** The Library song each streamed song of [keys] is now (`streamedTrack`), by its key. */
const streamedTracks = (
  db: LibraryDatabase,
  keys: readonly { readonly song: string; readonly videoId: string | null; readonly key: string }[],
): Map<string, number> =>
  new Map(
    keys.length === 0
      ? []
      : db
          .all<{ song: string; trackId: number | null }>(
            sql`SELECT json_extract(value, '$[0]') AS song, coalesce(
            (SELECT min(id) FROM tracks WHERE tracks.video_id = json_extract(value, '$[1]')),
            (SELECT min(id) FROM tracks WHERE tracks.recording_key = nullif(json_extract(value, '$[2]'), '')))
            AS "trackId"
          FROM json_each(${JSON.stringify(keys.map((k) => [k.song, k.videoId, k.key]))})`,
          )
          .flatMap((row) => (row.trackId === null ? [] : [[row.song, row.trackId] as const])),
  );

/** Credits [songs] owe, writes them and marks them settled. */
const creditSongs = (db: LibraryDatabase, songs: readonly string[], generation: number) => {
  const settled = new Map<string, Settled>();
  const online: OnlineEntity[] = [];
  const library = songs.filter((song) => song.startsWith("t:"));
  for (const [id, credits] of libraryCredits(
    db,
    library.map((song) => Number(song.slice(2))),
  ))
    settled.set(`t:${id}`, {
      credits: [...credits.values()],
      songTrack: id,
      online: false,
      albumHint: null,
    });
  const others = songs
    .filter((song) => !song.startsWith("t:"))
    .map((song) => {
      if (song.startsWith("r:")) return { song, videoId: null, key: song.slice(2) };
      const bar = song.indexOf("|");
      return { song, videoId: song.slice(2, bar), key: song.slice(bar + 1) };
    });
  const mapped = streamedTracks(db, others);
  const mappedLinks = new Map<number, { artistIds: number[]; albumId: number }>();
  const tracks = [...new Set(mapped.values())];
  if (tracks.length > 0)
    for (const link of db.all<{ trackId: number; artistId: number; albumId: number }>(
      sql`SELECT track_artists.track_id AS "trackId", track_artists.artist_id AS "artistId",
        tracks.album_id AS "albumId"
      FROM track_artists JOIN tracks ON tracks.id = track_artists.track_id
      WHERE track_artists.track_id IN (SELECT value FROM json_each(${JSON.stringify(tracks)}))`,
    )) {
      const links = mappedLinks.get(link.trackId) ?? { artistIds: [], albumId: link.albumId };
      links.artistIds.push(link.artistId);
      mappedLinks.set(link.trackId, links);
    }
  const unmapped = others.filter(
    (entry) => entry.videoId !== null && !mapped.has(entry.song),
  ) as { song: string; videoId: string; key: string }[];
  const metadata = streamedSongsOf(
    db,
    unmapped.map((entry) => entry.videoId),
  );
  const playedAt = new Map(
    unmapped.length === 0
      ? []
      : db
          .all<{ videoId: string; playedAt: number }>(
            sql`SELECT video_id AS "videoId", max(started_at) AS "playedAt" FROM play_events
            WHERE video_id IN (SELECT value FROM json_each(${JSON.stringify(unmapped.map((entry) => entry.videoId))}))
            GROUP BY video_id`,
          )
          .map((row) => [row.videoId, row.playedAt]),
  );
  const hinted: string[] = [];
  let resolver: Resolver | undefined;
  if (unmapped.length > 0) {
    resolver = resolverOf(db, generation);
    // A song naming its release can give another song of that album its id: theirs owe again.
    const fresh = [...metadata.values()].filter((song) => {
      const release = releaseOf(song);
      return release !== null && !resolver!.known.has(release);
    });
    if (fresh.length > 0) {
      for (const song of fresh) {
        resolver.known.add(releaseOf(song)!);
        resolver.releases.push(song);
        hinted.push(releaseTitle(song.album!));
      }
      resolver.resolve = playedResolver(resolver.rows, resolver.releases);
    }
  }
  for (const entry of others) {
    const credits = new Map<string, Credit>();
    const track = mapped.get(entry.song);
    if (track !== undefined) {
      count(credits, { kind: "song", entity: `t:${track}`, albumId: null, artistId: null });
      const links = mappedLinks.get(track);
      if (entry.videoId !== null && links !== undefined) {
        for (const artistId of links.artistIds)
          count(credits, { kind: "artist", entity: String(artistId), albumId: null, artistId });
        count(credits, {
          kind: "album",
          entity: String(links.albumId),
          albumId: links.albumId,
          artistId: null,
        });
      }
      settled.set(entry.song, {
        credits: [...credits.values()],
        songTrack: track,
        online: false,
        albumHint: null,
      });
      continue;
    }
    if (entry.videoId === null) {
      settled.set(entry.song, { credits: [], songTrack: null, online: false, albumHint: null });
      continue;
    }
    const song = metadata.get(entry.videoId);
    const songEntity = `yt:${entry.videoId}`;
    const at = playedAt.get(entry.videoId) ?? 0;
    count(credits, { kind: "song", entity: songEntity, albumId: null, artistId: null });
    online.push({ kind: "song", entity: songEntity, sortKey: sortKey(song?.title ?? ""), item: {}, playedAt: at });
    if (song !== undefined) {
      const resolved = resolver!.resolve(song);
      for (const artist of resolved.artists) {
        if (typeof artist.id === "number") {
          count(credits, {
            kind: "artist",
            entity: String(artist.id),
            albumId: null,
            artistId: artist.id,
          });
          continue;
        }
        count(credits, { kind: "artist", entity: artist.id, albumId: null, artistId: null });
        const item: OnlineArtist = {
          ...artist,
          id: artist.id,
          online: true,
          thumbPath: null,
          artworkPath: null,
        };
        online.push({ kind: "artist", entity: artist.id, sortKey: sortKey(artist.name), item, playedAt: at });
      }
      const album = resolved.album;
      if (album !== null) {
        if (typeof album.id === "number")
          count(credits, {
            kind: "album",
            entity: String(album.id),
            albumId: album.id,
            artistId: null,
          });
        else {
          count(credits, { kind: "album", entity: album.id, albumId: null, artistId: null });
          const item: OnlineAlbum = {
            ...album,
            id: album.id,
            online: true,
            albumArtist: album.artists.join(", "),
          };
          online.push({ kind: "album", entity: album.id, sortKey: sortKey(album.title), item, playedAt: at });
        }
      }
    }
    settled.set(entry.song, {
      credits: [...credits.values()],
      songTrack: null,
      online: true,
      albumHint:
        song !== undefined && song.album !== null && song.albumId == null
          ? releaseTitle(song.album)
          : null,
    });
  }
  writeCredits(db, settled, online, hinted);
};

const sameCredit = (a: Credit, b: Credit) =>
  a.weight === b.weight && a.albumId === b.albumId && a.artistId === b.artistId;

/** Writes what changed of [settled]'s credits (the triggers move their sums), and marks them settled. */
const writeCredits = (
  db: LibraryDatabase,
  settled: ReadonlyMap<string, Settled>,
  online: readonly OnlineEntity[],
  hinted: readonly string[],
) => {
  db.transaction((tx) => {
    for (const [song, { credits, songTrack, online: isOnline, albumHint }] of settled) {
      const kept = new Map(
        tx
          .all<Credit>(
            sql`SELECT kind, entity, weight, album_id AS "albumId", artist_id AS "artistId"
            FROM play_credits WHERE song = ${song}`,
          )
          .map((credit) => [`${credit.kind}\u0000${credit.entity}`, credit]),
      );
      const wanted = new Map(credits.map((credit) => [`${credit.kind}\u0000${credit.entity}`, credit]));
      for (const [key, credit] of kept) {
        const next = wanted.get(key);
        if (next !== undefined && sameCredit(next, credit)) continue;
        tx.run(sql`DELETE FROM play_credits WHERE song = ${song} AND kind = ${credit.kind}
          AND entity = ${credit.entity}`);
      }
      for (const [key, credit] of wanted) {
        const previous = kept.get(key);
        if (previous !== undefined && sameCredit(previous, credit)) continue;
        tx.run(sql`INSERT INTO play_credits (song, kind, entity, weight, album_id, artist_id)
          VALUES (${song}, ${credit.kind}, ${credit.entity}, ${credit.weight}, ${credit.albumId},
            ${credit.artistId})`);
      }
      tx.run(sql`UPDATE played_songs SET state = 2, song_track = ${songTrack},
        online = ${isOnline ? 1 : 0}, album_hint = ${albumHint}
        WHERE song = ${song} AND state = 1`);
    }
    for (const entity of online)
      // The latest played song crediting it names it, as Home's Recently played does.
      tx.run(sql`INSERT INTO played_entities (kind, entity, sort_key, item, played_at)
        VALUES (${entity.kind}, ${entity.entity}, ${entity.sortKey}, ${JSON.stringify(entity.item)},
          ${entity.playedAt})
        ON CONFLICT (kind, entity) DO UPDATE SET sort_key = excluded.sort_key, item = excluded.item,
          played_at = excluded.played_at
        WHERE excluded.played_at >= played_entities.played_at`);
    for (const hint of new Set(hinted))
      tx.run(sql`UPDATE played_songs SET state = 1 WHERE state = 2 AND album_hint = ${hint}`);
  });
};

export interface SettleStep {
  /** At most this many songs are summed or credited in one step. */
  readonly songs?: number;
  /** At most this many plays are seeded in one step. */
  readonly plays?: number;
}

/**
 * One bounded step of what the kept totals owe: seed the next plays of an
 * upgrade's history, sum a few songs' days and blocks, or credit a few songs
 * (building Core's resolver first when the Library changed). True once
 * nothing is owed. What the startup job runs on settled turns.
 */
export const settleKeptTotals = (
  db: LibraryDatabase,
  { songs = 50, plays = 2_000 }: SettleStep = {},
): boolean => {
  const kept = keptState(db);
  if (kept.seededThrough < kept.seedUntil) {
    seed(db, kept, plays);
    return false;
  }
  const unsummed = owedSongs(db, 0, songs);
  if (unsummed.length > 0) {
    sumSongs(db, unsummed);
    return false;
  }
  const uncredited = owedSongs(db, 1, songs);
  if (uncredited.length > 0) creditSongs(db, uncredited, kept.generation);
  return keptTotalsSettled(db);
};

const keeping = new WeakSet<object>();

/** Whether [db] has the kept totals' tables: a database from before 0065 (in tests) writes plays without. */
const keepsTotals = (db: LibraryDatabase): boolean => {
  if (keeping.has(connectionOf(db))) return true;
  const found =
    db.get<{ found: number }>(
      sql`SELECT EXISTS (SELECT 1 FROM sqlite_master WHERE name = 'kept_totals_state') AS found`,
    ).found === 1;
  if (found) keeping.add(connectionOf(db));
  return found;
};

/** How many songs a play's write credits itself: past this, or without the resolver, the job does. */
const WRITE_SONGS = 8;

/**
 * Credits the few songs a play just written owes, within its write, when
 * that needs no whole-Library read; otherwise they wait for the startup job.
 */
export const creditPlayedSongs = (db: LibraryDatabase): void => {
  if (!keepsTotals(db)) return;
  const kept = keptState(db);
  if (kept.seededThrough < kept.seedUntil) return;
  const owed = db.all<{ song: string; state: number }>(
    sql`SELECT song, state FROM played_songs WHERE state < 2 LIMIT ${WRITE_SONGS + 1}`,
  );
  if (owed.length === 0 || owed.length > WRITE_SONGS || owed.some((row) => row.state === 0)) return;
  const songs = owed.map((row) => row.song);
  if (needsResolver(db, songs, kept.generation)) return;
  creditSongs(db, songs, kept.generation);
};

/**
 * Which of [keys] have a counted play, from the kept counts per recording:
 * null until an upgrade's history is seeded.
 */
export const countedRecordings = (db: LibraryDatabase, keys: readonly string[]): string[] | null => {
  if (!keepsTotals(db)) return null;
  const kept = keptState(db);
  if (kept.seededThrough < kept.seedUntil) return null;
  if (keys.length === 0) return [];
  return db
    .all<{ key: string }>(
      sql`SELECT recording_key AS key FROM played_recordings WHERE counted_plays > 0
      AND recording_key IN (SELECT value FROM json_each(${JSON.stringify(keys)}))`,
    )
    .map((row) => row.key);
};

/** A playlist's counted plays by play context id: in a window, of all time, and the latest. */
export interface KeptPlaylistPlays {
  readonly contextId: string;
  readonly recentPlays: number;
  readonly plays: number;
  readonly latestPlayAt: number | null;
}

/**
 * Each playlist play context's counted plays within [window] and of all
 * time, from the kept counts: null until an upgrade's history is seeded.
 */
export const keptPlaylistPlays = (
  db: LibraryDatabase,
  window: StatsWindow,
): KeptPlaylistPlays[] | null => {
  if (!keepsTotals(db)) return null;
  const kept = keptState(db);
  if (kept.seededThrough < kept.seedUntil) return null;
  const plan = keptTotalsPlan(window);
  const recent: SQL[] = [];
  const buckets = (span: number, from: number, to: number) =>
    sql`SELECT context_id, counted_plays FROM playlist_play_buckets
      WHERE span = ${span} AND bucket BETWEEN ${from} AND ${to}`;
  if (plan.blocks !== null) recent.push(buckets(1, plan.blocks.from, plan.blocks.to));
  for (const days of plan.days) recent.push(buckets(0, days.from, days.to));
  for (const plays of plan.plays)
    // The partial days' plays, through their start (not every playlist play through the context's index).
    recent.push(sql`SELECT context_id, 1 FROM play_events
      WHERE started_at BETWEEN ${plays.from} AND ${plays.to} AND counted
        AND +context_type = 'playlist' AND context_id IS NOT NULL`);
  const inWindow =
    recent.length === 0 ? sql`SELECT NULL, 0 WHERE false` : sql.join(recent, sql` UNION ALL `);
  return db.all<KeptPlaylistPlays>(sql`WITH
    total AS (
      SELECT context_id, sum(counted_plays) AS plays, max(latest_play_at) AS latest
      FROM playlist_play_buckets WHERE span = 1 GROUP BY context_id
    ),
    recent (context_id, plays) AS (${inWindow}),
    recent_total AS (SELECT context_id, sum(plays) AS plays FROM recent GROUP BY context_id)
    SELECT total.context_id AS "contextId", coalesce(recent_total.plays, 0) AS "recentPlays",
      total.plays AS plays, total.latest AS "latestPlayAt"
    FROM total LEFT JOIN recent_total ON recent_total.context_id = total.context_id`);
};

interface KeptTotal {
  readonly entity: string;
  readonly countedPlays: number;
  readonly listenedMs: number;
  readonly latestPlayAt: number;
}

/** The sums [plan] reads of every [kind] entity: its kept blocks and days, and its partial days' plays. */
export const creditedTotals = (
  db: LibraryDatabase,
  kind: CreditKind,
  plan: KeptTotalsPlan,
): KeptTotal[] => {
  const parts: SQL[] = [];
  const kept = (span: number, from: number, to: number) =>
    sql`SELECT entity, counted_plays, listened_ms, latest_play_at FROM credited_buckets
      WHERE kind = ${kind} AND span = ${span} AND bucket BETWEEN ${from} AND ${to}`;
  if (plan.blocks !== null) parts.push(kept(1, plan.blocks.from, plan.blocks.to));
  for (const days of plan.days) parts.push(kept(0, days.from, days.to));
  for (const plays of plan.plays)
    parts.push(sql`SELECT c.entity, c.weight, c.weight * e.listened_ms, e.started_at
      FROM play_events AS e
      -- The partial days' plays lead: each finds its song's credits by key.
      CROSS JOIN play_credits AS c ON c.song = ${sql.raw(songKeySql("e"))} AND c.kind = ${kind}
      WHERE e.counted AND e.started_at BETWEEN ${plays.from} AND ${plays.to}`);
  if (parts.length === 0) return [];
  return db.all<KeptTotal>(sql`WITH totals (entity, plays, listened, latest) AS (
      ${sql.join(parts, sql` UNION ALL `)})
    SELECT entity, sum(plays) AS "countedPlays", sum(listened) AS "listenedMs",
      max(latest) AS "latestPlayAt"
    FROM totals GROUP BY entity HAVING sum(plays) > 0`);
};

const LIBRARY_ID = /^\d+$/u;

/** The online entities of [kind] among [totals], by id: their kept sort key and item. */
const onlineEntities = <A>(db: LibraryDatabase, kind: CreditKind, totals: readonly KeptTotal[]) => {
  const ids = totals.flatMap((total) => (LIBRARY_ID.test(total.entity) ? [] : [total.entity]));
  return new Map(
    ids.length === 0
      ? []
      : db
          .all<{ entity: string; sortKey: string; item: string }>(
            sql`SELECT entity, sort_key AS "sortKey", item FROM played_entities
            WHERE kind = ${kind} AND entity IN (SELECT value FROM json_each(${JSON.stringify(ids)}))`,
          )
          .map((row) => [row.entity, { sortKey: row.sortKey, item: JSON.parse(row.item) as A }]),
  );
};

const libraryIds = (totals: readonly KeptTotal[]) =>
  totals.flatMap((total) => (LIBRARY_ID.test(total.entity) ? [Number(total.entity)] : []));

/** [totals] with their items: a Library row (only while it lists), or an online one. */
const withItems = <A extends { readonly id: number | string }>(
  totals: readonly KeptTotal[],
  rows: ReadonlyMap<number, A>,
  rowSort: (row: A) => string,
  online: ReadonlyMap<string, { sortKey: string; item: A }>,
): PlayedEntityTotal<A>[] =>
  totals.flatMap((total): PlayedEntityTotal<A>[] => {
    const sums = {
      countedPlays: total.countedPlays,
      listenedMs: total.listenedMs,
      latestPlayAt: total.latestPlayAt,
    };
    if (LIBRARY_ID.test(total.entity)) {
      const row = rows.get(Number(total.entity));
      return row === undefined ? [] : [{ ...sums, id: row.id, item: row, sortKey: rowSort(row) }];
    }
    const entity = online.get(total.entity);
    return entity === undefined
      ? []
      : [{ ...sums, id: total.entity, item: entity.item, sortKey: entity.sortKey }];
  });

/**
 * Each album's and artist's counted plays over [window], ranked, as
 * `summedPlayedTotals` sums them from the history; without [withAlbums], no
 * albums. Null while the kept totals owe anything (`keptTotalsSettled`).
 */
export const keptPlayedTotals = (
  db: LibraryDatabase,
  window: StatsWindow,
  withAlbums: boolean,
): PlayedEntityTotals | null => {
  if (!keptTotalsSettled(db)) return null;
  const plan = keptTotalsPlan(window);
  const artistTotals = creditedTotals(db, "artist", plan);
  const artistIds = libraryIds(artistTotals);
  const artists = withItems<PlayedArtist>(
    artistTotals,
    new Map(
      (artistIds.length === 0 ? [] : selectArtists(db, { ids: artistIds })).map((row) => [
        row.id,
        row,
      ]),
    ),
    (row) => (row as ArtistRow).sort,
    onlineEntities<PlayedArtist>(db, "artist", artistTotals),
  );
  if (!withAlbums) return { albums: [], artists: rankEntityPlays(artists, Infinity) };
  const albumTotals = creditedTotals(db, "album", plan);
  const albumIds = libraryIds(albumTotals);
  const albums = withItems<PlayedAlbum>(
    albumTotals,
    new Map(
      (albumIds.length === 0
        ? []
        : selectAlbums(
            db,
            sql`${schema.albums.id} IN (SELECT value FROM json_each(${JSON.stringify(albumIds)}))`,
          )
      ).map((row) => [row.id, row]),
    ),
    (row) => (row as AlbumRow).titleSort,
    onlineEntities<PlayedAlbum>(db, "album", albumTotals),
  );
  return {
    albums: rankEntityPlays(albums, Infinity),
    artists: rankEntityPlays(artists, Infinity),
  };
};

/**
 * Each song's counted plays over [window], in no order, as `songPlayTotals`
 * sums them: a Library song's (streamed plays that are its own included), a
 * streamed song's the Library hasn't. Null while the kept totals owe anything.
 */
export const keptSongPlayTotals = (
  db: LibraryDatabase,
  window: StatsWindow,
): SongPlayTotals[] | null => {
  if (!keptTotalsSettled(db)) return null;
  const totals = creditedTotals(db, "song", keptTotalsPlan(window));
  const tracks = totals.flatMap((total) =>
    total.entity.startsWith("t:") ? [Number(total.entity.slice(2))] : [],
  );
  const titles = new Map(
    tracks.length === 0
      ? []
      : db
          .all<{ id: number; titleSort: string }>(
            sql`SELECT id, title_sort AS "titleSort" FROM tracks
            WHERE id IN (SELECT value FROM json_each(${JSON.stringify(tracks)}))`,
          )
          .map((row) => [row.id, row.titleSort]),
  );
  const online = onlineEntities<unknown>(db, "song", totals);
  return totals.flatMap((total): SongPlayTotals[] => {
    const sums = {
      countedPlays: total.countedPlays,
      listenedMs: total.listenedMs,
      latestPlayAt: total.latestPlayAt,
    };
    if (total.entity.startsWith("t:")) {
      const id = Number(total.entity.slice(2));
      const titleSort = titles.get(id);
      return titleSort === undefined
        ? []
        : [{ song: { kind: "library", id }, sortKey: titleSort, ...sums }];
    }
    const videoId = total.entity.slice(3);
    return [{ song: { kind: "yt", videoId }, sortKey: online.get(total.entity)?.sortKey ?? "", ...sums }];
  });
};

/**
 * Stats' rows of counted plays over [window] per album and credited artist,
 * in no order, as `creditedPlayTotals` sums them. Null while the kept totals
 * owe anything.
 */
export const keptCreditedPlayTotals = (
  db: LibraryDatabase,
  window: StatsWindow,
): CreditedPlayTotals[] | null => {
  if (!keptTotalsSettled(db)) return null;
  const totals = creditedTotals(db, "credit", keptTotalsPlan(window));
  if (totals.length === 0) return [];
  return db
    .all<Omit<CreditedPlayTotals, "primary"> & { primary: number }>(
      sql`WITH totals AS (
        SELECT json_extract(value, '$[0]') AS entity, json_extract(value, '$[1]') AS plays,
          json_extract(value, '$[2]') AS listened, json_extract(value, '$[3]') AS latest
        FROM json_each(${JSON.stringify(
          totals.map((total) => [
            total.entity,
            total.countedPlays,
            total.listenedMs,
            total.latestPlayAt,
          ]),
        )})
      ), rows AS (
        SELECT totals.*, CAST(substr(entity, 1, instr(entity, ':') - 1) AS integer) AS album_id,
          substr(entity, instr(entity, ':') + 1) AS rest
        FROM totals
      )
      SELECT albums.id AS "albumId", albums.title_sort AS "albumSort",
        artists.id AS "artistId", artists.sort AS "artistSort",
        CAST(substr(rows.rest, instr(rows.rest, ':') + 1) AS integer) AS "primary",
        rows.plays AS "countedPlays", rows.listened AS "listenedMs", rows.latest AS "latestPlayAt"
      FROM rows
      JOIN albums ON albums.id = rows.album_id
      JOIN artists ON artists.id = CAST(substr(rows.rest, 1, instr(rows.rest, ':') - 1) AS integer)`,
    )
    .map((row) => ({ ...row, primary: row.primary === 1 }));
};
