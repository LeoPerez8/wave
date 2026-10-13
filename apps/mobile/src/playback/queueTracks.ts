/**
 * What the queue knows about its tracks: everything the player needs to play
 * them and the queue rows need to show them. The Queue service learns a
 * track's details with the command that queues it, before the queue changes,
 * so Up Next renders filled rows on its first frame. Kept free of Expo so it
 * runs under plain Node tests.
 */
import type { QueueEntry } from "@wave/core";

import { makeExternalStore } from "../lib/externalStore.ts";
import type { SongRow } from "../library/LibraryStore.ts";

/** What the player and the queue rows need to know about a track. */
export interface QueueTrack {
  readonly id: string;
  readonly path: string;
  readonly title: string;
  readonly artist: string;
  readonly album: string | null;
  readonly artworkPath: string | null;
  /** Small artwork for the queue rows. */
  readonly thumbPath: string | null;
}

/** A library song as the queue needs it. */
export const toQueueTrack = (song: SongRow): QueueTrack => ({
  id: String(song.id),
  path: song.path,
  title: song.title,
  artist: song.artist,
  album: song.album,
  artworkPath: song.artworkPath,
  thumbPath: song.thumbPath,
});

/** The queued tracks by id. Kept for the app's lifetime, so every queue open reads it. */
export const queueTracks = makeExternalStore<ReadonlyMap<string, QueueTrack>>(new Map());

/**
 * Adds [tracks] to what the queue knows; `forgetOthers` (a new play) drops
 * the old queue's tracks first.
 */
export const learnQueueTracks = (
  tracks: readonly QueueTrack[],
  options: { readonly forgetOthers?: boolean } = {},
): void => {
  if (options.forgetOthers === true) {
    requested.clear();
    queueTracks.set(new Map(tracks.map((track) => [track.id, track])));
    return;
  }
  if (tracks.length === 0) return;
  const next = new Map(queueTracks.get());
  for (const track of tracks) next.set(track.id, track);
  queueTracks.set(next);
};

/** Ids looked up in the library and not failed, so they aren't asked for again. */
const requested = new Set<string>();

/**
 * The track ids in [entries] the queue doesn't know and hasn't asked the
 * library for yet (a queue picked back up from the player after JS restarted
 * comes without its tracks). Marks them asked for: each is looked up once.
 */
export const tracksToLookUp = (entries: readonly QueueEntry[]): readonly string[] => {
  const known = queueTracks.get();
  const ids: string[] = [];
  for (const { trackId } of entries) {
    if (known.has(trackId) || requested.has(trackId)) continue;
    requested.add(trackId);
    ids.push(trackId);
  }
  return ids;
};

/** A lookup that didn't go through: its ids are asked for again next time. */
export const lookupFailed = (ids: readonly string[]): void => {
  for (const id of ids) requested.delete(id);
};
