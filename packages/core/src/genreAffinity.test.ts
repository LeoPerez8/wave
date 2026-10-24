import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  GENRE_AFFINITY_THRESHOLD,
  artistProfilesKnown,
  parseArtistProfiles,
  storedArtistProfiles,
  withArtistProfiles,
  genreAffinity,
  genreProfile,
  libraryGenreProfiles,
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
