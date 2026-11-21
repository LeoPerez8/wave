/**
 * The search in DJ's grid (docs/spec.md, DJ): the artists and albums the
 * Library and YouTube Music found for what's typed, as the tiles a tap adds
 * to the selection (`djReduce`, the `add` action).
 */
import { djAlbumTile, djArtistTile, type DjAlbum, type DjTile, type DjTileKey } from "./dj.ts";

/** What the search found, each list best match first with the Library's ahead of YouTube Music's. */
export interface DjSearchFound {
  /** The artists found; [libraryId] is the Library's artist, for one it has. */
  readonly artists: readonly { readonly name: string; readonly libraryId?: number | null }[];
  readonly albums: readonly DjAlbum[];
}

/**
 * The results of DJ's search as tiles: the artists [found], then the
 * albums, each in its order. A tile shows once, the first of two alike (so
 * the Library's stands for YouTube Music's), and a name that isn't an
 * artist's or an album with no title is left out.
 */
export const djSearchTiles = ({ artists, albums }: DjSearchFound): DjTile[] => {
  const once = new Map<DjTileKey, DjTile>();
  const tiles: (DjTile | null)[] = [
    ...artists.map((artist) => djArtistTile(artist.name, artist.libraryId ?? null)),
    ...albums.map(djAlbumTile),
  ];
  for (const tile of tiles) if (tile !== null && !once.has(tile.key)) once.set(tile.key, tile);
  return [...once.values()];
};
