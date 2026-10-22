/** Shared real-SQLite Library and history for #579 benches and work-count tests. */
import { sql } from "drizzle-orm";

import { createPlaylist } from "./playlists.ts";
import {
  addLibrary,
  closeTestDatabase,
  openTestDatabase,
  type TestDatabase,
} from "./testDatabase.ts";

export const FAST_AGAIN_DESKTOP =
  "Desktop: Node + sql.js (WebAssembly SQLite), not Hermes or the phone's SQLite.";
export const FAST_AGAIN_SIZES = [1000, 12000, 50000] as const;
export type FastAgainSize = (typeof FAST_AGAIN_SIZES)[number];
const EVENTS = { 1000: 10000, 12000: 54000, 50000: 200000 } as const;

export interface FixtureArtist {
  readonly artistId: number;
  readonly songIds: readonly number[];
  readonly albumIds: readonly number[];
}

export interface FastAgainFixture {
  readonly db: TestDatabase;
  readonly size: FastAgainSize;
  readonly playEvents: number;
  readonly now: number;
  readonly targets: { readonly small: FixtureArtist; readonly large: FixtureArtist };
  readonly songIds: readonly number[];
  readonly albumId: number;
  readonly genreId: number;
  readonly playlistId: number;
  readonly close: () => void;
}

/**
 * Exactly `size` songs, size/10 albums and size/25 artists. Two artists own
 * 20 and 300 of those songs; the others share the remainder. One song in 50
 * is missing its file, as in #306. The history is deterministic, includes
 * skips, and spans 90 days. Seeding and migrations are outside measurements.
 */
export const createFastAgainFixture = async (
  size: FastAgainSize = 1000,
): Promise<FastAgainFixture> => {
  if (!FAST_AGAIN_SIZES.includes(size)) throw new Error(`unsupported Library size: ${size}`);
  const db = await openTestDatabase();
  try {
    addLibrary(db, { tracks: size, artists: size / 25, albums: size / 10 });
    const artists = db.all<{ id: number }>(
      sql`SELECT id FROM artists WHERE key LIKE 'library-artist-%' ORDER BY id`,
    );
    const albums = db.all<{ id: number }>(
      sql`SELECT id FROM albums WHERE key LIKE 'library-album-%' ORDER BY id`,
    );
    const small = artists[0]!.id;
    const large = artists[1]!.id;
    const other = artists[2]!.id;
    db.transaction((tx) => {
      // Give the targets complete ten-song albums, without changing the size.
      tx.run(sql`UPDATE albums SET album_artist_id = CASE
        WHEN id BETWEEN ${albums[0]!.id} AND ${albums[1]!.id} THEN ${small}
        WHEN id BETWEEN ${albums[2]!.id} AND ${albums[31]!.id} THEN ${large}
        WHEN album_artist_id IN (${small}, ${large}) THEN ${other}
        ELSE album_artist_id END
        WHERE key LIKE 'library-album-%'`);
      tx.run(sql`UPDATE albums SET album_artist_credit =
        (SELECT name FROM artists WHERE id = albums.album_artist_id)
        WHERE key LIKE 'library-album-%'`);
      tx.run(sql`UPDATE tracks SET
        artist_id = (SELECT album_artist_id FROM albums WHERE id = tracks.album_id),
        artist_credit = (SELECT album_artist_credit FROM albums WHERE id = tracks.album_id)`);
      tx.run(sql`DELETE FROM track_artists`);
      tx.run(sql`INSERT INTO track_artists (track_id, artist_id, position)
        SELECT id, artist_id, 0 FROM tracks`);
      tx.run(sql`DELETE FROM album_artists`);
      tx.run(sql`DELETE FROM albums WHERE id NOT IN (SELECT album_id FROM tracks)`);
      tx.run(sql`DELETE FROM artists WHERE id NOT IN (SELECT artist_id FROM tracks)`);
      tx.run(sql`INSERT INTO album_artists (album_id, artist_id, position)
        SELECT id, album_artist_id, 0 FROM albums`);
      tx.run(sql`UPDATE tracks SET video_id = printf('%011d', id) WHERE id % 20 = 0`);
    });
    const songIds = db.all<{ id: number }>(sql`SELECT id FROM tracks ORDER BY id`).map((r) => r.id);
    const now = Date.UTC(2026, 9, 1, 12);
    const playEvents = EVENTS[size];
    db.run(sql`WITH RECURSIVE n(x) AS (VALUES(0) UNION ALL
      SELECT x + 1 FROM n WHERE x < ${playEvents - 1})
      INSERT INTO play_events (track_id, started_at, listened_ms, duration_ms,
        end_reason, counted, source, recording_key, sync_id)
      SELECT ${songIds[0]!} + x % ${size},
        ${now} - (${playEvents} - x) * ${Math.floor((90 * 86400000) / playEvents)},
        CASE WHEN x % 5 = 0 THEN 5000 ELSE 180000 END, 180000,
        CASE WHEN x % 5 = 0 THEN 'skipped' ELSE 'completed' END,
        x % 5 <> 0, 'phone', 'library-recording-' || (x % ${size}),
        'fast-again-play-' || x FROM n`);
    db.run(sql`INSERT INTO favorites (track_id, added_at, changed_at, phone_id)
      SELECT id, ${now - 86400000}, ${now - 86400000}, 'desktop-fixture'
      FROM tracks WHERE id % 10 = 0`);
    const { playlistId } = createPlaylist(
      db,
      "Fast again playlist",
      songIds.slice(0, 50).map((trackId) => ({ source: "library" as const, trackId })),
      now,
    );
    const target = (artistId: number): FixtureArtist => ({
      artistId,
      songIds: db
        .all<{ id: number }>(sql`SELECT id FROM tracks WHERE artist_id = ${artistId} ORDER BY id`)
        .map((r) => r.id),
      albumIds: db
        .all<{ id: number }>(
          sql`SELECT id FROM albums WHERE album_artist_id = ${artistId} ORDER BY id`,
        )
        .map((r) => r.id),
    });
    return {
      db,
      size,
      playEvents,
      now,
      targets: { small: target(small), large: target(large) },
      songIds,
      albumId: albums[0]!.id,
      genreId: db.get<{ id: number }>(sql`SELECT id FROM genres ORDER BY id LIMIT 1`).id,
      playlistId,
      close: () => closeTestDatabase(db),
    };
  } catch (error) {
    closeTestDatabase(db);
    throw error;
  }
};
