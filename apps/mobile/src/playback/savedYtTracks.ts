import { queuedYtTracks, type QueueEntry } from "@wave/core";
import { Storage } from "expo-sqlite/kv-store";

import { queueTracks, type QueueTrack } from "./queueTracks";

/**
 * YT Music songs in the queue: the details the queue keeps of them (they
 * aren't in the Library), saved with the queue so a cold start can play them
 * again (`PlaybackPersistence`), and a queue picked back up from the player can
 * load them (`Queue`).
 */

const KEY = "playback.ytTracks";

/** The YT Music songs' details saved with the last queue; none when nothing readable is. */
export const savedYtQueueTracks = (): readonly QueueTrack[] => {
  try {
    const stored = Storage.getItemSync(KEY);
    if (stored === null) return [];
    const parsed: unknown = JSON.parse(stored);
    return Array.isArray(parsed) ? parsed.filter(isQueueTrack) : [];
  } catch {
    return [];
  }
};

/** Saves the details of the YT Music songs in [entries] (Core's `queuedYtTracks`), dropping the rest. */
export const saveYtQueueTracks = (entries: readonly QueueEntry[]): void => {
  const tracks = queuedYtTracks(entries, queueTracks.get());
  if (tracks.length === 0) Storage.removeItemSync(KEY);
  else Storage.setItemSync(KEY, JSON.stringify(tracks));
};

const isQueueTrack = (value: unknown): value is QueueTrack => {
  if (typeof value !== "object" || value === null) return false;
  const track = value as Record<string, unknown>;
  return (
    typeof track["id"] === "string" &&
    typeof track["path"] === "string" &&
    typeof track["title"] === "string" &&
    typeof track["artist"] === "string"
  );
};
