/**
 * Undo on "New queue playing": a play that replaces a queue with a song
 * current offers going back to that queue, on the same song at the same
 * place (docs/spec.md, Playback).
 */

import type { QueueCommand, QueuePlayback, QueueState } from "./queue.ts";

/** What the toast says when a play replaced a queue that was playing. */
const NEW_QUEUE_NOTICE = "New queue playing";

/** The queue a play replaced, and where its current song was, in ms. */
export interface QueueUndo {
  readonly state: QueueState;
  readonly positionMs: number;
}

/** The entry the player is on (its key), and how far into it, in ms. */
export interface PlayerAt {
  readonly key: string | null;
  readonly positionMs: number;
}

/**
 * The Undo [command] offers over [before], the queue the player holds, with
 * the player at [player]: a play replacing a queue with a song current goes
 * back to it, where the player is in that song (from its start, when the
 * player went on to another one). Anything else offers none (null), as does
 * a play of nothing, which leaves nothing playing.
 */
export const queueUndo = (
  before: QueueState,
  command: QueueCommand,
  player: PlayerAt,
): QueueUndo | null => {
  if (command.type !== "play" || command.trackIds.length === 0 || before.index < 0) return null;
  const onIt = before.entries[before.index]?.key === player.key;
  return { state: before, positionMs: onIt ? player.positionMs : 0 };
};

/**
 * The queue Undo goes back to from [now]: [undo]'s as it was, its entries
 * keeping their keys, with the key counter past both queues', so no entry
 * added later reuses a key either of them held.
 */
export const undoneQueue = (undo: QueueUndo, now: QueueState): QueueState => ({
  ...undo.state,
  nextKey: Math.max(undo.state.nextKey, now.nextKey),
});

/**
 * The line on the toast offering Undo once a new queue went with [playback]:
 * "New queue playing", followed by [notice] (a song skipped on the way) when
 * there is one. Null when nothing plays (every song was skipped): the notice
 * shows on its own, without Undo.
 */
export const newQueueToast = (playback: QueuePlayback, notice: string | null): string | null => {
  if (playback === "stop") return null;
  return notice === null ? NEW_QUEUE_NOTICE : `${NEW_QUEUE_NOTICE} · ${notice}`;
};
