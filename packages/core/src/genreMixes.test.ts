import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  blendDiscoverMix,
  discoverMix,
  discoverMixCaption,
  discoverMixFamiliarPool,
  discoverMixesBuilt,
  genreFamily,
  genreMixSeeds,
  interleaveRadios,
  mixKnownSongs,
  parseDiscoverMixes,
  storedDiscoverMixes,
} from "./index.ts";

interface Fixture {
  readonly genre: string | null;
  readonly artist: number;
  readonly plays?: number;
}

const ARTISTS = [
  { id: 1, name: "Bad Omens" },
  { id: 2, name: "Sleep Token" },
  { id: 3, name: "Spiritbox" },
  { id: 4, name: "Nothing But Thieves" },
  { id: 5, name: "Kendrick Lamar" },
  { id: 6, name: "Various Artists" },
  { id: 7, name: "Slowdive" },
  { id: 8, name: "Daft Punk" },
];

/** A Library of [songs], with ids from 1 in order and their plays. */
const libraryOf = (songs: readonly Fixture[]) => ({
  artists: ARTISTS,
  songs: songs.map((song, at) => ({
    id: at + 1,
    title: `Song ${at + 1}`,
    artist: ARTISTS.find((artist) => artist.id === song.artist)?.name ?? "",
    artistIds: [song.artist],
    durationMs: 200_000,
    addedAt: at,
    genre: song.genre,
  })),
  plays: songs.map((song, at) => ({ id: at + 1, countedPlays: song.plays ?? 0 })),
});

/** [count] songs of [genre] by [artist], each with [plays]. */
const songsOf = (count: number, genre: string | null, artist: number, plays = 0): Fixture[] =>
  Array.from({ length: count }, () => ({ genre, artist, plays }));

/** A random source that always answers [value]. */
const always = (value: number) => () => value;

describe("Genre families", () => {
  test("gather near-synonym tags under one family, whatever their case", () => {
    const names = ["Metalcore", "post-hardcore", "ALTERNATIVE METAL", "Nu Metal"].map(
      (tag) => genreFamily(tag)?.name,
    );
    assert.deepEqual(names, ["Metal", "Metal", "Metal", "Metal"]);
    assert.deepEqual(
      ["Rock", "Alternative", "Indie Rock", "hard rock"].map((tag) => genreFamily(tag)?.name),
      ["Rock", "Rock", "Rock", "Rock"],
    );
    assert.deepEqual(
      ["Rap/Hip Hop", "Hip-Hop", "Trap"].map((tag) => genreFamily(tag)?.name),
      ["Hip-Hop", "Hip-Hop", "Hip-Hop"],
    );
    assert.equal(genreFamily("Metalcore")?.key, genreFamily("Nu Metal")?.key);
    assert.notEqual(genreFamily("Metalcore")?.key, genreFamily("Rock")?.key);
  });

  test("make an unknown tag its own family, as typed", () => {
    assert.equal(genreFamily(" Shoegaze ")?.name, "Shoegaze");
    assert.equal(genreFamily("shoegaze")?.key, genreFamily("SHOEGAZE")?.key);
    assert.notEqual(genreFamily("Shoegaze")?.key, genreFamily("Metal")?.key);
  });

  test("a family's own name is of the family", () => {
    assert.equal(genreFamily("Metal")?.key, genreFamily("Metalcore")?.key);
    assert.equal(genreFamily("hip-hop")?.name, "Hip-Hop");
  });

  test("no tag is no family", () => {
    assert.equal(genreFamily(""), null);
    assert.equal(genreFamily("   "), null);
  });
});

