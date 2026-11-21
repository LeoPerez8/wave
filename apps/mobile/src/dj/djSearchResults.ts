/**
 * The results of the search in DJ's grid (docs/spec.md, DJ): the artists and
 * albums the Library's search and YouTube Music's found, as the tiles a tap
 * adds (Core's `djSearchTiles`), each with what its row draws.
 */
import {
  djArtistTile,
  djSearchTiles,
  type DjTile,
  type DjTileKey,
  type YtArtistAlbum,
  type YtArtistCandidate,
} from "@wave/core";

/** A Library artist the search found. */
interface FoundArtist {
  readonly id: number;
  readonly name: string;
  readonly thumbPath: string | null;
  readonly artworkPath: string | null;
}

/** A Library album the search found. */
interface FoundAlbum {
  readonly id: number;
  readonly title: string;
  readonly albumArtist: string;
  readonly artworkPath: string | null;
  readonly thumbPath: string | null;
}

/** What an artist's row draws: the Library's image files, or YouTube Music's picture. */
export interface DjSearchImage {
  readonly name: string;
  readonly thumbPath: string | null;
  readonly artworkPath: string | null;
  readonly imageUrl?: string | null;
}

/** One result of DJ's search: the tile a tap adds, and an artist's image (null for an album). */
export interface DjSearchResult {
  readonly tile: DjTile;
  readonly image: DjSearchImage | null;
}

/**
 * The results for what the [library]'s search found and what YouTube Music
 * added ([yt]: its artists and albums the Library lacks), each list best
 * match first: artists, then albums, the Library's ahead, each tile once.
 * An album YouTube Music found is filed under the first artist it credits.
 */
export const djSearchResults = (
  library: { readonly artists: readonly FoundArtist[]; readonly albums: readonly FoundAlbum[] },
  yt: {
    readonly artists: readonly YtArtistCandidate[];
    readonly albums: readonly YtArtistAlbum[];
  },
): DjSearchResult[] => {
  const images = new Map<DjTileKey, DjSearchImage>();
  const picture = (image: DjSearchImage): void => {
    const key = djArtistTile(image.name)?.key;
    if (key !== undefined && !images.has(key)) images.set(key, image);
  };
  for (const artist of library.artists) picture(artist);
  for (const artist of yt.artists)
    picture({
      name: artist.name,
      thumbPath: null,
      artworkPath: null,
      imageUrl: artist.artworkUrl ?? null,
    });
  const tiles = djSearchTiles({
    artists: [
      ...library.artists.map((artist) => ({ name: artist.name, libraryId: artist.id })),
      ...yt.artists,
    ],
    albums: [
      ...library.albums.map((album) => ({
        title: album.title,
        artist: album.albumArtist,
        libraryId: album.id,
        cover: album.artworkPath ?? album.thumbPath,
      })),
      ...yt.albums.map((album) => ({
        title: album.title,
        artist: album.artists[0] ?? "",
        browseId: album.browseId,
        cover: album.artworkUrl,
      })),
    ],
  });
  return tiles.map((tile) => ({
    tile,
    image: tile.kind === "artist" ? (images.get(tile.key) ?? null) : null,
  }));
};
