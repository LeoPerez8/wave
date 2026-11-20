/**
 * Disliked songs (`schema.dislikes`, Core's `DislikedSong`): kept by the
 * identity favorites use, with each song as it was listed when disliked.
 * Core's `dislikes.ts` decides what a dislike changes; this only keeps them.
 * Kept free of Expo for the store tests.
 */
import type { DislikedSong } from "@wave/core";
import { desc, inArray, sql } from "drizzle-orm";

import type { LibraryDatabase } from "./database.ts";
import * as schema from "./schema.ts";

/** SQLite caps the variables in one statement; batches stay well under it. */
const BATCH = 200;

/**
 * Keeps [songs] as disliked since [now], each once by its key: one disliked
 * already keeps when it was, and takes the song as it's listed now.
 */
export const setDislikes = (
  db: LibraryDatabase,
  songs: readonly Omit<DislikedSong, "dislikedAt">[],
  now: number,
): void => {
  const t = schema.dislikes;
  const rows = [
    ...new Map(
      songs.map((song) => [
        song.key,
        {
          songKey: song.key,
          title: song.title,
          artists: JSON.stringify(song.artists),
          durationMs: song.durationMs,
          dislikedAt: now,
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
          target: t.songKey,
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

/** Forgets the dislikes kept under [keys]. */
export const removeDislikes = (db: LibraryDatabase, keys: readonly string[]): void => {
  const t = schema.dislikes;
  const ids = [...new Set(keys)];
  if (ids.length === 0) return;
  db.transaction((tx) => {
    for (let start = 0; start < ids.length; start += BATCH) {
      tx.delete(t)
        .where(inArray(t.songKey, ids.slice(start, start + BATCH)))
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

/** Every dislike kept, the newest first. */
export const selectDislikes = (db: LibraryDatabase): DislikedSong[] =>
  db
    .select()
    .from(schema.dislikes)
    .orderBy(desc(schema.dislikes.dislikedAt), desc(schema.dislikes.songKey))
    .all()
    .map(({ songKey, title, artists, durationMs, dislikedAt }) => ({
      key: songKey,
      title,
      artists: readArtists(artists),
      durationMs,
      dislikedAt,
    }));
