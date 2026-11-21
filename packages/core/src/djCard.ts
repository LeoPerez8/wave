/**
 * Home's DJ card (docs/spec.md, DJ): the artist faces it fans out from its
 * right edge.
 */
import type { PlayedSeedArtist } from "./artistMixes.ts";
import { djArtistTile, type DjArtistTile, type DjTile, type DjTileKey } from "./dj.ts";

/** The most faces the DJ card shows. */
export const DJ_CARD_ARTISTS = 4;

/**
 * The artists Home's DJ card shows, at most `DJ_CARD_ARTISTS`: the artist
 * tiles of the selection the last DJ was started from ([remembered]), in the
 * order they were selected, then the most played artists ([played], most
 * played first). Album and genre tiles have no face and are skipped; an
 * artist is shown once, compared as DJ's tiles compare them, and as the
 * Library's artist when [artists] (the Library's) has them, so the card
 * shows their image.
 */
export const djCardArtists = ({
  remembered,
  played,
  artists = [],
}: {
  readonly remembered: readonly DjTile[];
  readonly played: readonly PlayedSeedArtist[];
  readonly artists?: readonly { readonly id: number; readonly name: string }[];
}): DjArtistTile[] => {
  const library = new Map<DjTileKey, DjArtistTile>();
  for (const artist of artists) {
    const tile = djArtistTile(artist.name, artist.id);
    if (tile !== null && !library.has(tile.key)) library.set(tile.key, tile);
  }
  const faces = new Map<DjTileKey, DjArtistTile>();
  const add = (tile: DjArtistTile | null): void => {
    if (tile === null || faces.size >= DJ_CARD_ARTISTS || faces.has(tile.key)) return;
    faces.set(tile.key, tile.libraryId === null ? (library.get(tile.key) ?? tile) : tile);
  };
  for (const tile of remembered) if (tile.kind === "artist") add(tile);
  for (const artist of played)
    add(djArtistTile(artist.name, typeof artist.id === "number" ? artist.id : null));
  return [...faces.values()];
};
