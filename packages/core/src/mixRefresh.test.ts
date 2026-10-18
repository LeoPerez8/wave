import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  artistMixSeeds,
  artistMixSimilarSource,
  discoverMix,
  discoverMixesBuilt,
  discoverMixesDue,
  MIX_PULL_THRESHOLD,
  mixPull,
  mixRefreshWaitNotice,
  NO_SEARCHES,
  parseMixesShown,
  SEARCH_WINDOW_MS,
  searchRoomAt,
  storedMixesShown,
  undoneMixRefresh,
  discoverMixSongs,
  genreFamily,
  genreMixSeeds,
  mixesShown,
  mixRefreshAvoid,
  type DiscoverMixSeed,
  type DiscoverMixes,
} from "./index.ts";

const played = (id: number, name: string, countedPlays: number) => ({ id, name, countedPlays });
const library = (id: number, name: string, songCount: number) => ({ id, name, songCount });

/** A random source that always answers [value]. */
const always = (value: number) => () => value;

const yt = (videoId: string, artist: string) => ({
  videoId,
  title: `Song ${videoId}`,
  artists: [artist],
  album: null,
  albumId: null,
  durationMs: 200_000,
  artworkUrl: null,
  explicit: false,
  video: false,
});

const artistSeed = (name: string): DiscoverMixSeed => ({
  kind: "artist",
  id: `artist:${name.toLowerCase()}`,
  name,
  from: "plays",
});

/** Artist mixes built at [builtAt] from [names], each with ten new songs `<name>-<n>`. */
const artistMixes = (builtAt: number, names: readonly string[]): DiscoverMixes => {
  const seeds = names.map(artistSeed);
  const mixes = seeds.flatMap(
    (seed) =>
      discoverMix(
        seed,
        Array.from({ length: 10 }, (_, at) => yt(`${seed.name}-${at}`, seed.name)),
      ) ?? [],
  );
  const built = discoverMixesBuilt(mixes, builtAt, seeds);
  assert.ok(built !== null);
  return built;
};

const on = (day: number, hour: number) => new Date(2026, 9, day, hour).getTime();

const seedNames = (seeds: readonly DiscoverMixSeed[]) =>
  seeds.map((seed) => `${seed.from}: ${seed.name}`);

const MOST_PLAYED = [
  played(1, "Bad Omens", 600),
  played(2, "Sleep Token", 500),
  played(3, "Spiritbox", 400),
  played(4, "Bring Me the Horizon", 300),
  played(5, "Nothing But Thieves", 200),
  played(6, "Architects", 100),
];

const LIBRARY = [
  ...MOST_PLAYED.map((artist) => library(artist.id, artist.name, 30)),
  library(7, "Loathe", 20),
  library(8, "Deftones", 25),
];

describe("A refreshed mix's new songs", () => {
  const filter = (avoid: ReadonlySet<string>) => ({
    known: () => false,
    taken: new Set<string>(),
    avoid,
  });
  const radio = Array.from({ length: 30 }, (_, at) => yt(`v${at}`, "Dayseeker"));
  const ids = (songs: readonly { videoId: string }[]) => songs.map((song) => song.videoId);

  test("leave out the new songs of every set shown today", () => {
    const shown = artistMixes(on(18, 9), ["Dayseeker"]);
    const avoid = mixRefreshAvoid(mixesShown([], shown, on(18, 9)), on(18, 10)).songs;
    const songs = discoverMixSongs([[yt("Dayseeker-3", "Dayseeker"), ...radio]], filter(avoid));
    assert.deepEqual(ids(songs), ids(radio));
  });

  test("take shown songs back, in the radio's order, only to make up a mix", () => {
    const avoid = new Set(ids(radio).slice(0, 25));
    const songs = discoverMixSongs([radio], filter(avoid));
    assert.deepEqual(ids(songs), ["v0", "v1", "v2", "v3", "v4", "v25", "v26", "v27", "v28", "v29"]);
  });
});

