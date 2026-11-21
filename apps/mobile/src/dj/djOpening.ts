/**
 * What DJ's grid opens on (#1352): the Library snapshot's genre families and
 * the albums its tiles may show, worked out once per snapshot and kept (the
 * last one only), so DJ opens on its tiles. `readyScreens.ts` prepares it
 * after startup; DJ opened first prepares it itself.
 */
import {
  djGrid,
  djTileArtist,
  genreMixDjCandidates,
  type DjAlbum,
  type GenreMixDjCandidate,
} from "@wave/core";
import * as Effect from "effect/Effect";

import { magicProfileOf } from "@/home/artistGenres";
import { inSlice } from "@/lib/backgroundWork";
import type { MixIndexes } from "@/home/mixKnown";
import { recommendationSnapshot } from "@/home/recommendationSnapshot";
import { savedYtArtist } from "@/home/ytArtistPage";
import { libraryRows } from "@/library/libraryRows";
import { LibraryStore } from "@/library/LibraryStore";
import { appRuntime } from "@/library/runtime";
import { latestTasteProfile } from "@/playback/TasteProfile";
import type { AlbumRow } from "@wave/client";

import { readDjAlbums } from "./djAlbums";

/** What DJ's grid is drawn from, for one Library snapshot. */
export interface DjOpeningRead {
  readonly library: MixIndexes;
  readonly families: readonly GenreMixDjCandidate[];
  readonly albums: readonly DjAlbum[];
}

/** Genre mixes' families over [library] (`genreMixDjCandidates`): worked out once per Library snapshot. */
const familiesOf = (library: MixIndexes): readonly GenreMixDjCandidate[] =>
  genreMixDjCandidates({
    artists: library.artists,
    songs: library.songs,
    plays: library.plays,
    graph: recommendationSnapshot.peek().graph,
    profileOf: magicProfileOf(library),
  });

/** What DJ's grid ranks its artists by, as Core's `djGrid` takes it, with [library]'s [families]. */
export const gridSources = (library: MixIndexes, families: readonly GenreMixDjCandidate[]) => ({
  artists: library.artists,
  taste: latestTasteProfile(),
  played: library.topArtists,
  graph: recommendationSnapshot.peek().graph,
  genreCandidates: families,
});

/**
 * The albums DJ's grid may show over [library] (`readDjAlbums`), all read on
 * the phone: the Library's albums, each under its album artist's name and
 * with its cached cover (a compilation marked, so the grid leaves it out and
 * only a remembered one is found again among them), then the albums the saved
 * YT Music pages of the grid's artists list (the grid as it is without
 * albums, which holds every artist the one with albums shows).
 */
const albumsOver = (
  library: MixIndexes,
  families: readonly GenreMixDjCandidate[],
): Promise<DjAlbum[]> => {
  const names = new Map(library.artists.map((artist) => [artist.id, artist.name]));
  const artists = new Set(
    djGrid(gridSources(library, families)).flatMap((tile) =>
      tile.kind === "genre" ? tile.opens.map(djTileArtist) : [djTileArtist(tile)],
    ),
  );
  return readDjAlbums([...artists], {
    library: () =>
      // The Albums list in memory when Search's index holds it (#1352), else read.
      albumsInMemory().then((albums) =>
        albums.map((album): DjAlbum => ({
          title: album.title,
          artist: names.get(album.albumArtistId) ?? album.albumArtist,
          libraryId: album.id,
          cover: album.artworkPath ?? album.thumbPath,
          compilation: album.compilation,
        })),
      ),
    saved: async (artist) => {
      const saved = await appRuntime.runPromise(savedYtArtist(artist));
      return saved?.outcome === "found"
        ? saved.page.albums.map((album) => ({
            title: album.title,
            artist,
            browseId: album.browseId,
            cover: album.artworkUrl,
          }))
        : [];
    },
  });
};

const albumsInMemory = (): Promise<readonly AlbumRow[]> => {
  const albums = libraryRows()?.albums;
  if (albums !== undefined) return Promise.resolve(albums);
  return appRuntime.runPromise(
    Effect.gen(function* () {
      return yield* (yield* LibraryStore).listAlbums;
    }),
  );
};

let prepared: DjOpeningRead | null = null;
let preparing: { readonly library: MixIndexes; readonly read: Promise<DjOpeningRead> } | null =
  null;

/** What DJ opens on for [library] when it is prepared already; null otherwise. */
export const preparedDjOpening = (library: MixIndexes): DjOpeningRead | null =>
  prepared?.library === library ? prepared : null;

/** Works out what DJ opens on for [library], once per snapshot, keeping the last. */
export const readDjOpening = (library: MixIndexes): Promise<DjOpeningRead> => {
  const ready = preparedDjOpening(library);
  if (ready !== null) return Promise.resolve(ready);
  if (preparing?.library === library) return preparing.read;
  const families = familiesOf(library);
  const read = albumsOver(library, families).then((albums) => {
    const opening = { library, families, albums };
    prepared = opening;
    if (preparing?.library === library) preparing = null;
    return opening;
  });
  preparing = { library, read };
  return read;
};

/** Prepares DJ's opening from the snapshot Home's mixes read (shared with them). */
export const prepareDjOpening = async (): Promise<void> => {
  const library =
    recommendationSnapshot.peek().library ??
    (await appRuntime.runPromise(recommendationSnapshot.library));
  // Genre mixes' families and the grid run here, after an await: a named slice, not "startup".
  await inSlice("DJ opening", () => readDjOpening(library));
};
