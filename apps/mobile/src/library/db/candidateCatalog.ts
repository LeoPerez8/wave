/**
 * The candidate catalog as the library database keeps it
 * (`schema.candidateSongs`, `schema.candidateRadios`): what a radio or an
 * artist page adds and what leaves are Core's (`catalogSeen`,
 * `catalogLeaving`); this reads the songs a page brings again, writes what
 * Core says and deletes what leaves. Kept free of Expo for the store tests.
 */
import {
  catalogLeaving,
  catalogSeen,
  readPlaylistYtSong,
  writePlaylistYtSong,
  type CatalogPage,
  type CatalogRadio,
  type CatalogSong,
} from "@wave/core";
import { inArray, lte, sql } from "drizzle-orm";

import { chunks } from "./chunks.ts";
import type { LibraryDatabase } from "./database.ts";
import * as schema from "./schema.ts";

/** Rows per insert: four values each, well under SQLite's limit per statement. */
const ROWS_PER_INSERT = 100;

/** [column]'s value in the row an upsert tried to insert. */
const excluded = (column: { readonly name: string }) =>
  sql`excluded.${sql.identifier(column.name)}`;

/** The radios of the songs [videoIds] (every song's with null), by video id. */
const radiosOf = (
  db: LibraryDatabase,
  videoIds: readonly string[] | null,
): Map<string, CatalogRadio[]> => {
  const t = schema.candidateRadios;
  const rows =
    videoIds === null
      ? db.select().from(t).all()
      : chunks(videoIds).flatMap((ids) => db.select().from(t).where(inArray(t.videoId, ids)).all());
  const radios = new Map<string, CatalogRadio[]>();
  for (const row of rows) {
    const radio = { seed: row.seedKey, seedName: row.seedName, lastSeenAt: row.lastSeenAt };
    const of = radios.get(row.videoId);
    if (of === undefined) radios.set(row.videoId, [radio]);
    else of.push(radio);
  }
  return radios;
};

/**
 * The catalog's songs [videoIds] (every song with null), with their radios;
 * one that can't be read is left out.
 */
const catalogSongs = (db: LibraryDatabase, videoIds: readonly string[] | null): CatalogSong[] => {
  const t = schema.candidateSongs;
  const rows =
    videoIds === null
      ? db.select().from(t).all()
      : chunks(videoIds).flatMap((ids) => db.select().from(t).where(inArray(t.videoId, ids)).all());
  const radios = radiosOf(db, videoIds);
  return rows.flatMap((row) => {
    const song = readPlaylistYtSong(row.song);
    if (song === null) return [];
    const { firstSeenAt, lastSeenAt } = row;
    return [{ song, firstSeenAt, lastSeenAt, radios: radios.get(row.videoId) ?? [] }];
  });
};

/** Writes [seen] over what the catalog had of its songs. */
const writeCandidates = (db: LibraryDatabase, seen: readonly CatalogSong[]): void => {
  const songs = schema.candidateSongs;
  const radios = schema.candidateRadios;
  for (const entries of chunks(seen, ROWS_PER_INSERT)) {
    db.insert(songs)
      .values(
        entries.map(({ song, firstSeenAt, lastSeenAt }) => ({
          videoId: song.videoId,
          song: writePlaylistYtSong(song),
          firstSeenAt,
          lastSeenAt,
        })),
      )
      .onConflictDoUpdate({
        target: songs.videoId,
        set: {
          song: excluded(songs.song),
          firstSeenAt: excluded(songs.firstSeenAt),
          lastSeenAt: excluded(songs.lastSeenAt),
        },
      })
      .run();
  }
  const radioRows = seen.flatMap(({ song, radios: of }) =>
    of.map((radio) => ({
      videoId: song.videoId,
      seedKey: radio.seed,
      seedName: radio.seedName,
      lastSeenAt: radio.lastSeenAt,
    })),
  );
  for (const rows of chunks(radioRows, ROWS_PER_INSERT)) {
    db.insert(radios)
      .values(rows)
      .onConflictDoUpdate({
        target: [radios.videoId, radios.seedKey],
        set: { seedName: excluded(radios.seedName), lastSeenAt: excluded(radios.lastSeenAt) },
      })
      .run();
  }
};

/** Deletes what Core says leaves the catalog at [now] (`catalogLeaving`). */
const pruneCandidates = (db: LibraryDatabase, now: number): void => {
  const songs = schema.candidateSongs;
  const radios = schema.candidateRadios;
  const leaving = catalogLeaving(
    db.select({ videoId: songs.videoId, lastSeenAt: songs.lastSeenAt }).from(songs).all(),
    now,
  );
  // Their radios go with them (ON DELETE CASCADE).
  for (const ids of chunks(leaving.songs)) {
    db.delete(songs).where(inArray(songs.videoId, ids)).run();
  }
  db.delete(radios).where(lte(radios.lastSeenAt, leaving.radiosSeenBefore)).run();
};

/**
 * Adds what [page] brought at [now] to the catalog, in one transaction: its
 * songs as Core merges them with what the catalog had of them
 * (`catalogSeen`), then takes out what leaves (`catalogLeaving`).
 */
export const addCandidates = (db: LibraryDatabase, page: CatalogPage, now: number): void => {
  db.transaction((tx) => {
    const ids = [...new Set(page.songs.map((song) => song.videoId))];
    const known = new Map(catalogSongs(tx, ids).map((entry) => [entry.song.videoId, entry]));
    writeCandidates(tx, catalogSeen(known, page, now));
    pruneCandidates(tx, now);
  });
};

/** The whole catalog: every song with its radios; one that can't be read is left out. */
export const selectCandidateCatalog = (db: LibraryDatabase): CatalogSong[] =>
  catalogSongs(db, null);
