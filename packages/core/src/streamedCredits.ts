import { artistPhotoName } from "./artistPhoto.ts";
import { creditSplitter } from "./credits.ts";

import {
  libraryArtistFinder,
  libraryReleaseFinder,
  releaseTitle,
  type LibraryAlbumKey,
} from "./ytArtist.ts";

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

interface StreamedRelease {
  readonly artists: readonly string[];
  readonly album: string | null;
  readonly albumId?: string | null;
  readonly artworkUrl: string | null;
}

/** A metadata-only album's online page, using release-title and artist-name matching. */
export const pickStreamedAlbum = (
  album: { readonly title: string; readonly artists: readonly string[] },
  candidates: readonly {
    readonly title: string;
    readonly artists: readonly string[];
    readonly browseId: string;
  }[],
): string | null => {
  const names = new Set(album.artists.map(artistPhotoName));
  return (
    candidates.find(
      (candidate) =>
        releaseTitle(candidate.title) === releaseTitle(album.title) &&
        candidate.artists.some((name) => names.has(artistPhotoName(name))),
    )?.browseId ?? null
  );
};

const releaseKey = (title: string, name: string) =>
  `${releaseTitle(title)}:${artistPhotoName(name)}`;

/** Resolve streamed credits with the same artist and release matchers as online pages. */
export const streamedCredits = (library: {
  readonly artists: readonly { readonly id: number; readonly name: string }[];
  readonly albums: readonly (LibraryAlbumKey & { readonly id: number })[];
  readonly credits: Iterable<string>;
  readonly releases?: Iterable<StreamedRelease>;
}) => {
  const split = creditSplitter(library.credits);
  const artistNamed = libraryArtistFinder(library.artists);
  const release = libraryReleaseFinder(artistNamed, library.albums);
  const releaseIds = new Map<string, string>();

  for (const song of library.releases ?? []) {
    if (song.album === null || song.albumId == null) continue;
    for (const name of split(song.artists)) {
      const key = releaseKey(song.album, name);
      const previous = releaseIds.get(key);
      if (previous === undefined || song.albumId < previous) releaseIds.set(key, song.albumId);
    }
  }
  return (
    song: StreamedRelease,
  ): { readonly artists: readonly PlayedArtistKey[]; readonly album: PlayedAlbumKey | null } => {
    const artists = new Map<number | string, PlayedArtistKey>();
    for (const name of split(song.artists)) {
      const found = artistNamed(name);
      const artist = found ?? { id: `artist:${artistPhotoName(name)}`, name };
      artists.set(artist.id, artist);
    }
    const names = [...artists.values()].map((artist) => artist.name);
    const matched = song.album === null ? null : release({ title: song.album, artists: names });
    const albumId =
      song.albumId ??
      (song.album === null
        ? null
        : (names
            .map((name) => releaseIds.get(releaseKey(song.album!, name)))
            .find((id) => id !== undefined) ?? null));
    return {
      artists: [...artists.values()],
      album:
        song.album === null
          ? null
          : {
              id:
                matched?.id ??
                `album:${albumId ?? `${releaseTitle(song.album)}:${artistPhotoName(names[0] ?? "")}`}`,
              title: matched?.title ?? song.album,
              artists: names,
              albumId,
              artworkUrl: song.artworkUrl,
            },
    };
  };
};
