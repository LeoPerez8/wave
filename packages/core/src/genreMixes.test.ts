import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  artistMixSeeds,
  blendDiscoverMix,
  discoverMix,
  discoverMixCaption,
  discoverMixFamiliarPool,
  discoverMixesBuilt,
  discoverMixesDue,
  genreFamily,
  artistGraph,
  genreMixSeeds,
  interleaveRadios,
  mixKnownSongs,
  mixSectionOfId,
  mixSeedArtists,
  parseDiscoverMixes,
  storedDiscoverMixes,
} from "./index.ts";

interface Fixture {
  readonly genre: string | null;
  readonly artist: number;
  readonly plays?: number;
  /** Every value of a multi-value genre tag, where [genre] is the first. */
  readonly genres?: readonly string[];
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
    ...(song.genres === undefined ? {} : { genres: song.genres }),
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

  test("grow from the three most played artists in the family regardless of randomness", () => {
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
    assert.deepEqual(metal(always(0.999_999)), ["Bad Omens", "Sleep Token", "Spiritbox"]);
  });

  test("a pull draws the next three artists, then recycles the least recently shown", () => {
    const library = libraryOf([
      ...songsOf(1, "Metal", 1, 60),
      ...songsOf(1, "Metal", 2, 50),
      ...songsOf(1, "Metal", 3, 40),
      ...songsOf(1, "Metal", 4, 30),
      ...songsOf(1, "Metal", 7, 20),
      ...songsOf(1, "Metal", 8, 10),
    ]);
    const artists = (shown: [string, number][]) =>
      genreMixSeeds(library, always(0.999), {
        mixes: new Map(),
        artists: new Map(shown),
        songs: new Set(),
      })[0]?.artists?.map((artist) => artist.name);
    assert.deepEqual(artists([]), ["Bad Omens", "Sleep Token", "Spiritbox"]);
    assert.deepEqual(
      artists([
        ["bad omens", 1],
        ["sleep token", 1],
        ["spiritbox", 1],
      ]),
      ["Nothing But Thieves", "Slowdive", "Daft Punk"],
    );
    assert.deepEqual(
      artists([
        ["bad omens", 3],
        ["sleep token", 1],
        ["spiritbox", 2],
        ["nothing but thieves", 4],
        ["slowdive", 4],
        ["daft punk", 4],
      ]),
      ["Sleep Token", "Spiritbox", "Bad Omens"],
    );
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

describe("Genre mixes for artists without a genre", () => {
  const graph = artistGraph({
    catalog: [],
    plays: [],
    pages: [
      {
        name: "Sleep Token",
        similar: ["Kendrick Lamar", "Bad Omens", "Spiritbox"].map((name) => ({
          name,
          browseId: name,
          audience: null,
        })),
      },
    ],
  });

  test("inherit the family with most closeness-weighted known neighbour support", () => {
    const library = {
      ...libraryOf([
        ...songsOf(5, null, 2, 10),
        ...songsOf(1, "Hip-Hop", 5),
        ...songsOf(1, "Metalcore", 1),
        ...songsOf(1, "Metal", 3),
      ]),
      graph,
    };
    const [seed] = genreMixSeeds(library, always(0));
    assert.equal(seed?.name, "Metal");
    assert.deepEqual(
      seed?.artists?.map((artist) => artist.name),
      ["Sleep Token", "Bad Omens", "Spiritbox"],
    );
  });

  test("stay out without any neighbour with a known family, including on a cold graph", () => {
    const library = libraryOf(songsOf(5, null, 2, 10));
    assert.deepEqual(genreMixSeeds({ ...library, graph }, always(0)), []);
    assert.deepEqual(genreMixSeeds({ ...library, graph: null }, always(0)), []);
  });

  test("use closeness rather than neighbour counts and can read already-kept profiles", () => {
    const library = {
      ...libraryOf(songsOf(5, null, 2)),
      graph: {
        names: new Map([
          ["kendrick lamar", "Kendrick Lamar"],
          ["bad omens", "Bad Omens"],
          ["spiritbox", "Spiritbox"],
        ]),
        edges: new Map([
          [
            "sleep token",
            new Map([
              ["kendrick lamar", 0.9],
              ["bad omens", 0.2],
              ["spiritbox", 0.2],
            ]),
          ],
        ]),
      },
      profileOf: (name: string) =>
        name === "Sleep Token"
          ? null
          : new Map([[name === "Kendrick Lamar" ? "hiphop" : "metal", 1]]),
    };
    assert.equal(genreMixSeeds(library, always(0))[0]?.name, "Hip-Hop");
  });

  test("an inherited custom family keeps the tagged family's spelling", () => {
    const library = { ...libraryOf([...songsOf(5, null, 2), ...songsOf(1, "Shoegaze", 1)]), graph };
    assert.equal(genreMixSeeds(library, always(0))[0]?.name, "Shoegaze");
  });

  test("keep an artist's tagged family instead of replacing it with neighbours'", () => {
    const library = {
      ...libraryOf([...songsOf(5, "Pop", 2), ...songsOf(1, "Metal", 1), ...songsOf(1, "Metal", 3)]),
      graph,
    };
    assert.equal(genreMixSeeds(library, always(0))[0]?.name, "Pop");
  });
});

describe("A song with several genres", () => {
  test("adds half of itself and of its plays to each of two families", () => {
    const library = libraryOf([
      ...songsOf(6, "Metalcore; Pop", 1, 10),
      ...songsOf(3, "Metal", 2),
      ...songsOf(2, "Pop", 5),
      ...songsOf(1, "Rock", 4, 31),
      ...songsOf(4, "Rock", 4),
      ...songsOf(1, "House", 8, 29),
      ...songsOf(4, "House", 8),
    ]);
    assert.deepEqual(
      genreMixSeeds(library, always(0)).map((seed) => seed.name),
      ["Rock", "Metal", "Pop", "Electronic"],
    );
  });

  test("counts once, fully, in a family two of its genres share", () => {
    const library = libraryOf([
      ...songsOf(5, "Rap/Hip Hop", 5),
      ...songsOf(5, "Metalcore / Deathcore", 1),
    ]);
    assert.deepEqual(
      genreMixSeeds(library, always(0)).map((seed) => seed.name),
      ["Hip-Hop", "Metal"],
    );
  });

  test('splits a tag joined with "/"', () => {
    const library = libraryOf([...songsOf(4, "Rock/Pop", 4), ...songsOf(3, "Rock", 4, 1)]);
    assert.deepEqual(
      genreMixSeeds(library, always(0)).map((seed) => seed.name),
      ["Rock"],
    );
  });

  test("counts every value of a multi-value tag", () => {
    const library = libraryOf([
      ...songsOf(4, null, 1).map((song) => ({
        ...song,
        genre: "Metalcore",
        genres: ["Metalcore", "Electronic"],
      })),
      ...songsOf(3, "Techno", 8, 1),
      ...songsOf(3, "Metal", 2),
    ]);
    assert.deepEqual(
      genreMixSeeds(library, always(0)).map((seed) => seed.name),
      ["Electronic", "Metal"],
    );
  });

  test("may join the familiar share of any of its families", () => {
    const library = libraryOf([
      ...songsOf(5, "Metal", 1),
      ...songsOf(5, "Rock", 4),
      ...songsOf(1, "Metalcore; Indie Rock", 2, 5),
    ]);
    const known = mixKnownSongs({
      library: library.songs,
      playedRecordingKeys: [],
      streamed: [],
      playlisted: [],
    });
    const pools = genreMixSeeds(library, always(0)).map((seed) =>
      discoverMixFamiliarPool(seed, {
        radio: [],
        known,
        library,
        taken: { tracks: new Set(), videos: new Set() },
        length: 20,
      }).map((song) => (song.source === "library" ? song.track.id : song.song.videoId)),
    );
    assert.deepEqual(
      pools.map((pool) => pool[0]),
      [11, 11],
    );
  });

  test("make up a family's five songs in thirds", () => {
    const library = libraryOf(songsOf(15, "Metal; Rock; Pop", 1));
    assert.deepEqual(
      genreMixSeeds(library, always(0)).map((seed) => seed.name),
      ["Metal", "Rock", "Pop"],
    );
  });

  test("inflates no family when most of the Library has several", () => {
    const library = libraryOf([
      ...songsOf(4, "Metalcore; Rock", 1),
      ...songsOf(4, "Rock; Pop", 4),
      ...songsOf(4, "Pop; Metalcore", 5),
    ]);
    assert.deepEqual(
      genreMixSeeds(library, always(0)).map((seed) => seed.name),
      [],
    );
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

  test("built once the owner has plays isn't due again that day, though none of its families was played", () => {
    const now = new Date(2026, 9, 18, 12).getTime();
    const library = libraryOf([...songsOf(5, "Metalcore", 1), ...songsOf(2, null, 4, 30)]);
    const seeds = genreMixSeeds(library, always(0));
    const mix = discoverMix(seeds[0]!, radioSongs(12));
    assert.ok(mix !== null);
    const built = discoverMixesBuilt([mix], now, seeds);
    assert.equal(discoverMixesDue(built, { now: now + 60_000, played: true }), false);
  });

  test("built before the owner had plays is due once plays arrive", () => {
    const now = new Date(2026, 9, 18, 12).getTime();
    const library = libraryOf(songsOf(5, "Metalcore", 1));
    const seeds = genreMixSeeds(library, always(0));
    const mix = discoverMix(seeds[0]!, radioSongs(12));
    assert.ok(mix !== null);
    const built = discoverMixesBuilt([mix], now, seeds);
    assert.equal(discoverMixesDue(built, { now: now + 60_000, played: true }), true);
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

describe("A mix's seed", () => {
  const library = libraryOf([...songsOf(3, "Metalcore", 1, 10), ...songsOf(3, "Metal", 2, 5)]);
  const genre = genreMixSeeds(library, always(0))[0]!;
  const artist = artistMixSeeds(
    { played: [{ id: 3, name: "Spiritbox", countedPlays: 4 }] },
    always(0),
  )[0]!;

  test("grows from a genre mix's seed artists, or an artist mix's own artist", () => {
    assert.deepEqual(
      mixSeedArtists(genre).map((seedArtist) => seedArtist.name),
      ["Bad Omens", "Sleep Token"],
    );
    assert.deepEqual(
      mixSeedArtists(artist).map((seedArtist) => seedArtist.name),
      ["Spiritbox"],
    );
  });

  test("tells by its mix's id which section the mix is of", () => {
    assert.equal(mixSectionOfId(genre.id), "genre-mixes");
    assert.equal(mixSectionOfId(artist.id), "artist-mixes");
  });
});
