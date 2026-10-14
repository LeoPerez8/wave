/**
 * How an artist page lists its content, on the Library artist page and the
 * YT Music artist page alike: each album shelf (Albums, Singles & EPs,
 * Appears on) is its heading over one row of covers that scrolls sideways,
 * then the Songs heading and the songs.
 */

/** An album shelf: its heading and its covers, in the order they show. */
export interface ArtistPageShelf<C> {
  readonly label: string;
  readonly covers: readonly C[];
}

/** An entry of an artist page's list. A song's `index` is its place among the page's songs. */
export type ArtistPageItem<C, S> =
  | { readonly type: "section"; readonly label: string }
  | { readonly type: "shelf"; readonly label: string; readonly covers: readonly C[] }
  | { readonly type: "song"; readonly song: S; readonly index: number };

/** The page's list: [shelves] in order, each heading over one row of covers, then [songs]. */
export const artistPageItems = <C, S>(
  shelves: readonly ArtistPageShelf<C>[],
  songs: readonly S[],
): ArtistPageItem<C, S>[] => {
  const items: ArtistPageItem<C, S>[] = [];
  for (const { label, covers } of shelves) {
    if (covers.length === 0) continue;
    items.push({ type: "section", label });
    items.push({ type: "shelf", label, covers });
  }
  if (songs.length > 0) items.push({ type: "section", label: "Songs" });
  songs.forEach((song, index) => items.push({ type: "song", song, index }));
  return items;
};
