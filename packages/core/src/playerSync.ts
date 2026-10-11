/**
 * Keeping the native player's item list in step with the queue.
 *
 * The player holds media items identified by queue entry keys. Instead of
 * reloading the whole list on every queue change (which would interrupt the
 * playing item), the plan edits the list around it: the playing item is never
 * removed, so it keeps playing and the next item stays gapless.
 */

/** What the native player holds: entry keys in order and the key it is playing. */
export interface PlayerList {
  readonly keys: readonly string[];
  readonly currentKey: string | null;
}

/** The queue as the player should hold it. */
export interface QueueList {
  readonly keys: readonly string[];
  readonly index: number;
}

export type SyncStep =
  /** Empty the player. */
  | { readonly type: "clear" }
  /** Load a new list and start at `index` (the playing item changes). */
  | { readonly type: "replace"; readonly keys: readonly string[]; readonly index: number }
  /** Move to the already-loaded item with this key. */
  | { readonly type: "seek"; readonly key: string }
  /** Remove `removeCount` items at `at`, then insert `insertKeys` there. */
  | {
      readonly type: "edit";
      readonly at: number;
      readonly removeCount: number;
      readonly insertKeys: readonly string[];
    };

/** The single edit turning `from` into `to`, after trimming what they share at both ends. */
const diff = (from: readonly string[], to: readonly string[], offset: number): SyncStep | null => {
  let prefix = 0;
  while (prefix < from.length && prefix < to.length && from[prefix] === to[prefix]) prefix += 1;
  if (prefix === from.length && prefix === to.length) return null;
  let suffix = 0;
  const room = Math.min(from.length, to.length) - prefix;
  while (suffix < room && from[from.length - 1 - suffix] === to[to.length - 1 - suffix]) {
    suffix += 1;
  }
  return {
    type: "edit",
    at: offset + prefix,
    removeCount: from.length - prefix - suffix,
    insertKeys: to.slice(prefix, to.length - suffix),
  };
};

/**
 * The steps that make the player hold the queue. Edits after the playing item
 * come before edits ahead of it, so each step's indices are valid when applied
 * in order.
 */
export const planPlayerSync = (player: PlayerList, queue: QueueList): SyncStep[] => {
  const currentKey = queue.keys[queue.index];
  if (currentKey === undefined) return player.keys.length > 0 ? [{ type: "clear" }] : [];
  const anchor = player.keys.indexOf(currentKey);
  if (anchor < 0) return [{ type: "replace", keys: [...queue.keys], index: queue.index }];
  const steps: SyncStep[] = [];
  if (player.currentKey !== currentKey) steps.push({ type: "seek", key: currentKey });
  const after = diff(player.keys.slice(anchor + 1), queue.keys.slice(queue.index + 1), anchor + 1);
  if (after !== null) steps.push(after);
  const before = diff(player.keys.slice(0, anchor), queue.keys.slice(0, queue.index), 0);
  if (before !== null) steps.push(before);
  return steps;
};

/** What the player holds after the steps; the app's mirror of the native list. */
export const applyPlayerSync = (player: PlayerList, steps: readonly SyncStep[]): PlayerList =>
  steps.reduce<PlayerList>((state, step) => {
    switch (step.type) {
      case "clear":
        return { keys: [], currentKey: null };
      case "replace":
        return { keys: step.keys, currentKey: step.keys[step.index] ?? null };
      case "seek":
        return { ...state, currentKey: step.key };
      case "edit": {
        const keys = [...state.keys];
        keys.splice(step.at, step.removeCount, ...step.insertKeys);
        return { ...state, keys };
      }
    }
  }, player);
