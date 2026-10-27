import { eq } from "drizzle-orm";
import type { QueueWrite } from "../../playback/queuePersistence.ts";
import type { LibraryDatabase } from "./database.ts";
import { savedPlayback } from "./schema.ts";

const ID = 1;

/** Old rows have no separate index or metadata and keep reading their original JSON. */
export const loadPlayback = (db: LibraryDatabase): { queue: string; positionMs: number } | null => {
  const row = db.select().from(savedPlayback).where(eq(savedPlayback.id, ID)).get();
  if (row === undefined) return null;
  if (row.queueIndex === null && row.metadata === null) return row;
  const state = JSON.parse(row.queue) as object;
  return {
    queue: JSON.stringify({
      ...state,
      ...(row.metadata === null ? {} : JSON.parse(row.metadata) as object),
      ...(row.queueIndex === null ? {} : { index: row.queueIndex }),
    }),
    positionMs: row.positionMs,
  };
};

/** Writes only the supplied parts. Entry saves establish the row on the first queue. */
export const savePlayback = (db: LibraryDatabase, write: QueueWrite, now: number): void => {
  if (Object.keys(write).length === 0) return;
  const row = {
    ...(write.queue === undefined ? {} : { queue: write.queue }),
    ...(write.metadata === undefined ? {} : { metadata: write.metadata }),
    ...(write.index === undefined ? {} : { queueIndex: write.index }),
    ...(write.positionMs === undefined ? {} : { positionMs: Math.round(write.positionMs) }),
    updatedAt: now,
  };
  if (write.queue !== undefined) {
    db.insert(savedPlayback).values({ id: ID, ...row, queue: write.queue })
      .onConflictDoUpdate({ target: savedPlayback.id, set: row }).run();
  } else {
    db.update(savedPlayback).set(row).where(eq(savedPlayback.id, ID)).run();
  }
};
