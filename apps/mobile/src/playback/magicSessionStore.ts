import { parseMagicSession, type MagicSession } from "@wave/core";
import { Storage } from "expo-sqlite/kv-store";

import { makeExternalStore } from "@wave/client/externalStore";

/** Where the Magic Queue session is saved, beside the queue. */
export const MAGIC_SESSION_KEY = "playback.magicQueue";

const readSaved = (): MagicSession | null => {
  try {
    const stored = Storage.getItemSync(MAGIC_SESSION_KEY);
    return stored === null ? null : parseMagicSession(JSON.parse(stored));
  } catch {
    return null;
  }
};

/**
 * The latest Magic Queue session, kept after something else plays so Undo
 * on "New queue playing" can go back to it; it's only under way while the
 * queue is its own (`activeMagicSession`). Its own module, so play history
 * reads it (Core's `recordedPlayContext`) without importing the Magic Queue.
 */
export const magicSession = makeExternalStore<MagicSession | null>(readSaved());
