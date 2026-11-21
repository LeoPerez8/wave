/** What an online screen already knows: pages read this session, kept for their next opening. */
export interface KnownPages<V> {
  /** The page kept under [key], or undefined when none is. */
  readonly get: (key: string) => V | undefined;
  readonly set: (key: string, page: V) => void;
}

/** At most [limit] pages, the one used longest ago dropped first (Performance rules, 12). */
export const knownPages = <V>(limit: number): KnownPages<V> => {
  const pages = new Map<string, V>();
  return {
    get: (key) => {
      const page = pages.get(key);
      if (page === undefined) return undefined;
      // Moved to the end: Map keeps insertion order, so the first key is the one used longest ago.
      pages.delete(key);
      pages.set(key, page);
      return page;
    },
    set: (key, page) => {
      pages.delete(key);
      pages.set(key, page);
      while (pages.size > limit) pages.delete(pages.keys().next().value as string);
    },
  };
};
