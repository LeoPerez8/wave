/**
 * The screens opened last, kept ready (#1352): a pushed screen the owner
 * opened (a playlist, a genre) stays in memory for a quick return, at most
 * `max` of them; past it the one opened least recently is let go.
 */

export interface RecentKeeps<K> {
  /** [key]'s screen was opened: keep it, as the most recent. */
  readonly touch: (key: K) => void;
  readonly size: () => number;
  /** Lets every key go. */
  readonly clear: () => void;
}

export const createRecentKeeps = <K>(options: {
  readonly max: number;
  /** Starts keeping [key]; returns how to let it go. */
  readonly keep: (key: K) => () => void;
}): RecentKeeps<K> => {
  // A Map iterates in insertion order: the first key is the least recent.
  const kept = new Map<K, () => void>();
  return {
    touch: (key) => {
      const release = kept.get(key);
      if (release !== undefined) {
        kept.delete(key);
        kept.set(key, release);
        return;
      }
      kept.set(key, options.keep(key));
      while (kept.size > options.max) {
        const [oldest, letGo] = kept.entries().next().value as [K, () => void];
        kept.delete(oldest);
        letGo();
      }
    },
    size: () => kept.size,
    clear: () => {
      const releases = [...kept.values()];
      kept.clear();
      for (const release of releases) release();
    },
  };
};
