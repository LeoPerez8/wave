/**
 * Undo on "New queue playing": a play that replaces a queue with a song
 * current offers going back to that queue, on the same song at the same
 * place (docs/spec.md, Playback).
 */

import type { QueueCommand, QueueState } from "./queue.ts";

/** What the toast says when a play replaced a queue that was playing. */
export const NEW_QUEUE_NOTICE = "New queue playing";

/** The queue a play replaced, and where its current song was, in ms. */
export interface QueueUndo {
  readonly state: QueueState;
  readonly positionMs: number;
}

/**
 * The Undo [command] offers over [before], the queue the player holds, at
 * [positionMs] in its current song: a play replacing a queue with a song
 * current goes back to it; anything else offers none (null), as does a
 * play of nothing, which leaves nothing playing.
 */
export const queueUndo = (
  before: QueueState,
  command: QueueCommand,
  positionMs: number,
): QueueUndo | null =>
  command.type === "play" && command.trackIds.length > 0 && before.index >= 0
    ? { state: before, positionMs }
    : null;

/**
 * The queue Undo goes back to from [now]: [undo]'s as it was, its entries
 * keeping their keys, with the key counter past both queues', so no entry
 * added later reuses a key either of them held.
 */
export const undoneQueue = (undo: QueueUndo, now: QueueState): QueueState => ({
  ...undo.state,
  nextKey: Math.max(undo.state.nextKey, now.nextKey),
});
