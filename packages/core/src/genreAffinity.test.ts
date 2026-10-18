import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  GENRE_AFFINITY_THRESHOLD,
  artistProfilesKnown,
  deezerArtistAlbumsUrl,
  deezerArtistId,
  deezerArtistProfile,
  deezerGenreNames,
  discoverMixSongs,
  parseArtistProfiles,
  storedArtistProfiles,
  withArtistProfiles,
  genreAffinity,
  genreProfile,
  libraryGenreProfiles,
  mixAffinity,
  mixProfileLookups,
  mixSeedProfile,
  type DiscoverMixSeed,
  type GenreProfile,
} from "./index.ts";

const tagged = (genre: string, count: number, genres?: string[]) =>
  Array.from({ length: count }, () => ({ genre, ...(genres ? { genres } : {}) }));

const shares = (profile: ReadonlyMap<string, number> | null) =>
  Object.fromEntries([...(profile ?? [])].map(([key, share]) => [key, Math.round(share * 100)]));

describe("An artist's genre profile", () => {
  test("weighs each genre family by its share of the artist's songs", () => {
    const profile = genreProfile([
      ...tagged("Alternative", 12),
      ...tagged("Pop", 5),
      ...tagged("Rap", 3),
    ]);
    assert.deepEqual(shares(profile), { rock: 60, pop: 25, hiphop: 15 });
  });

  test("counts every value of a multi-value genre tag, a song sharing itself among its families", () => {
    const profile = genreProfile([{ genre: "Rock", genres: ["Rock", "Pop"] }, { genre: "Rock" }]);
    assert.deepEqual(shares(profile), { rock: 75, pop: 25 });
  });

  test("files Deezer's own genre names under the families", () => {
    const profile = genreProfile([
      { genre: "Films/Games" },
      { genre: "Soul & Funk" },
      { genre: "Latin Music" },
      { genre: "Electro" },
    ]);
    assert.deepEqual(shares(profile), { soundtrack: 25, rb: 25, latin: 25, electronic: 25 });
  });

  test("is null for songs with no genre", () => {
    assert.equal(genreProfile([{ genre: null }, { genre: "" }]), null);
    assert.equal(genreProfile([]), null);
  });
});

describe("Genre affinity", () => {
  const twentyOnePilots = genreProfile([
    ...tagged("Alternative", 12),
    ...tagged("Pop", 5),
    ...tagged("Rap", 3),
  ])!;

  test("keeps an all-rap artist out of a twenty one pilots mix", () => {
    const drDre = genreProfile(tagged("Rap/Hip Hop", 10))!;
    assert.ok(genreAffinity(twentyOnePilots, drDre) < GENRE_AFFINITY_THRESHOLD);
  });

  test("lets an artist of similar alt rock and pop in", () => {
    const similar = genreProfile([...tagged("Alternative Rock", 6), ...tagged("Pop", 4)])!;
    assert.ok(genreAffinity(twentyOnePilots, similar) >= GENRE_AFFINITY_THRESHOLD);
  });

  test("is 1 for the same families and 0 for none in common", () => {
    const metal = genreProfile(tagged("Metalcore", 3))!;
    const jazz = genreProfile(tagged("Bebop", 3))!;
    assert.equal(genreAffinity(metal, genreProfile(tagged("Nu Metal", 1))!), 1);
    assert.equal(genreAffinity(metal, jazz), 0);
  });
});

const library = {
  artists: [
    { id: 1, name: "twenty one pilots" },
    { id: 2, name: "Dr. Dre" },
    { id: 3, name: "Untagged" },
    { id: 4, name: "Paramore" },
  ],
  songs: [
    ...Array.from({ length: 12 }, (_, n) => ({ id: n, artistIds: [1], genre: "Alternative" })),
    ...Array.from({ length: 5 }, (_, n) => ({ id: 20 + n, artistIds: [1], genre: "Pop" })),
    ...Array.from({ length: 3 }, (_, n) => ({ id: 30 + n, artistIds: [1], genre: "Rap" })),
    { id: 40, artistIds: [2], genre: "Rap/Hip Hop" },
    { id: 41, artistIds: [3], genre: null },
    { id: 42, artistIds: [4], genre: "Pop Punk" },
    { id: 43, artistIds: [4], genre: "Alternative" },
  ],
};

