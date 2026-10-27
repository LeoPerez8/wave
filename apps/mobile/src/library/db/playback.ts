import type { QueueWrite, SavedQueueParts } from "@wave/core";
import { eq } from "drizzle-orm";

import type { LibraryDatabase } from "./database.ts";
import { savedPlayback } from "./schema.ts";

const ID = 1;

/** The saved queue's parts (see Core's `savedQueueState`) and where its current entry was. */
export interface SavedPlayback {
  readonly parts: SavedQueueParts;
  readonly positionMs: number;
}

export const loadPlayback = (db: LibraryDatabase): SavedPlayback | null => {
  const row = db
    .select({
      queue: savedPlayback.queue,
      metadata: savedPlayback.metadata,
      index: savedPlayback.queueIndex,
      positionMs: savedPlayback.positionMs,
    })
    .from(savedPlayback)
    .where(eq(savedPlayback.id, ID))
    .get();
  if (row === undefined) return null;
  const { positionMs, ...parts } = row;
  return { parts, positionMs };
};

/**
 * Writes only the parts [write] has (Core's `queueWrite`): a skip updates the
 * index and position, leaving the queue's JSON alone. The first queue makes the row.
 */
export const savePlayback = (db: LibraryDatabase, write: QueueWrite, now: number): void => {
  const row = {
    ...(write.metadata === undefined ? {} : { metadata: write.metadata }),
    ...(write.index === undefined ? {} : { queueIndex: write.index }),
    ...(write.positionMs === undefined ? {} : { positionMs: Math.round(write.positionMs) }),
  };
  if (write.queue !== undefined) {
    const set = { ...row, queue: write.queue, updatedAt: now };
    db.insert(savedPlayback)
      .values({ id: ID, ...set })
      .onConflictDoUpdate({ target: savedPlayback.id, set })
      .run();
  } else if (Object.keys(row).length > 0) {
    db.update(savedPlayback)
      .set({ ...row, updatedAt: now })
      .where(eq(savedPlayback.id, ID))
      .run();
  }
};
