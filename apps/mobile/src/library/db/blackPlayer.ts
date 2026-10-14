/**
 * Plays imported from BlackPlayer's track stats (Core's
 * `planBlackPlayerImport`): counted plays like Wave's own, marked
 * `imported_from = 'blackplayer'` so an import can tell which are in already.
 * Kept free of Expo so the store tests run them against a real SQLite.
 */
import type { BlackPlayerPlay, BlackPlayerTrack, ImportedPlays } from "@wave/core";
import { eq, inArray, sql } from "drizzle-orm";

import type { LibraryDatabase } from "./database.ts";
import * as schema from "./schema.ts";
import { playRecordingKey } from "./sync.ts";
import { filePath, hasFile } from "./tracks.ts";

/** Every track with what an import matches BlackPlayer's rows by. */
export const selectImportTracks = (db: LibraryDatabase): BlackPlayerTrack<number>[] => {
  const { albums, tracks } = schema;
  return (
    db
      .select({
        id: tracks.id,
        path: filePath,
        title: tracks.title,
        artist: tracks.artistCredit,
        album: albums.title,
        durationMs: tracks.durationMs,
      })
      .from(tracks)
      .innerJoin(albums, eq(albums.id, tracks.albumId))
      // Plays are matched to files: a missing song has none.
      .where(hasFile)
      .all()
  );
};

/** Each track's BlackPlayer plays already in the history, in no order. */
export const importedPlays = (db: LibraryDatabase): ImportedPlays<number>[] => {
  const { playEvents } = schema;
  return db
    .select({
      trackId: playEvents.trackId,
      plays: sql<number>`count(*)`,
      latestAt: sql<number>`max(${playEvents.startedAt})`,
    })
    .from(playEvents)
    .where(eq(playEvents.importedFrom, "blackplayer"))
    .groupBy(playEvents.trackId)
    .all();
};

/** Rows per insert: well under SQLite's limit on bound parameters. */
const CHUNK = 200;

/**
 * Adds imported plays to the history in one transaction: counted plays,
 * listened through (the song's length, as the player would have played it),
 * with no play context.
 */
export const saveImportedPlays = (
  db: LibraryDatabase,
  plays: readonly BlackPlayerPlay<number>[],
): void => {
  const { playEvents, tracks } = schema;
  const ids = [...new Set(plays.map((play) => play.trackId))];
  db.transaction((tx) => {
    const lengths = new Map<number, number>();
    for (let i = 0; i < ids.length; i += CHUNK) {
      for (const { id, durationMs } of tx
        .select({ id: tracks.id, durationMs: tracks.durationMs })
        .from(tracks)
        .where(inArray(tracks.id, ids.slice(i, i + CHUNK)))
        .all()) {
        lengths.set(id, durationMs);
      }
    }
    for (let i = 0; i < plays.length; i += CHUNK) {
      tx.insert(playEvents)
        .values(
          plays.slice(i, i + CHUNK).map((play) => {
            const length = lengths.get(play.trackId) ?? 0;
            return {
              trackId: play.trackId,
              startedAt: play.startedAt,
              listenedMs: length,
              durationMs: length > 0 ? length : null,
              endReason: "completed" as const,
              counted: true,
              importedFrom: "blackplayer" as const,
              recordingKey: playRecordingKey(play.trackId),
            };
          }),
        )
        .run();
    }
  });
};
