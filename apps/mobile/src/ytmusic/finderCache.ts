/**
 * One finder over the Library's songs for every screen: screens hand it the
 * rows their shared Library query read (`over`), so the same read gives the
 * same finder; what must be current before it opens (`current`) reads the
 * Library itself once per Library version.
 */
export interface FinderCache<R, F> {
  /** The finder over [rows]: the same one for the same array. It becomes the known one. */
  readonly over: (rows: readonly R[]) => F;
  /** The last finder made, or null before the first. */
  readonly known: () => F | null;
  /**
   * A finder current with the Library: the one read at the current version,
   * else after reading it (one read under way at a time). Rows a screen
   * showed may be from before a change, so they don't count.
   */
  readonly current: () => Promise<F>;
}

export const makeFinderCache = <R, F>(options: {
  readonly version: () => number;
  readonly read: () => Promise<readonly R[]>;
  readonly build: (rows: readonly R[]) => F;
}): FinderCache<R, F> => {
  const { version, read, build } = options;
  let known: { readonly rows: readonly R[]; readonly find: F } | null = null;
  /** The last own read, and the version it was started at. */
  let fresh: { readonly version: number; readonly find: Promise<F> } | null = null;

  const over = (rows: readonly R[]): F => {
    if (known?.rows !== rows) known = { rows, find: build(rows) };
    return known.find;
  };

  return {
    over,
    known: () => known?.find ?? null,
    current: () => {
      const wanted = version();
      if (fresh?.version !== wanted) {
        const reading: { version: number; find: Promise<F> } = {
          version: wanted,
          find: read().then(over, (error: unknown) => {
            // Tried again by the next wait.
            if (fresh === reading) fresh = null;
            throw error;
          }),
        };
        fresh = reading;
      }
      return fresh.find;
    },
  };
};
