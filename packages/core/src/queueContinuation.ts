import type { QueueState } from "./queue.ts";
import { MAGIC_QUEUE_CONTEXT, type MagicSession } from "./magicQueue.ts";
import { RECAP_PLAY_CONTEXT } from "./recapMusic.ts";
import type { SleepTimer } from "./sleepTimer.ts";

/** The source whose songs and name the app reads when a queue continues. */
export interface QueueContinuationSeed {
  readonly kind: "album" | "playlist" | "artist" | "track";
  readonly id: string;
}

/** What tells how much of a queue is left to play, against the Buffer setting. */
export interface QueueTimeAhead {
  /** Settings › Playback › Buffer, in ms (`streamBufferMs`). */
  readonly bufferMs: number;
  /** Where the current song is playing. */
  readonly positionMs: number;
  /** A song's length by track id; null while it isn't known. */
  readonly durationMs: (trackId: string) => number | null;
}

/**
 * The time left to play in [state]: the rest of the current song plus the
 * songs after it. Null while any of those lengths is unknown.
 */
const timeLeftMs = (state: QueueState, ahead: QueueTimeAhead): number | null => {
  let left = 0;
  for (let i = state.index; i < state.entries.length; i++) {
    const duration = ahead.durationMs(state.entries[i]!.trackId);
    if (duration === null) return null;
    left += i === state.index ? Math.max(0, duration - ahead.positionMs) : duration;
  }
  return left;
};

/**
 * How long a queue still plays before its time left is down to the Buffer,
 * past which it continues; 0 once it is. Null when no wait brings it: nothing to
 * continue, a length unknown, or the last song playing, whose start already
 * continued it.
 */
export const queueContinuationWaitMs = (
  state: QueueState,
  ahead: QueueTimeAhead,
): number | null => {
  if (state.index === state.entries.length - 1) return null;
  if (queueContinuation(state, { ahead: { ...ahead, bufferMs: Infinity } }) === null) return null;
  const left = timeLeftMs(state, ahead);
  return left === null ? null : Math.max(0, left - ahead.bufferMs);
};

/**
 * A queue starts its Magic Queue, using the list it came from, when its last
 * song starts. With [ahead] it starts sooner: once the time left to play is
 * shorter than the Buffer, so the player can load the new songs ahead.
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
  if (state.index !== state.entries.length - 1) {
    const left = ahead === null ? null : timeLeftMs(state, ahead);
    if (left === null || left >= ahead!.bufferMs) return null;
  }
  const context = state.context;
  if (
    context?.id != null &&
    (context.kind === "album" || context.kind === "playlist" || context.kind === "artist")
  )
    return { kind: context.kind, id: context.id };
  return { kind: "track", id: last.trackId };
};

/** Continue after the existing songs, keeping them out of every later batch. */
export const continueMagicQueue = (session: MagicSession, state: QueueState): MagicSession => ({
  ...session,
  continuation: true,
  used: [...new Set(state.entries.map((entry) => entry.trackId))],
});
