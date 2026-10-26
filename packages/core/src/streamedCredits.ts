import { artistPhotoName } from "./artistPhoto.ts";
import { creditSplitter } from "./credits.ts";

import { libraryArtistFinder, libraryReleaseFinder, releaseTitle, type LibraryAlbumKey } from "./ytArtist.ts";

export interface PlayedArtistKey {
  readonly id: number | string;
  readonly name: string;
}

export interface PlayedAlbumKey {
  readonly id: number | string;
  readonly title: string;
  readonly artists: readonly string[];
  readonly albumId: string | null;
  readonly artworkUrl: string | null;
}

/** Resolve streamed credits with the same artist and release matchers as online pages. */
export const streamedCredits = (library: {
  readonly artists: readonly { readonly id: number; readonly name: string }[];
  readonly albums: readonly (LibraryAlbumKey & { readonly id: number })[];
  readonly credits: Iterable<string>;
}) => {
  const split = creditSplitter(library.credits);
  const artistNamed = libraryArtistFinder(library.artists);
  const release = libraryReleaseFinder(artistNamed, library.albums);
  return (song: {
    readonly artists: readonly string[];
    readonly album: string | null;
    readonly albumId?: string | null;
    readonly artworkUrl: string | null;
  }): { readonly artists: readonly PlayedArtistKey[]; readonly album: PlayedAlbumKey | null } => {
    const artists = new Map<number | string, PlayedArtistKey>();
    for (const name of split(song.artists)) {
      const found = artistNamed(name);
      const artist = found ?? { id: `artist:${artistPhotoName(name)}`, name };
      artists.set(artist.id, artist);
    }
    const names = [...artists.values()].map((artist) => artist.name);
    const matched = song.album === null ? null : release({ title: song.album, artists: names });
    return {
      artists: [...artists.values()],
      album: song.album === null ? null : {
        id: matched?.id ?? `album:${releaseTitle(song.album)}:${artistPhotoName(names[0] ?? "")}`,
        title: matched?.title ?? song.album,
        artists: names,
        albumId: song.albumId ?? null,
        artworkUrl: song.artworkUrl,
      },
    };
  };
};
