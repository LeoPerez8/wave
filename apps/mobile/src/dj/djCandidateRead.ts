import type { DjTile } from "@wave/core";

/** One DJ visit's candidate read: lazy, shared while pending, and retryable after failure. */
export const createDjCandidateReader = () => {
  let value: readonly DjTile[] = [];
  let hasValue = false;
  let pending: Promise<readonly DjTile[]> | null = null;

  return {
    read(load: () => Promise<readonly DjTile[]>): Promise<readonly DjTile[]> {
      if (hasValue) return Promise.resolve(value);
      if (pending !== null) return pending;
      const current = Promise.resolve()
        .then(load)
        .then((tiles) => {
          value = tiles;
          hasValue = true;
          return tiles;
        })
        .finally(() => {
          if (pending === current) pending = null;
        });
      pending = current;
      return current;
    },
  };
};
