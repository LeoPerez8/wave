/**
 * A Library album's and artist's page drawn from rows already in memory
 * (#1352): the Songs, Albums and Artists lists the app keeps for the session
 * (Search's index holds them, #1354), so opening one reads nothing from the
 * Library. Each page is what the Library's own reads answer (the client's
 * `selectAlbumDetail`, `selectArtistDetail`), from the same rows.
 */

import { artistAlbums, type ArtistAlbum } from "./browse.ts";
import { compareAlbumTracks, compareStrings } from "./library.ts";

/** What a page needs to know about a song (the client's `SongRow`). */
export interface DetailSong {
  readonly id: number;
  readonly path: string | null;
  readonly titleSort: string;
  readonly albumId: number;
  /** Every artist its credit names. */
  readonly artistIds: readonly number[];
  readonly discNumber: number | null;
  readonly trackNumber: number | null;
  readonly genre: string | null;
}

/** What a page needs to know about an album (the client's `AlbumRow`). */
export interface DetailAlbum extends ArtistAlbum {
  readonly id: number;
  /** Every artist its album artist credit names. */
  readonly albumArtistIds: readonly number[];
}

/** What a page needs to know about an artist (the client's `ArtistRow`). */
export interface DetailArtist {
  readonly id: number;
  readonly albumCount: number;
  readonly trackCount: number;
}

/** A genre's name and sort key, which settles a tie for an album's genre. */
export interface DetailGenre {
  readonly name: string;
  readonly sort: string;
}

/** The Library's rows, each list in its own order (songs by title, the Songs list's). */
export interface LibraryDetailRows<S, A, R> {
  readonly songs: readonly S[];
  readonly albums: readonly A[];
  readonly artists: readonly R[];
  readonly genres: readonly DetailGenre[];
}

export interface AlbumPage<S, A> {
  readonly album: A;
  /** The genre most of its tracks carry; ties go to the first by sort. */
  readonly genre: string | null;
  /** By disc, then track number (`compareAlbumTracks`). */
  readonly tracks: readonly S[];
}

export interface ArtistPage<S, A, R> {
  /** Their row, counting what the page lists. */
  readonly artist: R;
  /** Filed under them, newest first. */
  readonly albums: readonly A[];
  /** Other albums with songs by them, newest first. */
  readonly appearsOn: readonly A[];
  /** Songs credited to them or on albums credited to them, by title. */
  readonly songs: readonly S[];
}

export interface LibraryDetails<S, A, R> {
  /** Album [id]'s page; undefined when the rows don't hold it (ask the Library). */
  readonly album: (id: number) => AlbumPage<S, A> | undefined;
  /** Artist [id]'s page; undefined when the rows don't hold them (ask the Library). */
  readonly artist: (id: number) => ArtistPage<S, A, R> | undefined;
}

const push = <K, V>(map: Map<K, V[]>, key: K, value: V): void => {
  const list = map.get(key);
  if (list === undefined) map.set(key, [value]);
  else list.push(value);
};

/**
 * Pages over [rows]. Its lookups are indexed once, on first use, in one pass
 * over the rows; a page is then the work of its own rows.
 */
export const createLibraryDetails = <
  S extends DetailSong,
  A extends DetailAlbum,
  R extends DetailArtist,
>(
  rows: LibraryDetailRows<S, A, R>,
): LibraryDetails<S, A, R> => {
  type Index = {
    readonly albums: Map<number, A>;
    readonly artists: Map<number, R>;
    /** Each album's songs, in title order. */
    readonly albumSongs: Map<number, S[]>;
    /** Each artist's credited songs, in title order. */
    readonly creditedSongs: Map<number, S[]>;
    /** The albums each artist's album credit names. */
    readonly creditedAlbums: Map<number, A[]>;
    readonly genreSort: Map<string, string>;
    /** Each song's place in the Songs list's (title) order. */
    readonly position: Map<S, number>;
  };
  let index: Index | null = null;
  const indexed = (): Index => {
    if (index !== null) return index;
    const built: Index = {
      albums: new Map(rows.albums.map((album) => [album.id, album])),
      artists: new Map(rows.artists.map((artist) => [artist.id, artist])),
      albumSongs: new Map(),
      creditedSongs: new Map(),
      creditedAlbums: new Map(),
      genreSort: new Map(rows.genres.map((genre) => [genre.name, genre.sort])),
      position: new Map(),
    };
    for (const [at, song] of rows.songs.entries()) {
      built.position.set(song, at);
      push(built.albumSongs, song.albumId, song);
      for (const artistId of new Set(song.artistIds)) push(built.creditedSongs, artistId, song);
    }
    for (const album of rows.albums) {
      for (const artistId of new Set(album.albumArtistIds)) {
        push(built.creditedAlbums, artistId, album);
      }
    }
    index = built;
    return built;
  };

  const albumGenre = (tracks: readonly S[], genreSort: Map<string, string>): string | null => {
    const counts = new Map<string, number>();
    for (const track of tracks) {
      if (track.genre !== null) counts.set(track.genre, (counts.get(track.genre) ?? 0) + 1);
    }
    let best: string | null = null;
    let bestCount = 0;
    for (const [genre, count] of counts) {
      const wins =
        count > bestCount ||
        (count === bestCount &&
          best !== null &&
          compareStrings(genreSort.get(genre) ?? genre, genreSort.get(best) ?? best) < 0);
      if (wins) {
        best = genre;
        bestCount = count;
      }
    }
    return best;
  };

  return {
    album: (id) => {
      const { albums, albumSongs, genreSort } = indexed();
      const album = albums.get(id);
      if (album === undefined) return undefined;
      const songs = albumSongs.get(id) ?? [];
      // oxlint-disable-next-line unicorn/no-array-sort -- sorts a fresh copy; Hermes lacks toSorted
      const tracks = [...songs].sort(compareAlbumTracks);
      return { album, genre: albumGenre(songs, genreSort), tracks };
    },
    artist: (id) => {
      const { albums, artists, albumSongs, creditedSongs, creditedAlbums, position } = indexed();
      const row = artists.get(id);
      if (row === undefined) return undefined;
      const ownAlbums = creditedAlbums.get(id) ?? [];
      // Theirs: credited on the song, or on its album (a song shows once).
      const theirs = new Set<S>(creditedSongs.get(id));
      for (const album of ownAlbums) for (const song of albumSongs.get(album.id) ?? []) theirs.add(song);
      // oxlint-disable-next-line unicorn/no-array-sort -- sorts a fresh array; Hermes lacks toSorted
      const songs = [...theirs].sort((a, b) => (position.get(a) ?? 0) - (position.get(b) ?? 0));
      // Albums filed or credited under them, and those their credited songs are on.
      const onAlbums = new Set<A>(ownAlbums);
      for (const song of creditedSongs.get(id) ?? []) {
        const album = albums.get(song.albumId);
        if (album !== undefined) onAlbums.add(album);
      }
      const split = artistAlbums(id, [...onAlbums]);
      return {
        artist: { ...row, albumCount: split.albums.length, trackCount: songs.length },
        albums: split.albums,
        appearsOn: split.appearsOn,
        songs,
      };
    },
  };
};
