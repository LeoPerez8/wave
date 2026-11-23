/**
 * The router's path-to-state reads, remembered (#1486). expo-router's tabs navigator reads
 * each tab's route from its path on every navigation, and the router builds its whole route
 * config again for each read: tens of milliseconds a switch on a phone. A read depends only on
 * the path, the linking config and the segments it's given, so the answer is kept per config
 * and handed out as a copy of its own, as a fresh read would be.
 */

type ReadState<S> = (path: string, config?: object, segments?: readonly string[]) => S | undefined;

/** The paths kept per config, the latest read first to stay. */
const KEPT_PATHS = 64;

/** Stands in for an absent config as a key. */
const NO_CONFIG = {};

/** A copy of a state of plain objects and arrays, sharing nothing with [value]. */
function copyState<T>(value: T): T {
  if (Array.isArray(value)) return value.map(copyState) as T;
  if (value === null || typeof value !== "object") return value;
  const copy: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) copy[key] = copyState(entry);
  return copy as T;
}

/**
 * [read], remembering its answers by path, config and segments, up to [limit] paths per config
 * (the least lately read go first). Each call gets its own copy of the answer.
 */
export function rememberPathStates<S>(read: ReadState<S>, limit = KEPT_PATHS): ReadState<S> {
  const byConfig = new WeakMap<object, Map<string, { state: S | undefined }>>();
  return (path, config, segments) => {
    const configKey = config ?? NO_CONFIG;
    let kept = byConfig.get(configKey);
    if (kept === undefined) {
      kept = new Map();
      byConfig.set(configKey, kept);
    }
    const key = JSON.stringify([path, segments ?? null]);
    let answer = kept.get(key);
    if (answer === undefined) {
      answer = { state: read(path, config, segments) };
      if (kept.size >= limit) kept.delete(kept.keys().next().value!);
    } else kept.delete(key);
    kept.set(key, answer);
    return copyState(answer.state);
  };
}
