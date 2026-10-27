import type { QueueState } from "./queue.ts";

export interface QueuePersistenceState {
  readonly state: QueueState;
  readonly positionMs: number;
}

/** Which saved parts changed. Entry identity is the queue engine's change signal. */
export const queuePersistence = (
  previous: QueuePersistenceState | null,
  next: QueuePersistenceState,
): { entries: boolean; index: boolean; position: boolean; metadata: boolean } => ({
  entries: previous === null || previous.state.entries !== next.state.entries,
  index: previous === null || previous.state.index !== next.state.index,
  position: previous === null || previous.positionMs !== next.positionMs,
  metadata: previous === null || previous.state.context !== next.state.context ||
    previous.state.shuffle !== next.state.shuffle || previous.state.repeat !== next.state.repeat ||
    previous.state.nextKey !== next.state.nextKey,
});