describe("A refresh of Artist mixes", () => {
  test("picks other seed artists than the set just shown", () => {
    const now = on(18, 10);
    const shown = artistMixes(on(18, 9), [
      "Bad Omens",
      "Sleep Token",
      "Spiritbox",
      "Bring Me the Horizon",
    ]);
    const avoid = mixRefreshAvoid(mixesShown([], shown, now), now);
    const seeds = artistMixSeeds({ played: MOST_PLAYED, library: LIBRARY, avoid }, always(0));
    assert.deepEqual(seedNames(seeds), [
      "plays: Nothing But Thieves",
      "plays: Architects",
      "library: Deftones",
      "library: Loathe",
    ]);
  });

  test("with nothing different left, brings back the least recently shown artists first", () => {
    const first = artistMixes(on(18, 9), [
      "Bad Omens",
      "Sleep Token",
      "Spiritbox",
      "Bring Me the Horizon",
    ]);
    const second = artistMixes(on(18, 10), [
      "Nothing But Thieves",
      "Architects",
      "Bad Omens",
      "Sleep Token",
    ]);
    const memory = mixesShown(mixesShown([], first, on(18, 9)), second, on(18, 10));
    const avoid = mixRefreshAvoid(memory, on(18, 11));
    const seeds = artistMixSeeds({ played: MOST_PLAYED, avoid }, always(0));
    assert.deepEqual(seedNames(seeds), [
      "plays: Spiritbox",
      "plays: Bring Me the Horizon",
      "plays: Bad Omens",
      "plays: Sleep Token",
    ]);
  });

  test("forgets the sets shown on an earlier day", () => {
    const yesterday = artistMixes(on(17, 21), ["Nothing But Thieves", "Architects"]);
    const today = artistMixes(on(18, 9), [
      "Bad Omens",
      "Sleep Token",
      "Spiritbox",
      "Bring Me the Horizon",
    ]);
    const memory = mixesShown(mixesShown([], yesterday, on(17, 21)), today, on(18, 9));
    const avoid = mixRefreshAvoid(memory, on(18, 10));
    assert.deepEqual(
      seedNames(artistMixSeeds({ played: MOST_PLAYED, avoid }, always(0))).slice(0, 2),
      ["plays: Nothing But Thieves", "plays: Architects"],
    );
    assert.deepEqual(mixRefreshAvoid(memory, on(19, 8)).artists.size, 0);
  });

  test("reads similar artists' pages when the Library's other artists are too few", () => {
    const shown = artistMixes(on(18, 9), ["Bad Omens", "Sleep Token"]);
    const avoid = mixRefreshAvoid(mixesShown([], shown, on(18, 9)), on(18, 10));
    const pools = {
      played: [played(1, "Bad Omens", 600), played(2, "Sleep Token", 500)],
      library: [library(1, "Bad Omens", 30), library(2, "Sleep Token", 20)],
    };
    // Without the avoid-list, the two Library artists leave room for two similar ones.
    assert.equal(artistMixSimilarSource(pools)?.name, "Bad Omens");
    const similar = [
      {
        of: "Bad Omens",
        artists: [
          { name: "Sleep Theory", browseId: "UC-st" },
          { name: "Dayseeker", browseId: "UC-ds" },
          { name: "Holding Absence", browseId: "UC-ha" },
          { name: "Thornhill", browseId: "UC-th" },
        ],
      },
    ];
    const seeds = artistMixSeeds({ ...pools, similar, avoid }, always(0));
    assert.deepEqual(seedNames(seeds), [
      "similar: Sleep Theory",
      "similar: Dayseeker",
      "similar: Holding Absence",
      "similar: Thornhill",
    ]);
    // A refresh asks for another page while its seeds are short.
    assert.equal(
      artistMixSimilarSource({ ...pools, similar: similar.slice(0, 0), avoid })?.name,
      "Bad Omens",
    );
    assert.equal(artistMixSimilarSource({ ...pools, similar, avoid }), null);
  });
});

