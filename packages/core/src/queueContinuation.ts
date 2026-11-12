import type { QueueState } from "./queue.ts";
import { MAGIC_QUEUE_CONTEXT, type MagicSession } from "./magicQueue.ts";
import { RECAP_PLAY_CONTEXT } from "./recapMusic.ts";
import type { SleepTimer } from "./sleepTimer.ts";

/** The source whose songs and name the app reads when a queue continues. */
export interface QueueContinuationSeed {
  readonly kind: "album" | "playlist" | "artist" | "track";
  readonly id: string;
}

/** A queue's last song starts its Magic Queue, using the list it came from. */
export const queueContinuation = (
  state: QueueState,
  {
    enabled = true,
    sleepTimer = null,
  }: {
    readonly enabled?: boolean;
    readonly sleepTimer?: SleepTimer | null;
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
  const current = state.entries[state.index];
  if (current === undefined || state.index !== state.entries.length - 1) return null;
  const context = state.context;
  if (
    context?.id != null &&
    (context.kind === "album" || context.kind === "playlist" || context.kind === "artist")
  )
    return { kind: context.kind, id: context.id };
  return { kind: "track", id: current.trackId };
};

/** Continue after the existing songs, keeping them out of every later batch. */
export const continueMagicQueue = (session: MagicSession, state: QueueState): MagicSession => ({
  ...session,
  continuation: true,
  used: [...new Set(state.entries.map((entry) => entry.trackId))],
});
