import { artistPhotoName } from "./artistPhoto.ts";
import { finishSteps } from "./buildSteps.ts";
import { creditSplitterSteps } from "./credits.ts";

import {
  libraryArtistFinderSteps,
  libraryReleaseFinderSteps,
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

export interface StreamedRelease {
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

/** A streamed song's credits: the artists it names and the album it is on. */
export interface StreamedSongCredits {
  readonly artists: readonly PlayedArtistKey[];
  readonly album: PlayedAlbumKey | null;
}

/** Core's credit resolver over one Library, which can learn more releases' ids as it goes. */
export interface StreamedCreditResolver {
  readonly resolve: (song: StreamedRelease) => StreamedSongCredits;
  /** Learns [songs]' release ids: it then resolves as one built with them. */
  readonly learn: (songs: Iterable<StreamedRelease>) => void;
}

/** Resolve streamed credits with the same artist and release matchers as online pages. */
export const streamedCredits = (library: StreamedCreditLibrary) =>
  finishSteps(streamedCreditResolverSteps(library)).resolve;

interface StreamedCreditLibrary {
  readonly artists: readonly { readonly id: number; readonly name: string }[];
  readonly albums: readonly (LibraryAlbumKey & { readonly id: number })[];
  readonly credits: Iterable<string>;
  readonly releases?: Iterable<StreamedRelease>;
}

/**
 * `streamedCredits` built a step per credit, artist, album and release, so
 * work that runs in slices never builds it for the whole Library at once.
 */
export function* streamedCreditResolverSteps(
  library: StreamedCreditLibrary,
): Generator<void, StreamedCreditResolver> {
  const split = yield* creditSplitterSteps(library.credits);
  const artistNamed = yield* libraryArtistFinderSteps(library.artists);
  const release = yield* libraryReleaseFinderSteps(artistNamed, library.albums);
  const releaseIds = new Map<string, string>();
  const learnOne = (song: StreamedRelease) => {
    if (song.album === null || song.albumId == null) return;
    for (const name of split(song.artists)) {
      const key = releaseKey(song.album, name);
      const previous = releaseIds.get(key);
      if (previous === undefined || song.albumId < previous) releaseIds.set(key, song.albumId);
    }
  };
  for (const song of library.releases ?? []) {
    learnOne(song);
    yield;
  }
  const resolve = (song: StreamedRelease): StreamedSongCredits => {
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
  return {
    resolve,
    learn: (songs) => {
      for (const song of songs) learnOne(song);
    },
  };
}
