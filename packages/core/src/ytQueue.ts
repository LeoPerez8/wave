/**
 * YT Music songs in the queue: streamed songs sit in the queue beside Library
 * tracks (Play, Play Next, Add to Queue), go by their `yt:` track ids, and
 * are played from YouTube Music at play time. They aren't Library tracks:
 * nothing about them is looked up in the Library, they aren't on record in
 * play history or stats (`trackPlays`), and their details are kept with the
 * queue so a cold start can pick them back up.
 */

import { isUnsearchedTrackId } from "./playlistEntries.ts";
import type { QueueEntry } from "./queue.ts";
import { parseTrackId } from "./ytMusic.ts";

/** Whether [trackId] isn't the Library's: a YT Music song, or an unsearched one (`unsearchedTrackId`). */
const streamedTrackId = (trackId: string): boolean =>
  parseTrackId(trackId)?.kind === "yt" || isUnsearchedTrackId(trackId);

/** The Library tracks among [trackIds] (a queue's), each once, for looking them up. */
export const libraryTrackIds = (trackIds: readonly string[]): number[] => {
  const ids = new Set<number>();
  for (const trackId of trackIds) {
    const track = parseTrackId(trackId);
    if (track?.kind === "library") ids.add(track.id);
  }
  return [...ids];
};

/**
 * The details to keep with a queue for a cold start: those of its YT Music
 * and unsearched songs (the Library has the others), each once, in queue
 * order. Songs whose details aren't in [known] are skipped.
 */
export const queuedYtTracks = <T>(
  entries: readonly QueueEntry[],
  known: ReadonlyMap<string, T>,
): T[] => {
  const kept = new Map<string, T>();
  for (const { trackId } of entries) {
    if (kept.has(trackId) || !streamedTrackId(trackId)) continue;
    const track = known.get(trackId);
    if (track !== undefined) kept.set(trackId, track);
  }
  return [...kept.values()];
};

/**
 * Why the player stopped on a YT Music song, as the native player reports it:
 * no network, YT Music turned off, YouTube won't stream that song, or it
 * failed otherwise. Any other code (or none) is a Library file that failed.
 */
export type PlayerErrorCode = "ytOffline" | "ytDisabled" | "ytUnavailable" | "ytFailed";

const NOTICES: { readonly [C in PlayerErrorCode]: string } = {
  ytOffline: "You're offline. YT Music songs need the network.",
  ytDisabled: "YT Music is off in Settings.",
  ytUnavailable: "YT Music won't stream this song.",
  ytFailed: "YT Music didn't send this song. Try again.",
};

/**
 * The line the mini player and Now Playing show in place of the artist when
 * playback stopped on an error. The player pauses on a YT Music song that
 * can't stream; the Library's songs around it still play.
 */
export const playerErrorNotice = (code: string | null): string =>
  code !== null && Object.hasOwn(NOTICES, code)
    ? NOTICES[code as PlayerErrorCode]
    : "Couldn't play this file";

/** What a saved queue can still play once Wave starts again. */
export interface RestorableTracks {
  /** The Library tracks that are still there. */
  readonly libraryIds: ReadonlySet<number>;
  /** The YT Music songs (by track id) whose details were saved with the queue. */
  readonly savedYtTracks: ReadonlySet<string>;
  /** Whether YT Music is on in Settings; off, its songs can't play. */
  readonly ytMusicOn: boolean;
}

/**
 * Whether a saved queue's track can be restored (for `restorePlayback`): a
 * Library track still in the Library, or a YT Music or unsearched song whose
 * details were saved, while YT Music is on.
 */
export const restorableTrack =
  ({ libraryIds, savedYtTracks, ytMusicOn }: RestorableTracks) =>
  (trackId: string): boolean => {
    if (isUnsearchedTrackId(trackId)) return ytMusicOn && savedYtTracks.has(trackId);
    const track = parseTrackId(trackId);
    if (track === null) return false;
    return track.kind === "library"
      ? libraryIds.has(track.id)
      : ytMusicOn && savedYtTracks.has(trackId);
  };
