/**
 * The albums of DJ (docs/spec.md, DJ): the ones its grid may show, from the
 * Library and the saved artist pages, and a selected album's songs, which
 * join the DJ seed as an album seed's do.
 */
import type { DjAlbum, DjTile, DjTileKey, MagicSeedSong } from "@wave/core";

/** What reading the grid's albums needs from the phone. */
export interface DjAlbumPorts {
  /** The Library's albums, in the order the grid prefers them. */
  readonly library: () => Promise<readonly DjAlbum[]>;
  /** The albums the saved YT Music page of [artist] lists; none with no page saved. */
  readonly saved: (artist: string) => Promise<readonly DjAlbum[]>;
}

/**
 * The albums DJ's grid may show for [artists] (the grid's artists): the
 * Library's first, then each artist's saved page's, all read on the phone.
 * A read that fails counts as no album; it never rejects.
 */
export const readDjAlbums = async (
  artists: readonly string[],
  ports: DjAlbumPorts,
): Promise<DjAlbum[]> => {
  const none = (): readonly DjAlbum[] => [];
  const [library, ...saved] = await Promise.all([
    ports.library().catch(none),
    ...artists.map((artist) => ports.saved(artist).catch(none)),
  ]);
  return [...(library ?? []), ...saved.flat()];
};

/** What reading a selected album's songs needs from the phone. */
export interface DjAlbumSongPorts {
  /** The songs of the Library's album, as seed songs. */
  readonly library: (albumId: number) => Promise<readonly MagicSeedSong[]>;
  /** The songs of the YT Music album page, as seed songs; rejects when it can't be read. */
  readonly page: (browseId: string) => Promise<readonly MagicSeedSong[]>;
}

/**
 * The songs of each album among [tiles], by its tile's key, for Core's
 * `startDjQueue`: the Library's when it has the album, else its YT Music
 * page's. An album whose songs can't be read is left out, and its album
 * artist's radio stands for it. It never rejects.
 */
export const readDjAlbumSongs = async (
  tiles: readonly DjTile[],
  ports: DjAlbumSongPorts,
): Promise<Map<DjTileKey, readonly MagicSeedSong[]>> => {
  const none = (): readonly MagicSeedSong[] => [];
  const read = await Promise.all(
    tiles.map(async (tile) => {
      if (tile.kind !== "album") return null;
      const owned = tile.libraryId === null ? [] : await ports.library(tile.libraryId).catch(none);
      const songs =
        owned.length > 0 || tile.browseId === null
          ? owned
          : await ports.page(tile.browseId).catch(none);
      return songs.length === 0 ? null : ([tile.key, songs] as const);
    }),
  );
  return new Map(read.flatMap((entry) => (entry === null ? [] : [entry])));
};
