import { queuePersistence, type QueuePersistenceState } from "@wave/core";

/** Omitted parts keep their previous SQLite value. */
export interface QueueWrite {
  readonly queue?: string;
  readonly metadata?: string;
  readonly index?: number;
  readonly positionMs?: number;
}

/** Serialises entries only when Core says their reference changed. */
export const queueWrite = (
  previous: QueuePersistenceState | null,
  next: QueuePersistenceState,
): QueueWrite => {
  const changed = queuePersistence(previous, next);
  const { entries: _entries, index: _index, ...metadata } = next.state;
  return {
    ...(changed.entries ? { queue: JSON.stringify(next.state) } : {}),
    ...(changed.metadata ? { metadata: JSON.stringify(metadata) } : {}),
    ...(changed.index ? { index: next.state.index } : {}),
    ...(changed.position ? { positionMs: Math.round(next.positionMs) } : {}),
  };
};
