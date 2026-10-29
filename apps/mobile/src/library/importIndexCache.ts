/**
 * The Library as From YT Music's and From Spotify's imports match it (Core's
 * `importLibraryIndexSteps`), listed and indexed once and shared by every
 * playlist the batch reads while the Library stays as it was (#759): a batch
 * of 80 playlists used to list and index it 80 times. Any Library change
 * ([version] moving: a scan, an edit, downloads landing) makes the next
 * playlist build it again, so each still matches against the Library as it
 * is when its turn comes.
 */
export interface ImportIndexCache<I> {
  /** The index built at the Library's current version, else [build]'s (one build at a time). */
  readonly current: (build: () => Promise<I>) => Promise<I>;
  /** Lets the index go, once no import reads. */
  readonly clear: () => void;
}

export const makeImportIndexCache = <I>(version: () => number): ImportIndexCache<I> => {
  let kept: { readonly version: number; readonly index: Promise<I> } | null = null;
  return {
    current: (build) => {
      // Taken before the build lists the Library: a change meanwhile builds again next time.
      const wanted = version();
      if (kept?.version !== wanted) {
        const building: { version: number; index: Promise<I> } = {
          version: wanted,
          index: build().catch((error: unknown) => {
            if (kept === building) kept = null;
            throw error;
          }),
        };
        kept = building;
      }
      return kept.index;
    },
    clear: () => {
      kept = null;
    },
  };
};
