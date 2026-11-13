import type { QueueState } from "./queue.ts";
import { MAGIC_QUEUE_CONTEXT, type MagicSession } from "./magicQueue.ts";
import { RECAP_PLAY_CONTEXT } from "./recapMusic.ts";
import type { SleepTimer } from "./sleepTimer.ts";

/** The source whose songs and name the app reads when a queue continues. */
export type QueueContinuationSeed =
  | { readonly kind: "album" | "playlist" | "artist" | "track"; readonly id: string }
  /** Every entry in a loose queue, including History; `id` names the list by its last song. */
  | { readonly kind: "list"; readonly id: string; readonly trackIds: readonly string[] }
  /** A Discover mix id, with the played queue saved for when its mix is gone. */
  | { readonly kind: "discoverMix"; readonly id: string; readonly trackIds: readonly string[] };

/** What tells how much of a queue is left to play, against the Buffer setting. */
export interface QueueTimeAhead {
  /** Settings › Playback › Buffer, in ms (`streamBufferMs`). */
  readonly bufferMs: number;
  /** A song's length by track id; null while it isn't known. */
  readonly durationMs: (trackId: string) => number | null;
}

/**
 * How far the songs after the current one reach against the Buffer: whether
 * they play for at least as long ("covered"), for less ("short"), or which
 * entry's unknown length leaves that open. It stops at the first song that
 * settles it, so a long queue costs no more than a short one.
 */
const songsAhead = (
  state: QueueState,
  ahead: QueueTimeAhead,
): "covered" | "short" | { readonly unknownAt: number } => {
  let total = 0;
  for (let i = state.index + 1; i < state.entries.length; i++) {
    if (total >= ahead.bufferMs) return "covered";
    const duration = ahead.durationMs(state.entries[i]!.trackId);
    if (duration === null) return { unknownAt: i };
    total += duration;
  }
  return total >= ahead.bufferMs ? "covered" : "short";
};

/** How many songs' lengths `queueLengthsToRead` asks for at a time. */
const LENGTHS_AT_A_TIME = 20;

/**
 * The songs whose lengths the app reads next for `queueContinuation`, by
 * track id: from the first one after the current song whose length is unknown
 * and still within the Buffer's reach, [limit] of them at most. None once
 * the known lengths settle it, or while the last song plays.
 */
export const queueLengthsToRead = (
  state: QueueState,
  ahead: QueueTimeAhead,
  limit: number = LENGTHS_AT_A_TIME,
): string[] => {
  if (state.entries[state.index] === undefined) return [];
  const reach = songsAhead(state, ahead);
  if (typeof reach === "string") return [];
  return state.entries
    .slice(reach.unknownAt, reach.unknownAt + limit)
    .map((entry) => entry.trackId);
};

/**
 * A queue starts its Magic Queue, using the list it came from, when its last
 * song starts. With [ahead] it starts sooner, so the player can load the new
 * songs ahead: when a song starts and the songs after it play for less than
 * the Buffer, which is the song during which the time left goes under it.
 * Where that song is playing doesn't count, so the answer only changes with
 * the queue, the Buffer and the settings, never with the clock.
 */
export const queueContinuation = (
  state: QueueState,
  {
    enabled = true,
    sleepTimer = null,
    ahead = null,
  }: {
    readonly enabled?: boolean;
    readonly sleepTimer?: SleepTimer | null;
    readonly ahead?: QueueTimeAhead | null;
  } = {},
): QueueContinuationSeed | null => {
  if (
    !enabled ||
    sleepTimer?.type === "endOfQueue" ||
    sleepTimer?.type === "endOfTrack" ||
    state.repeat !== "off" ||
    state.context?.kind === MAGIC_QUEUE_CONTEXT ||
    state.context?.kind === RECAP_PLAY_CONTEXT.kind
  )
    return null;
  const last = state.entries.at(-1);
  if (last === undefined || state.entries[state.index] === undefined) return null;
  if (
    state.index !== state.entries.length - 1 &&
    (ahead === null || songsAhead(state, ahead) !== "short")
  )
    return null;
  const context = state.context;
  if (
    context?.id != null &&
    (context.kind === "album" || context.kind === "playlist" || context.kind === "artist")
  )
    return { kind: context.kind, id: context.id };
  if (context?.kind === "discoverMix" && context.id !== null)
    return {
      kind: "discoverMix",
      id: context.id,
      trackIds: state.entries.map((entry) => entry.trackId),
    };
  if (state.entries.length > 1)
    return {
      kind: "list",
      id: last.trackId,
      trackIds: state.entries.map((entry) => entry.trackId),
    };
  return { kind: "track", id: last.trackId };
};

/** Continue after the existing songs, keeping them out of every later batch. */
export const continueMagicQueue = (session: MagicSession, state: QueueState): MagicSession => ({
  ...session,
  continuation: true,
  faithful: true,
  used: [...new Set(state.entries.map((entry) => entry.trackId))],
});
