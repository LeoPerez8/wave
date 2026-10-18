/**
 * Pending favorites (`schema.pendingFavorites`, Core's `PendingFavorite`):
 * the liked songs Also add to Favorites stars once they enter the Library.
 * The YT Music import keeps them (`addPendingFavorites`); `saveBatch`, where
 * downloads and scans write songs to the Library, settles them
 * (`settlePendingFavorites`). Kept free of Expo for the store tests.
 */
import {
  settlePendingFavorites as settle,
  type EnteringSong,
  type PendingFavorite,
} from "@wave/core";
import { inArray, sql } from "drizzle-orm";

import type { LibraryDatabase } from "./database.ts";
import { setFavorites } from "./playHistory.ts";
import * as schema from "./schema.ts";

/** SQLite caps the variables in one statement; batches stay well under it. */
const BATCH = 200;

/**
 * Keeps [songs] as pending favorites, each once by its video: one kept
 * already takes the song as YouTube Music now lists it.
 */
export const addPendingFavorites = (
  db: LibraryDatabase,
  songs: readonly PendingFavorite[],
  now: number,
): void => {
  const t = schema.pendingFavorites;
  const rows = [
    ...new Map(
      songs.map((song) => [
        song.videoId,
        {
          videoId: song.videoId,
          title: song.title,
          artists: JSON.stringify(song.artists),
          durationMs: song.durationMs,
          addedAt: now,
        },
      ]),
    ).values(),
  ];
  if (rows.length === 0) return;
  db.transaction((tx) => {
    for (let start = 0; start < rows.length; start += BATCH) {
      tx.insert(t)
        .values(rows.slice(start, start + BATCH))
        .onConflictDoUpdate({
          target: t.videoId,
          set: {
            title: sql.raw(`excluded."title"`),
            artists: sql.raw(`excluded."artists"`),
            durationMs: sql.raw(`excluded."duration_ms"`),
          },
        })
        .run();
    }
  });
};

/**
 * Forgets the pending favorites of videos [videoIds]: their stars were taken
 * off before their files arrived, so the songs come in unstarred.
 */
export const removePendingFavorites = (db: LibraryDatabase, videoIds: readonly string[]): void => {
  const t = schema.pendingFavorites;
  const ids = [...new Set(videoIds)];
  if (ids.length === 0) return;
  db.transaction((tx) => {
    for (let start = 0; start < ids.length; start += BATCH) {
      tx.delete(t)
        .where(inArray(t.videoId, ids.slice(start, start + BATCH)))
        .run();
    }
  });
};

/** The artists kept as [stored], or none when they can't be read. */
const readArtists = (stored: string): string[] => {
  try {
    const value: unknown = JSON.parse(stored);
    return Array.isArray(value)
      ? value.filter((name): name is string => typeof name === "string")
      : [];
  } catch {
    return [];
  }
};

/** Every pending favorite kept. */
export const selectPendingFavorites = (db: LibraryDatabase): PendingFavorite[] =>
  db
    .select()
    .from(schema.pendingFavorites)
    .all()
    .map(({ videoId, title, artists, durationMs }) => ({
      videoId,
      title,
      artists: readArtists(artists),
      durationMs,
    }));

/**
 * Stars the [songs] just written to the Library that are pending favorites
 * (Core's `settlePendingFavorites`) and forgets those favorites, in [db]'s
 * transaction. Returns the tracks starred.
 */
export const settlePendingFavorites = (
  db: LibraryDatabase,
  songs: readonly EnteringSong[],
  now: number,
): readonly number[] => {
  if (songs.length === 0) return [];
  const t = schema.pendingFavorites;
  if (db.select({ videoId: t.videoId }).from(t).limit(1).get() === undefined) return [];
  const { star, settled } = settle(selectPendingFavorites(db), songs);
  if (settled.length === 0) return [];
  setFavorites(db, star, true, now);
  for (let start = 0; start < settled.length; start += BATCH) {
    db.delete(t)
      .where(inArray(t.videoId, settled.slice(start, start + BATCH)))
      .run();
  }
  return star;
};
