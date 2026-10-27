import { parseQueueState, type QueueState } from "./queue.ts";

/** A queue with where its current entry is, as last saved or about to be. */
export interface QueuePersistenceState {
  readonly state: QueueState;
  readonly positionMs: number;
}

/** Which saved parts a change touched. */
export interface QueueParts {
  readonly entries: boolean;
  readonly index: boolean;
  readonly position: boolean;
  /** Context, shuffle, repeat and the key counter. */
  readonly metadata: boolean;
}

/**
 * Which parts of the saved queue a change must write. Entries change by
 * reference (the queue engine makes a new list whenever it edits one), so a
 * skip or a position save never looks at them; null [previous] is a queue
 * not saved yet, which writes everything.
 */
export const queuePersistence = (
  previous: QueuePersistenceState | null,
  next: QueuePersistenceState,
): QueueParts => {
  if (previous === null) return { entries: true, index: true, position: true, metadata: true };
  const before = previous.state;
  const after = next.state;
  return {
    entries: before.entries !== after.entries,
    index: before.index !== after.index,
    position: Math.round(previous.positionMs) !== Math.round(next.positionMs),
    metadata:
      before.context !== after.context ||
      before.shuffle !== after.shuffle ||
      before.repeat !== after.repeat ||
      before.nextKey !== after.nextKey,
  };
};

/**
 * What a change writes; omitted parts keep their saved value. [queue] is the
 * whole `QueueState` as JSON, written only when the entries change; the
 * others overlay it (see `savedQueueState`).
 */
export interface QueueWrite {
  readonly queue?: string;
  /** The context, shuffle, repeat and key counter as JSON. */
  readonly metadata?: string;
  readonly index?: number;
  readonly positionMs?: number;
}

/** The parts `queuePersistence` says changed, serialised. */
export const queueWrite = (
  previous: QueuePersistenceState | null,
  next: QueuePersistenceState,
): QueueWrite => {
  const parts = queuePersistence(previous, next);
  const { context, shuffle, repeat, nextKey } = next.state;
  return {
    ...(parts.entries ? { queue: JSON.stringify(next.state) } : {}),
    ...(parts.metadata ? { metadata: JSON.stringify({ context, shuffle, repeat, nextKey }) } : {}),
    ...(parts.index ? { index: next.state.index } : {}),
    ...(parts.position ? { positionMs: Math.round(next.positionMs) } : {}),
  };
};

/** The saved parts, as the library or the player kept them; null parts weren't written apart. */
export interface SavedQueueParts {
  readonly queue: string;
  readonly metadata: string | null;
  readonly index: number | null;
}

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * The queue the saved parts make up, or null when they don't make one. A
 * queue saved whole (by an earlier Wave) has no separate parts. Parts that
 * don't fit the entries (a kill between two writes) give way to the entries'
 * own.
 */
export const savedQueueState = (parts: SavedQueueParts): QueueState | null => {
  const queue = parseJson(parts.queue);
  if (!isRecord(queue)) return null;
  const metadata = parts.metadata === null ? null : parseJson(parts.metadata);
  const merged = {
    ...queue,
    ...(isRecord(metadata) ? metadata : {}),
    ...(parts.index === null ? {} : { index: parts.index }),
  };
  return parseQueueState(merged) ?? parseQueueState(queue);
};
