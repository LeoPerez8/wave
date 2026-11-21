/**
 * How an artist page lists its content, on the Library artist page and the
 * YT Music artist page alike: each album shelf (Albums, Singles & EPs,
 * Appears on) is its heading over one row of covers that scrolls sideways,
 * then the Songs heading and the songs, then what follows them (Fans might
 * also like).
 */

/** An album shelf: its heading and its covers, in the order they show. */
export interface ArtistPageShelf<C> {
  readonly label: string;
  readonly covers: readonly C[];
}

/**
 * What an artist page lists after its songs. Each part is left out when the
 * page has none of it.
 */
export interface ArtistPageAfter<R> {
  /** Fans might also like: its heading and the similar artists, in the order they show. */
  readonly similar?: { readonly label: string; readonly artists: readonly R[] } | undefined;
}

/** An entry of an artist page's list. A song's `index` is its place among the page's songs. */
export type ArtistPageItem<C, S, R = never> =
  | { readonly type: "section"; readonly label: string }
  | { readonly type: "shelf"; readonly label: string; readonly covers: readonly C[] }
  | { readonly type: "song"; readonly song: S; readonly index: number }
  | { readonly type: "similar"; readonly label: string; readonly artists: readonly R[] };

/**
 * The page's list: [shelves] in order, each heading over one row of covers,
 * then [songs] under [songsLabel] ("Songs", or "Popular" when they're in
 * YouTube Music's order), then [after] them the similar artists as one row
 * under their heading. While Find in artist narrows the songs ([found]:
 * their places among [songs], a finder's answer), the shelves, the heading
 * and what follows the songs step aside and only the songs found show, each
 * keeping its place, so a tap plays the page's songs from it.
 */
export const artistPageItems = <C, S, R = never>(
  shelves: readonly ArtistPageShelf<C>[],
  songs: readonly S[],
  songsLabel = "Songs",
  found: readonly number[] | null = null,
  after: ArtistPageAfter<R> = {},
): ArtistPageItem<C, S, R>[] => {
  if (found !== null)
    return found.flatMap((index) =>
      index in songs ? [{ type: "song" as const, song: songs[index]!, index }] : [],
    );
  const items: ArtistPageItem<C, S, R>[] = [];
  for (const { label, covers } of shelves) {
    if (covers.length === 0) continue;
    items.push({ type: "section", label });
    items.push({ type: "shelf", label, covers });
  }
  if (songs.length > 0) items.push({ type: "section", label: songsLabel });
  songs.forEach((song, index) => items.push({ type: "song", song, index }));
  const { similar } = after;
  if (similar !== undefined && similar.artists.length > 0) {
    items.push({ type: "section", label: similar.label });
    items.push({ type: "similar", label: similar.label, artists: similar.artists });
  }
  return items;
};
