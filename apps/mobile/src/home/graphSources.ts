/** Catalog/page writes have no LibraryChange kind; keep their graph version here. */
const listeners = new Set<(kind: "catalog" | "similar") => void>();
export const artistGraphSourcesChanged = (kind: "catalog" | "similar"): void => {
  for (const listener of listeners) listener(kind);
};
export const onArtistGraphSourcesChanged = (
  listener: (kind: "catalog" | "similar") => void,
): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