describe("A refresh of Genre mixes", () => {
  /** A Library where each of [families] has five songs per artist, the earlier more played. */
  const libraryOf = (
    families: readonly (readonly [genre: string, artists: readonly string[]])[],
  ) => {
    const names = families.flatMap(([, artists]) => artists);
    const artists = names.map((name, at) => ({ id: at + 1, name }));
    const songs = families.flatMap(([genre, of], family) =>
      of.flatMap((name, artist) =>
        Array.from({ length: 5 }, (_, at) => ({
          id: family * 1000 + artist * 10 + at + 1,
          title: `${name} ${at}`,
          artist: name,
          artistIds: [names.indexOf(name) + 1],
          durationMs: 200_000,
          addedAt: 0,
          genre,
          plays: (families.length - family) * 100 + (of.length - artist) * 10,
        })),
      ),
    );
    return {
      artists,
      songs,
      plays: songs.map((song) => ({ id: song.id, countedPlays: song.plays })),
    };
  };

  /** Genre mixes built at [builtAt], one per family, from its artists. */
  const genreMixes = (
    builtAt: number,
    families: readonly (readonly [genre: string, artists: readonly string[]])[],
  ): DiscoverMixes => {
    const seeds: DiscoverMixSeed[] = families.map(([genre, artists]) => ({
      kind: "genre",
      id: `genre:${genreFamily(genre)?.key}`,
      name: genre,
      from: "plays",
      genre,
      artists: artists.map((name, at) => ({ id: at, name })),
    }));
    const mixes = seeds.flatMap(
      (seed) =>
        discoverMix(
          seed,
          Array.from({ length: 10 }, (_, at) => yt(`${seed.id}-${builtAt}-${at}`, seed.name)),
        ) ?? [],
    );
    const built = discoverMixesBuilt(mixes, builtAt, seeds);
    assert.ok(built !== null);
    return built;
  };

  const seedArtists = (seeds: readonly DiscoverMixSeed[]) =>
    seeds.map((seed) => `${seed.name}: ${(seed.artists ?? []).map((a) => a.name).join(", ")}`);

  test("keep their families but grow from other family artists", () => {
    const songs = libraryOf([
      ["Metal", ["Bad Omens", "Sleep Token", "Spiritbox", "Architects", "Loathe"]],
      ["Rock", ["Nothing But Thieves", "Muse"]],
    ]);
    const shown = genreMixes(on(18, 9), [
      ["Metal", ["Bad Omens", "Sleep Token", "Spiritbox"]],
      ["Rock", ["Nothing But Thieves", "Muse"]],
    ]);
    const avoid = mixRefreshAvoid(mixesShown([], shown, on(18, 9)), on(18, 10));
    assert.deepEqual(seedArtists(genreMixSeeds(songs, always(0), avoid)), [
      "Metal: Architects, Loathe, Bad Omens",
      "Rock: Nothing But Thieves, Muse",
    ]);
  });

  test("bring in other families when there are more than four", () => {
    const families = [
      ["Metal", ["Bad Omens"]],
      ["Rock", ["Muse"]],
      ["Hip-Hop", ["Kendrick Lamar"]],
      ["Electronic", ["Daft Punk"]],
      ["Jazz", ["Kamasi Washington"]],
      ["Folk", ["Bon Iver"]],
    ] as const;
    const songs = libraryOf(families);
    assert.deepEqual(
      genreMixSeeds(songs, always(0)).map((seed) => seed.name),
      ["Metal", "Rock", "Hip-Hop", "Electronic"],
    );
    const shown = genreMixes(on(18, 9), families.slice(0, 4));
    const avoid = mixRefreshAvoid(mixesShown([], shown, on(18, 9)), on(18, 10));
    assert.deepEqual(
      genreMixSeeds(songs, always(0), avoid).map((seed) => seed.name),
      ["Metal", "Rock", "Jazz", "Folk"],
    );
  });
});

