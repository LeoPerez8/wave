/**
 * DJ's grid over a large Library (#1437): the opening page stops once it has
 * its tiles and the work runs in steps, and both give the tiles they gave
 * before. The expected digests were taken from the code before #1437.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DJ_GRID_TILES,
  djGrid,
  djGridCandidates,
  djGridCandidatesSteps,
  djOpeningGrid,
  djReopened,
  djReopenedSteps,
  finishSteps,
  genreMixDjCandidates,
  genreMixDjCandidatesSteps,
  libraryGenreProfiles,
  libraryMixProfilesSteps,
  type ArtistGraph,
  type DjAlbum,
  type DjTile,
  type GenreMixLibrary,
  type TasteProfile,
} from "./index.ts";

const TAGS = [
  "Rock",
  "Indie Rock",
  "Pop",
  "Hip Hop",
  "Rap",
  "Jazz",
  "Electronic",
  "House",
  "Metal",
  "Metalcore; Rock",
  "Punk",
  "Soul",
  "Funk",
  "Country",
  "Folk",
  "MPB",
  "Samba",
];

/** A seeded Library of [songs] songs by [artistCount] artists, with plays, albums, a graph and a taste profile. */
const largeLibrary = (songCount: number, artistCount: number) => {
  let seed = 1437;
  const random = (): number => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  const artists = Array.from({ length: artistCount }, (_, i) => ({
    id: i + 1,
    name: `Artist ${i + 1}`,
  }));
  const songs = Array.from({ length: songCount }, (_, i) => {
    const artist = artists[i % artistCount]!;
    return {
      id: i + 1,
      title: `Song ${i + 1}`,
      artist: artist.name,
      artistIds: [artist.id],
      durationMs: 200_000,
      addedAt: i,
      genre: TAGS[artist.id % TAGS.length]!,
    };
  });
  const plays = songs
    .filter((_, i) => i % 3 === 0)
    .map((song) => ({ id: song.id, countedPlays: 1 + (song.id % 7) }));
  const edges = new Map<string, Map<string, number>>();
  const names = new Map<string, string>();
  const everyone = artistCount + artistCount / 2;
  for (let i = 0; i < everyone; i++) {
    const key = `artist ${i + 1}`;
    names.set(key, `Artist ${i + 1}`);
    const of = new Map<string, number>();
    for (let n = 0; n < 8; n++) of.set(`artist ${1 + Math.floor(random() * everyone)}`, random());
    edges.set(key, of);
  }
  const graph: ArtistGraph = { edges, names };
  const taste: TasteProfile = {
    at: 0,
    songs: new Map(),
    artists: new Map(artists.map((artist) => [artist.name.toLowerCase(), random() - 0.1])),
    genres: new Map(
      ["rock", "pop", "hip hop", "jazz", "electronic", "metal", "soul", "country"].map((g) => [
        g,
        random(),
      ]),
    ),
  };
  const albums: DjAlbum[] = Array.from({ length: songCount / 2 }, (_, i) => ({
    title: `Album ${i + 1}`,
    artist: artists[(i * 7) % artistCount]!.name,
    libraryId: i + 1,
    cover: null,
    ...(i % 11 === 0 ? { compilation: true } : {}),
  }));
  const library: GenreMixLibrary = { artists, songs, plays, graph };
  return { artists, songs, plays, graph, taste, albums, library };
};

/** FNV-1a over [text], as hex: a short digest to compare against. */
const digest = (text: string): string => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16);
};

const tilesDigest = (tiles: readonly DjTile[]): string => digest(JSON.stringify(tiles));

const fixture = largeLibrary(1200, 360);
const families = genreMixDjCandidates(fixture.library);
const sources = {
  artists: fixture.artists,
  taste: fixture.taste,
  graph: fixture.graph,
  genreCandidates: families,
  albums: fixture.albums,
};

test("a large Library's genre families, grid and candidates are the ones they were before (#1437)", () => {
  assert.equal(digest(JSON.stringify(families)), "6076edd3");
  assert.equal(tilesDigest(djGrid(sources)), "2e11e57b");
  assert.equal(tilesDigest(djGridCandidates(sources)), "e09dca74");
  assert.equal(
    tilesDigest(djGrid({ ...sources, taste: null, played: [{ id: 3, name: "Artist 3", countedPlays: 4 }] })),
    "d338cb9",
  );
  const grid = djGrid(sources);
  const reopened = djReopened({
    grid,
    remembered: [grid[5]!, ...djGridCandidates(sources).slice(-2), grid.find((t) => t.kind === "genre")!],
    artists: fixture.artists,
    albums: fixture.albums,
    genreCandidates: families,
    taste: fixture.taste,
  });
  assert.equal(digest(JSON.stringify(reopened)), "2550d11b");
});

test("DJ's opening page is the complete candidate list's first page", () => {
  for (const taste of [fixture.taste, null]) {
    const at = { ...sources, taste, played: [{ id: 9, name: "Artist 9", countedPlays: 2 }] };
    assert.deepEqual(djGrid(at), djGridCandidates(at).slice(0, DJ_GRID_TILES));
  }
});

test("the families and the grid are worked out in steps that give the same result", () => {
  let steps = 0;
  const counted = function* <A>(work: Generator<void, A>): Generator<void, A> {
    for (;;) {
      const next = work.next();
      if (next.done) return next.value;
      steps++;
      yield;
    }
  };
  assert.deepEqual(finishSteps(counted(genreMixDjCandidatesSteps(fixture.library))), families);
  assert.ok(steps > fixture.songs.length, "the families yield at least once per song");
  steps = 0;
  assert.deepEqual(finishSteps(counted(djGridCandidatesSteps(sources))), djGridCandidates(sources));
  assert.ok(steps > fixture.artists.length, "the grid yields at least once per artist");
  assert.deepEqual(
    finishSteps(djGridCandidatesSteps(sources, DJ_GRID_TILES)).slice(0, DJ_GRID_TILES),
    djGrid(sources),
  );
});

test("DJ's opening takes a grid worked out beforehand in place of ranking again", () => {
  const grid = djGrid(sources);
  const mixes = { kind: "skeleton" } as const;
  assert.deepEqual(djOpeningGrid({ ...sources, artistMixes: mixes, grid }), djOpeningGrid({ ...sources, artistMixes: mixes }));
  assert.deepEqual(
    djOpeningGrid({ ...sources, artistMixes: mixes, grid: [] }),
    djOpeningGrid({ ...sources, taste: null, artistMixes: mixes }),
  );
});

test("DJ reopens in steps with the selection it reopened with before", () => {
  const grid = djGrid(sources);
  const at = {
    grid,
    artists: fixture.artists,
    albums: fixture.albums,
    genreCandidates: families,
    taste: fixture.taste,
  };
  const remembered = [grid[5]!, ...djGridCandidates(sources).slice(-2), grid.find((t) => t.kind === "genre")!];
  assert.deepEqual(finishSteps(djReopenedSteps({ ...at, remembered })), djReopened({ ...at, remembered }));
  assert.deepEqual(finishSteps(djReopenedSteps({ ...at, remembered: [] })), {
    tiles: grid,
    selected: [],
    rows: [],
  });
});

test("the families over the Library's genre profiles worked out in steps are the ones worked out on demand", () => {
  const { profileOf } = finishSteps(libraryMixProfilesSteps(fixture.library));
  assert.deepEqual(
    genreMixDjCandidates({ ...fixture.library, profileOf }),
    genreMixDjCandidates({ ...fixture.library, profileOf: libraryGenreProfiles(fixture.library) }),
  );
});
