/**
 * Disliked songs (`schema.dislikes`, Core's `DislikedSong`): kept by the
 * identity favorites use, with each song as it was listed when disliked.
 * Core's `dislikes.ts` decides what a dislike changes; this only keeps them.
 * Each change is stamped for the Wave account (`stamped`), and a removed
 * dislike stays as a tombstone until the account has it (`syncRows.ts`).
 * Kept free of Expo for the store tests.
 */
import { ytTrackId, type DislikedSong } from "@wave/core";
import { and, desc, eq, inArray, like, notLike, sql } from "drizzle-orm";

import type { LibraryDatabase } from "./database.ts";
import * as schema from "./schema.ts";
import { stamped } from "./sync.ts";

/** SQLite caps the variables in one statement; batches stay well under it. */
const BATCH = 200;

/**
 * Keeps [songs] as disliked since [now], each once by its key: one disliked
 * already keeps when it was, and takes the song as it's listed now. One whose
 * dislike was removed is disliked anew, since [now].
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
          changedAt: now,
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
            dislikedAt: sql`CASE WHEN ${t.deleted} THEN ${now} ELSE ${t.dislikedAt} END`,
            deleted: false,
            ...stamped(t, now),
          },
        })
        .run();
    }
  });
};

/** Removes the dislikes kept under [keys] at [now]: each stays as a tombstone, as an unstarred favorite does. */
export const removeDislikes = (db: LibraryDatabase, keys: readonly string[], now: number): void => {
  const t = schema.dislikes;
  const ids = [...new Set(keys)];
  if (ids.length === 0) return;
  db.transaction((tx) => {
    for (let start = 0; start < ids.length; start += BATCH) {
      tx.update(t)
        .set({ deleted: true, ...stamped(t, now) })
        .where(and(inArray(t.songKey, ids.slice(start, start + BATCH)), eq(t.deleted, false)))
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
    .where(eq(schema.dislikes.deleted, false))
    .orderBy(desc(schema.dislikes.dislikedAt), desc(schema.dislikes.songKey))
    .all()
    .map(({ songKey, title, artists, durationMs, dislikedAt }) => ({
      key: songKey,
      title,
      artists: readArtists(artists),
      durationMs,
      dislikedAt,
    }));

/** A Library song a dislike is about: its Track id and the video it was downloaded from. */
export interface DislikedTrack {
  readonly id: number;
  readonly videoId: string;
}

/** How a YT Music song's dislike key starts (Core's `ytTrackId`). */
const YT_KEY = ytTrackId("");

/**
 * The Library's songs the dislikes kept are about, each with its video: one
 * disliked by its video (while streamed, or as Core's `dislikeKey` keeps a
 * downloaded song) and one disliked by its Track id that has a video. Core's
 * `dislikedSongs` reads them, so a dislike answers under both keys. A song
 * with no video is told by its Track id alone and isn't listed.
 */
export const selectDislikedTracks = (db: LibraryDatabase): DislikedTrack[] => {
  const { dislikes, tracks } = schema;
  const columns = { id: tracks.id, videoId: sql<string>`${tracks.videoId}` };
  const byVideo = db
    .select(columns)
    .from(dislikes)
    .innerJoin(tracks, sql`${tracks.videoId} = substr(${dislikes.songKey}, ${YT_KEY.length + 1})`)
    .where(and(eq(dislikes.deleted, false), like(dislikes.songKey, `${YT_KEY}%`)))
    .all();
  const byTrack = db
    .select(columns)
    .from(dislikes)
    .innerJoin(tracks, sql`${tracks.id} = CAST(${dislikes.songKey} AS INTEGER)`)
    .where(
      and(
        eq(dislikes.deleted, false),
        notLike(dislikes.songKey, `${YT_KEY}%`),
        sql`${tracks.videoId} IS NOT NULL`,
      ),
    )
    .all();
  return [...new Map([...byVideo, ...byTrack].map((track) => [track.id, track])).values()];
};
