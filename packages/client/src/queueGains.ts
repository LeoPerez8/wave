/**
 * Normalize Volume's gain for a queue entry, read from the Library
 * (docs/spec.md › Normalize Volume): album gain for an album's own songs in
 * its queue with shuffle off, else the song's own value (its tags', or Wave's
 * measurement), else the Library's typical gain. The audio engine settles the
 * gain as the song starts, and plays it only while the switch is on.
 */
import {
  entryGain,
  parseTrackId,
  typicalGain,
  type AlbumLoudness,
  type QueueEntry,
  type QueueState,
} from "@wave/core";

import type { LibraryDatabase } from "./db/database.ts";
import { selectAlbumLoudness, selectLibraryGains, selectSongLoudness } from "./db/loudness.ts";

export interface QueueGains {
  /** The gain in dB [entry] of [queue] plays at. */
  readonly gainDb: (
    queue: QueueState,
    entry: Pick<QueueEntry, "trackId" | "contextIndex">,
  ) => number;
  /** A song's value changed (a measurement, a scan): the typical gain is worked out again. */
  readonly changed: () => void;
}

/** The Library album a queue plays, for album gain; null for any other context. */
export const queueAlbum = (db: LibraryDatabase, queue: QueueState): AlbumLoudness | null => {
  if (queue.context?.kind !== "album" || queue.context.id === null) return null;
  const id = Number(queue.context.id);
  return Number.isInteger(id) ? selectAlbumLoudness(db, id) : null;
};

export const createQueueGains = (db: LibraryDatabase): QueueGains => {
  // Every Library song's gain is read for the median, so it's kept until a value changes.
  let typical: number | undefined;
  return {
    gainDb: (queue, entry) => {
      const track = parseTrackId(entry.trackId);
      const song =
        track?.kind === "library" ? selectSongLoudness(db, [track.id]).get(track.id) : undefined;
      const known = entryGain(queue, entry, song ?? {}, queueAlbum(db, queue));
      if (known !== null) return known.gainDb;
      typical ??= typicalGain(selectLibraryGains(db));
      return typical;
    },
    changed: () => {
      typical = undefined;
    },
  };
};
