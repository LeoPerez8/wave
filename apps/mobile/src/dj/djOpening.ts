/**
 * What DJ's grid opens on (#1352): the Library snapshot's genre families, the
 * albums its tiles may show, the opening grid and the selection DJ reopens
 * with, worked out once per snapshot and kept (the last one only), so DJ opens
 * on its tiles. `readyScreens.ts` prepares it after startup; DJ opened first
 * prepares it itself. All of it runs in background steps (#1437): a 3,000-song
 * Library blocked the JS thread for 470 ms when it ran in one go.
 */
import {
  djGridCandidatesSteps,
  djReopenedSteps,
  djTileArtist,
  DJ_GRID_TILES,
  genreMixDjCandidatesSteps,
  libraryMixProfilesSteps,
  type ArtistGraph,
  type DjAlbum,
  type DjState,
  type DjTile,
  type GenreMixDjCandidate,
  type TasteProfile,
} from "@wave/core";
import * as Effect from "effect/Effect";

import { lookedUpProfileOf } from "@/home/artistGenres";
import type { MixIndexes } from "@/home/mixKnown";
import { recommendationSnapshot } from "@/home/recommendationSnapshot";
import { savedYtArtist } from "@/home/ytArtistPage";
import { recommendationTurnEffect } from "@/lib/recommendationWork";
import { namedWork, runSteps } from "@/lib/stepped";
import { libraryRows } from "@/library/libraryRows";
import { LibraryStore } from "@/library/LibraryStore";
import { appRuntime } from "@/library/runtime";
import { latestTasteProfile } from "@/playback/TasteProfile";
import type { AlbumRow } from "@wave/client";

import { readDjAlbums } from "./djAlbums";
import { djRemembered } from "./djRemembered";

/** What DJ's grid is drawn from, for one Library snapshot, and what it opens on. */
export interface DjOpeningRead {
  readonly library: MixIndexes;
  readonly families: readonly GenreMixDjCandidate[];
  readonly albums: readonly DjAlbum[];
  /** The opening grid (`djGrid`) over the taste profile and graph below. */
  readonly grid: readonly DjTile[];
  /** DJ reopened over [grid] with the [remembered] selection (`djReopened`). */
  readonly reopened: DjState;
  readonly taste: TasteProfile | null;
  readonly graph: ArtistGraph | null;
  readonly remembered: readonly DjTile[];
}

/** Runs Core's [steps] in recommendation turns, named for the JS block log. */
const inSteps = <A>(name: string, steps: Generator<void, A>): Promise<A> =>
  Effect.runPromise(runSteps(steps, recommendationTurnEffect).pipe(namedWork(name)));

/** Genre mixes' families over [library] (`genreMixDjCandidates`), with the Library's genre profiles. */
function* familiesSteps(
  library: MixIndexes,
  graph: ArtistGraph | null,
): Generator<void, readonly GenreMixDjCandidate[]> {
  const { profileOf } = yield* libraryMixProfilesSteps(library);
  return yield* genreMixDjCandidatesSteps({
    artists: library.artists,
    songs: library.songs,
    plays: library.plays,
    graph,
    profileOf: (artist) => profileOf(artist) ?? lookedUpProfileOf(artist),
  });
}

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
const albumsOver = async (
  library: MixIndexes,
  families: readonly GenreMixDjCandidate[],
  complete = false,
): Promise<DjAlbum[]> => {
  const tiles = await inSteps(
    "DJ grid candidates",
    djGridCandidatesSteps(gridSources(library, families), complete ? Infinity : DJ_GRID_TILES),
  );
  const artists = new Set(
    (complete ? tiles : tiles.slice(0, DJ_GRID_TILES)).flatMap((tile) =>
      tile.kind === "genre" ? tile.opens.map(djTileArtist) : [djTileArtist(tile)],
    ),
  );
  const names = new Map(library.artists.map((artist) => [artist.id, artist.name]));
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

/** A snapshot's families and albums: they don't change with the taste profile. */
interface DjOpeningBase {
  readonly library: MixIndexes;
  readonly families: readonly GenreMixDjCandidate[];
  readonly albums: readonly DjAlbum[];
}

let base: { readonly library: MixIndexes; readonly read: Promise<DjOpeningBase> } | null = null;

const baseOf = (library: MixIndexes): Promise<DjOpeningBase> => {
  if (base?.library === library) return base.read;
  const read = (async () => {
    const families = await inSteps(
      "DJ opening",
      familiesSteps(library, recommendationSnapshot.peek().graph),
    );
    const albums = await albumsOver(library, families);
    return { library, families, albums };
  })();
  base = { library, read };
  read.catch(() => {
    if (base?.read === read) base = null;
  });
  return read;
};

let prepared: DjOpeningRead | null = null;
let preparing: { readonly library: MixIndexes; readonly read: Promise<DjOpeningRead> } | null =
  null;

/** Whether [read] was ranked over the taste profile, graph and selection the phone has now. */
const fresh = (read: DjOpeningRead): boolean =>
  read.taste === latestTasteProfile() &&
  read.graph === recommendationSnapshot.peek().graph &&
  read.remembered === djRemembered.get().tiles;

/** What DJ opens on for [library] when it is prepared already and still current; null otherwise. */
export const preparedDjOpening = (library: MixIndexes): DjOpeningRead | null =>
  prepared?.library === library && fresh(prepared) ? prepared : null;

/** Works out what DJ opens on for [library], once per snapshot and taste, keeping the last. */
export const readDjOpening = (library: MixIndexes): Promise<DjOpeningRead> => {
  const ready = preparedDjOpening(library);
  if (ready !== null) return Promise.resolve(ready);
  if (preparing?.library === library) return preparing.read;
  const read = (async (): Promise<DjOpeningRead> => {
    const { families, albums } = await baseOf(library);
    const taste = latestTasteProfile();
    const graph = recommendationSnapshot.peek().graph;
    const remembered = djRemembered.get().tiles;
    const sources = { ...gridSources(library, families), taste, graph, albums };
    const grid = (await inSteps("DJ opening", djGridCandidatesSteps(sources, DJ_GRID_TILES))).slice(
      0,
      DJ_GRID_TILES,
    );
    const reopened = await inSteps(
      "DJ opening",
      djReopenedSteps({
        grid,
        remembered,
        artists: library.artists,
        albums,
        genreCandidates: families,
        taste,
      }),
    );
    return { library, families, albums, grid, reopened, taste, graph, remembered };
  })();
  preparing = { library, read };
  read.then(
    (opening) => {
      prepared = opening;
      if (preparing?.read === read) preparing = null;
    },
    () => {
      if (preparing?.read === read) preparing = null;
    },
  );
  return read;
};

/** Reads the full grid only when paging or refreshing first needs its candidates. */
export const readDjGridCandidates = async (opening: DjOpeningRead): Promise<DjTile[]> => {
  const albums = await albumsOver(opening.library, opening.families, true);
  return inSteps(
    "DJ grid candidates",
    djGridCandidatesSteps({ ...gridSources(opening.library, opening.families), albums }),
  );
};

/** Prepares DJ's opening from the snapshot Home's mixes read (shared with them). */
export const prepareDjOpening = async (): Promise<void> => {
  const library =
    recommendationSnapshot.peek().library ??
    (await appRuntime.runPromise(recommendationSnapshot.library));
  await readDjOpening(library);
};
