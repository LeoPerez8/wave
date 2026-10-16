/** A tiny observable value for `useSyncExternalStore`, written to from Effect services. */
export interface ExternalStore<A> {
  readonly get: () => A;
  readonly set: (value: A) => void;
  readonly update: (f: (value: A) => A) => void;
  readonly subscribe: (listener: () => void) => () => void;
  /** How many listeners it has now (a perf build reports it). */
  readonly listenerCount: () => number;
}

export const makeExternalStore = <A>(initial: A): ExternalStore<A> => {
  let value = initial;
  const listeners = new Set<() => void>();
  const set = (next: A): void => {
    if (Object.is(next, value)) return;
    value = next;
    for (const listener of listeners) listener();
  };
  return {
    get: () => value,
    set,
    update: (f) => set(f(value)),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    listenerCount: () => listeners.size,
  };
};