const radioSong = (videoId: string, artists: string[]) => ({
  videoId,
  title: videoId,
  artists,
  album: null,
  albumId: null,
  durationMs: 200_000,
  artworkUrl: null,
  explicit: false,
  video: false,
});

describe("Library artists' profiles", () => {
  const profiles = libraryGenreProfiles(library);

  test("come from their songs, found by name as YouTube Music writes it", () => {
    assert.deepEqual(shares(profiles("Twenty One Pilots") ?? null), {
      rock: 60,
      pop: 25,
      hiphop: 15,
    });
  });

  test("are null for a Library artist with no genre and absent for an artist outside the Library", () => {
    assert.equal(profiles("Untagged"), null);
    assert.equal(profiles("Panic! at the Disco"), undefined);
  });
});

describe("A radio song's affinity to its mix", () => {
  const ofLibrary = libraryGenreProfiles(library);
  const outside = new Map<string, GenreProfile | null>([
    ["Panic! at the Disco", genreProfile([{ genre: "Alternative" }, { genre: "Pop" }])],
    ["Nobody Knows", null],
  ]);
  const profileOf = (name: string) => {
    const own = ofLibrary(name);
    return own === undefined ? outside.get(name) : own;
  };
  const seed: DiscoverMixSeed = {
    kind: "artist",
    id: "artist:top",
    name: "twenty one pilots",
    from: "plays",
  };
  const affinity = mixAffinity(mixSeedProfile(seed, library, profileOf), profileOf);

  test("in a twenty one pilots mix, misses for Dr. Dre and matches for an alt rock and pop artist", () => {
    assert.equal(affinity(radioSong("a", ["Dr. Dre"])), "miss");
    assert.equal(affinity(radioSong("b", ["Panic! at the Disco"])), "match");
    assert.equal(affinity(radioSong("c", ["twenty one pilots"])), "match");
  });

  test("matches when any of the song's artists matches", () => {
    assert.equal(affinity(radioSong("a", ["Dr. Dre", "Panic! at the Disco"])), "match");
  });

  test("is unknown for artists with no genre", () => {
    assert.equal(affinity(radioSong("a", ["Untagged"])), "unknown");
    assert.equal(affinity(radioSong("b", ["Nobody Knows"])), "unknown");
  });

  test("matches everything when the seed has no genre", () => {
    const untagged = mixAffinity(
      mixSeedProfile({ ...seed, name: "Untagged" }, library, profileOf),
      profileOf,
    );
    assert.equal(untagged(radioSong("a", ["Dr. Dre"])), "match");
  });

  test("of a genre mix, is to its seed artists' songs together", () => {
    const rock: DiscoverMixSeed = {
      kind: "genre",
      id: "genre:rock",
      name: "Rock",
      from: "library",
      genre: "Rock",
      artists: [
        { id: 1, name: "twenty one pilots" },
        { id: 4, name: "Paramore" },
      ],
    };
    const genre = mixAffinity(mixSeedProfile(rock, library, profileOf), profileOf);
    assert.equal(genre(radioSong("a", ["Dr. Dre"])), "miss");
    assert.equal(genre(radioSong("b", ["Panic! at the Disco"])), "match");
  });

  test("asks Deezer about the radio's artists outside the Library and not looked up yet, once each", () => {
    assert.deepEqual(
      mixProfileLookups(
        [
          radioSong("a", ["Dr. Dre", "Fall Out Boy"]),
          radioSong("b", ["Panic! at the Disco", "fall out boy"]),
          radioSong("c", ["Nobody Knows", "Various Artists"]),
        ],
        profileOf,
      ),
      ["Fall Out Boy"],
    );
  });
});

const ids = (songs: readonly { videoId: string }[]) => songs.map((song) => song.videoId);

