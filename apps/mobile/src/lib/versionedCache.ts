/**
 * A value derived from something versioned (the Library), built once per
 * version and shared by everything that reads it, for `useSyncExternalStore`.
 * It builds only while something subscribes, one build at a time: versions
 * that arrive during a build are caught up with one more build after it. A
 * failed build keeps the last value, tells the subscribers (so a wait on the
 * value ends), and is tried again by the next subscriber or version.
 */
export interface VersionedCache<A> {
  readonly get: () => A;
  readonly subscribe: (listener: () => void) => () => void;
}

interface Versioned {
  readonly get: () => number;
  readonly subscribe: (listener: () => void) => () => void;
}

export const makeVersionedCache = <A>(options: {
  readonly version: Versioned;
  readonly initial: A;
  readonly build: (version: number) => Promise<A>;
}): VersionedCache<A> => {
  const { version, build } = options;
  let value = options.initial;
  /** The version [value] (or the build under way) is for; null before the first. */
  let builtFor: number | null = null;
  let building = false;
  /** Whether the last build failed, so the next subscriber tries it again. */
  let failed = false;
  const listeners = new Set<() => void>();
  let stopFollowing: (() => void) | null = null;

  const tell = (): void => {
    for (const listener of listeners) listener();
  };

  const refresh = (): void => {
    const wanted = version.get();
    if (building || builtFor === wanted || listeners.size === 0) return;
    building = true;
    builtFor = wanted;
    build(wanted)
      .then(
        (next) => {
          value = next;
          failed = false;
          tell();
        },
        () => {
          // Kept as it was; store errors surface elsewhere (the scan banner).
          failed = true;
          tell();
        },
      )
      .finally(() => {
        building = false;
        refresh();
      });
  };

  return {
    get: () => value,
    subscribe: (listener) => {
      listeners.add(listener);
      stopFollowing ??= version.subscribe(refresh);
      if (failed && !building) {
        failed = false;
        builtFor = null;
      }
      refresh();
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) {
          stopFollowing?.();
          stopFollowing = null;
        }
      };
    },
  };
};