describe("Genre mixes' families", () => {
  test("make one mix of near-synonym tags", () => {
    const library = libraryOf([
      ...songsOf(2, "Metalcore", 1),
      ...songsOf(2, "Post-Hardcore", 2),
      ...songsOf(2, "Alternative Metal", 3),
    ]);
    const seeds = genreMixSeeds(library, always(0));
    assert.deepEqual(
      seeds.map((seed) => seed.name),
      ["Metal"],
    );
    assert.equal(seeds[0]?.kind, "genre");
    assert.equal(seeds[0]?.genre, "Metal");
  });

  test("need five Library songs", () => {
    const library = libraryOf([...songsOf(4, "Shoegaze", 7, 50), ...songsOf(5, "House", 8)]);
    assert.deepEqual(
      genreMixSeeds(library, always(0)).map((seed) => seed.name),
      ["Electronic"],
    );
  });

  test("are ranked by their songs' counted plays, then by how many songs they have, four at most", () => {
    const library = libraryOf([
      ...songsOf(5, "Rock", 4, 1),
      ...songsOf(9, "Metalcore", 1),
      ...songsOf(6, "Trap", 5),
      ...songsOf(5, "Shoegaze", 7, 3),
      ...songsOf(7, "House", 8),
      ...songsOf(20, null, 2, 100),
    ]);
    assert.deepEqual(
      genreMixSeeds(library, always(0)).map((seed) => seed.name),
      ["Shoegaze", "Rock", "Metal", "Electronic"],
    );
  });

  test("read an unknown tag as typed, one family whatever its case", () => {
    const library = libraryOf([...songsOf(3, "Shoegaze", 7), ...songsOf(3, "shoegaze", 7)]);
    const seeds = genreMixSeeds(library, always(0));
    assert.deepEqual(
      seeds.map((seed) => seed.name),
      ["Shoegaze"],
    );
  });

  test("grow from up to three of the family's artists, picked at random, most played in the family first", () => {
    const library = libraryOf([
      ...songsOf(2, "Metalcore", 1, 40),
      ...songsOf(2, "Post-Hardcore", 2, 30),
      ...songsOf(2, "Alternative Metal", 3, 20),
      ...songsOf(2, "Nu Metal", 6, 50),
      ...songsOf(2, "Metal", 8, 10),
      // Played a lot, but not in the family.
      ...songsOf(5, "Rock", 4, 900),
      ...songsOf(1, "Metal", 4),
    ]);
    const metal = (random: () => number) =>
      genreMixSeeds(library, random)
        .find((seed) => seed.name === "Metal")
        ?.artists?.map((artist) => artist.name);
    assert.deepEqual(metal(always(0)), ["Bad Omens", "Sleep Token", "Spiritbox"]);
    assert.deepEqual(metal(always(0.999_999)), ["Spiritbox", "Daft Punk", "Nothing But Thieves"]);
  });

  test("pick the artists most played in the family more often", () => {
    // A fixed pseudo-random sequence (a linear congruential generator), so the test is the same every run.
    let state = 7;
    const random = () => {
      state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
      return state / 2_147_483_648;
    };
    const library = libraryOf([
      ...songsOf(5, "Metal", 1, 400),
      ...songsOf(1, "Metal", 2, 20),
      ...songsOf(1, "Metal", 3, 5),
      ...songsOf(1, "Metal", 4),
      ...songsOf(1, "Metal", 7),
    ]);
    const builds = Array.from(
      { length: 400 },
      () => genreMixSeeds(library, random)[0]?.artists?.map((artist) => artist.name) ?? [],
    );
    assert.ok(builds.every((names) => names.length === 3));
    const picks = (name: string) => builds.filter((names) => names.includes(name)).length;
    assert.ok(picks("Bad Omens") > picks("Sleep Token"));
    assert.ok(picks("Sleep Token") > picks("Slowdive"));
    assert.ok(picks("Slowdive") > 0);
    assert.ok(new Set(builds.map((names) => names.join("|"))).size > 3);
  });

  test("leave out a family whose artists can't seed", () => {
    const library = libraryOf([...songsOf(9, "Soundtrack", 6, 90), ...songsOf(5, "Rock", 4)]);
    assert.deepEqual(
      genreMixSeeds(library, always(0)).map((seed) => seed.name),
      ["Rock"],
    );
  });

  test("have different ids", () => {
    const library = libraryOf([...songsOf(5, "Rock", 4), ...songsOf(5, "Metal", 1)]);
    const ids = genreMixSeeds(library, always(0)).map((seed) => seed.id);
    assert.equal(new Set(ids).size, 2);
  });
});

describe("A genre mix's radios", () => {
  test("take turns, in the seed artists' order, until each runs out", () => {
    assert.deepEqual(interleaveRadios([["a1", "a2", "a3"], ["b1"], ["c1", "c2"]]), [
      "a1",
      "b1",
      "c1",
      "a2",
      "c2",
      "a3",
    ]);
  });

  test("of one artist are that radio", () => {
    assert.deepEqual(interleaveRadios([["a1", "a2"]]), ["a1", "a2"]);
    assert.deepEqual(interleaveRadios([]), []);
  });
});

describe("A genre mix", () => {
  const radioSongs = (count: number) =>
    Array.from({ length: count }, (_, n) => ({
      videoId: `v${n}`,
      title: `Song ${n}`,
      artists: [n % 2 === 0 ? "Architects" : "Spiritbox"],
      album: null,
      albumId: null,
      durationMs: 200_000,
      artworkUrl: null,
      explicit: false,
      video: false,
    }));
  const seedOf = (genre: string) =>
    genreMixSeeds(
      libraryOf([...songsOf(3, genre, 1, 10), ...songsOf(3, genre, 2, 5)]),
      always(0),
    )[0]!;

  test("is named after its family, keeps its seed artists, and is saved and read back as one", () => {
    const seed = seedOf("Metalcore");
    const mix = discoverMix(seed, radioSongs(12));
    assert.ok(mix !== null);
    assert.deepEqual(mix.seed, {
      kind: "genre",
      name: "Metal",
      genre: "Metal",
      artists: ["Bad Omens", "Sleep Token"],
    });
    assert.equal(discoverMixCaption(blendDiscoverMix(mix, { level: 5 })).title, "Metal mix");
    const built = discoverMixesBuilt([mix], 1, [seed]);
    const again = parseDiscoverMixes(storedDiscoverMixes(built!));
    assert.deepEqual(again?.mixes[0]?.seed, mix.seed);
    assert.equal(again?.mixes[0]?.id, "genre:metal");
  });

  test("takes its Library pool from its family's songs, the most played first", () => {
    const library = libraryOf([
      ...songsOf(1, "Metalcore", 1, 3),
      ...songsOf(1, "Rock", 4, 50),
      ...songsOf(1, "Post-Hardcore", 2, 9),
      ...songsOf(1, "Nu Metal", 3),
      ...songsOf(1, "metal", 1, 1),
      ...songsOf(1, null, 1, 70),
      ...songsOf(1, "Deathcore", 2),
    ]);
    const [seed] = genreMixSeeds(library, always(0));
    const pool = discoverMixFamiliarPool(seed!, {
      radio: [],
      known: mixKnownSongs({
        library: library.songs,
        playedRecordingKeys: [],
        streamed: [],
        playlisted: [],
      }),
      library,
      taken: { tracks: new Set([4]), videos: new Set() },
      length: 20,
    });
    assert.deepEqual(
      pool.map((song) => (song.source === "library" ? song.track.id : song.song.videoId)),
      [3, 1, 5, 7],
    );
  });

  test("of an unknown tag typed in lowercase is capitalised", () => {
    const mix = discoverMix(seedOf("dream pop shoegaze"), radioSongs(12));
    assert.equal(
      mix && discoverMixCaption(blendDiscoverMix(mix, { level: 5 })).title,
      "Dream Pop Shoegaze mix",
    );
  });
});