describe("A mix's songs, kept to the seed's genres", () => {
  const byArtist: Record<string, "match" | "miss" | "unknown"> = {
    M: "match",
    X: "miss",
    U: "unknown",
  };
  const filter = {
    known: () => false,
    taken: new Set<string>(),
    affinity: (song: { artists: readonly string[] }) =>
      byArtist[song.artists[0] ?? ""] ?? "unknown",
  };

  test("leave out songs whose artist misses the seed's genres", () => {
    const page = [
      ...Array.from({ length: 10 }, (_, n) => radioSong(`m${n}`, ["M"])),
      radioSong("x", ["X"]),
    ];
    assert.deepEqual(ids(discoverMixSongs([page], filter)), ids(page.slice(0, 10)));
  });

  test("take songs by artists with no genre only to make up the ten songs, after every matching one", () => {
    const page = [
      radioSong("u1", ["U"]),
      ...Array.from({ length: 7 }, (_, n) => radioSong(`m${n}`, ["M"])),
      radioSong("u2", ["U"]),
      radioSong("x", ["X"]),
      radioSong("u3", ["U"]),
      radioSong("m7", ["M"]),
      radioSong("u4", ["U"]),
    ];
    assert.deepEqual(ids(discoverMixSongs([page], filter)), [
      "u1",
      "m0",
      "m1",
      "m2",
      "m3",
      "m4",
      "m5",
      "m6",
      "u2",
      "m7",
    ]);
    const enough = Array.from({ length: 10 }, (_, n) => radioSong(`m${n}`, ["M"]));
    assert.deepEqual(
      ids(discoverMixSongs([[radioSong("u", ["U"]), ...enough]], filter)),
      ids(enough),
    );
  });
});

describe("An artist's profile from Deezer", () => {
  const genres = deezerGenreNames({
    data: [
      { id: 0, name: "All" },
      { id: 152, name: "Rock" },
      { id: 85, name: "Alternative" },
      { id: 132, name: "Pop" },
      { id: 116, name: "Rap/Hip Hop" },
    ],
  });

  test("finds the artist whose name is the one searched", () => {
    const answer = {
      data: [
        { id: 7, name: "Panic! At The Disco Tribute" },
        { id: 9, name: "Panic! at the Disco" },
      ],
    };
    assert.equal(deezerArtistId(answer, "Panic! At The Disco"), 9);
    assert.equal(deezerArtistId(answer, "Fall Out Boy"), null);
    assert.equal(deezerArtistId({ error: {} }, "Fall Out Boy"), undefined);
    assert.equal(deezerArtistAlbumsUrl(9), "https://api.deezer.com/artist/9/albums?limit=50");
  });

  test("is the genres of their albums", () => {
    const albums = {
      data: [
        { genre_id: 152 },
        { genre_id: 85 },
        { genre_id: 132 },
        { genre_id: 132 },
        { genre_id: -1 },
      ],
    };
    assert.deepEqual(shares(deezerArtistProfile(albums, genres!) ?? null), { rock: 50, pop: 50 });
  });

  test("is null when no album has a genre, and absent for an answer that isn't a list of albums", () => {
    assert.equal(deezerArtistProfile({ data: [{ genre_id: -1 }] }, genres!), null);
    assert.equal(deezerArtistProfile({ error: { code: 4 } }, genres!), undefined);
    assert.equal(deezerGenreNames("nope"), null);
  });
});

describe("Artists' profiles from Deezer, kept on the phone", () => {
  const rock = genreProfile([{ genre: "Rock" }]);

  test("are looked up once: a profile or no genre, by name", () => {
    const cache = withArtistProfiles(new Map(), [
      ["The Killers", rock],
      ["Nobody Knows", null],
    ]);
    const known = artistProfilesKnown(parseArtistProfiles(storedArtistProfiles(cache)));
    assert.deepEqual(shares(known("killers") ?? null), { rock: 100 });
    assert.equal(known("Nobody Knows"), null);
    assert.equal(known("Fall Out Boy"), undefined);
  });

  test("keep the latest two thousand artists", () => {
    const many = Array.from({ length: 2001 }, (_, n) => [`Artist ${n}`, null] as const);
    const known = artistProfilesKnown(withArtistProfiles(new Map(), many));
    assert.equal(known("Artist 0"), undefined);
    assert.equal(known("Artist 2000"), null);
  });

  test("read as none when nothing readable is saved", () => {
    assert.equal(parseArtistProfiles(null).size, 0);
    assert.equal(parseArtistProfiles("{oops").size, 0);
  });
});