describe("Undo after a refresh", () => {
  test("puts the previous set back, as the day's build", () => {
    const previous = artistMixes(on(17, 21), ["Bad Omens", "Sleep Token"]);
    const refreshed = artistMixes(on(18, 10), ["Spiritbox", "Architects"]);
    const undone = undoneMixRefresh(previous, refreshed, on(18, 10) + 5_000);
    assert.deepEqual(undone.mixes, previous.mixes);
    assert.equal(discoverMixesDue(undone, { now: on(18, 12), played: true }), false);
    assert.equal(discoverMixesDue(undone, { now: on(19, 8), played: true }), true);
  });

  test("keeps both sets in the memory, the one put back the most recently shown", () => {
    const previous = artistMixes(on(18, 9), ["Bad Omens", "Sleep Token"]);
    const refreshed = artistMixes(on(18, 10), ["Spiritbox", "Architects"]);
    const undone = undoneMixRefresh(previous, refreshed, on(18, 11));
    const memory = mixesShown(
      mixesShown(mixesShown([], previous, on(18, 9)), refreshed, on(18, 10)),
      undone,
      on(18, 11),
    );
    const avoid = mixRefreshAvoid(memory, on(18, 12));
    assert.deepEqual(
      new Set(avoid.artists.keys()),
      new Set(["architects", "bad omens", "sleep token", "spiritbox"]),
    );
    const seeds = artistMixSeeds(
      { played: MOST_PLAYED.filter((artist) => artist.id <= 3 || artist.id === 6), avoid },
      always(0),
    );
    // Spiritbox and Architects were last shown before Undo brought the others back.
    assert.deepEqual(seedNames(seeds).slice(0, 2), ["plays: Spiritbox", "plays: Architects"]);
  });
});

describe("What a section showed today", () => {
  test("is saved and read back", () => {
    const shown = artistMixes(on(18, 9), ["Bad Omens", "Sleep Token"]);
    const memory = mixesShown([], shown, on(18, 9));
    assert.deepEqual(parseMixesShown(storedMixesShown(memory)), memory);
  });

  test("reads as nothing when nothing readable is saved", () => {
    assert.deepEqual(parseMixesShown(null), []);
    assert.deepEqual(parseMixesShown("{"), []);
    assert.deepEqual(parseMixesShown('{"sets":[{"builtAt":"x"}]}'), []);
  });
});

describe("Pulling a mixes carousel", () => {
  test("moves the row less than the finger, more slowly the further it goes", () => {
    assert.equal(mixPull(0).offset, 0);
    assert.equal(mixPull(-40).offset, 0);
    const near = mixPull(40).offset;
    const far = mixPull(400).offset;
    assert.ok(near > 0 && near < 40);
    assert.ok(far > near && far < 200);
  });

  test("arms the refresh past the threshold, not before", () => {
    assert.equal(mixPull(MIX_PULL_THRESHOLD - 1).armed, false);
    assert.equal(mixPull(MIX_PULL_THRESHOLD).armed, true);
    assert.equal(mixPull(MIX_PULL_THRESHOLD / 2).progress, 0.5);
    assert.equal(mixPull(MIX_PULL_THRESHOLD * 3).progress, 1);
  });
});

describe("A refresh held back by the search allowance", () => {
  test("says when the mixes come", () => {
    assert.equal(
      mixRefreshWaitNotice(4 * 60_000 + 10_000),
      "Search limit reached · new mixes in about 5 min",
    );
    assert.equal(mixRefreshWaitNotice(5_000), "Search limit reached · new mixes in about 1 min");
  });

  test("is told only when the window has no room for a mix's search", () => {
    const now = 1_000_000_000;
    const full = {
      ...NO_SEARCHES,
      searchesAt: Array.from({ length: 1000 }, (_, at) => now - 60_000 + at),
    };
    assert.equal(searchRoomAt(NO_SEARCHES, "discover", now), null);
    assert.equal(searchRoomAt(full, "discover", now), now - 60_000 + SEARCH_WINDOW_MS);
    const old = { ...full, searchesAt: full.searchesAt.map((time) => time - SEARCH_WINDOW_MS) };
    assert.equal(searchRoomAt(old, "discover", now), null);
  });
});
