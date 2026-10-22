import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  artistGraph,
  faithfulnessStyles,
  genreProfile,
  libraryStyleOf,
  magicArtistKey,
  magicBatch,
  magicCatalogCandidates,
  magicCloseArtists,
  magicLibraryCandidates,
  magicLibraryThreshold,
  magicLibrarySongs,
  mixSlidersEngine,
  startMagicQueue,
  type CatalogSong,
  type MagicLibrarySong,
  type MagicSession,
} from "./index.ts";

/** A catalog song the radio of [seed] brought (its artist is [artist]). */
const broughtBy = (videoId: string, artist: string, seed: string): CatalogSong => ({
  song: {
    videoId,
    title: videoId,
    artists: [artist],
    album: null,
    albumId: null,
    durationMs: 200_000,
    artworkUrl: null,
    explicit: false,
  },
  firstSeenAt: 1,
  lastSeenAt: 1,
  radios: [{ seed: seed.toLowerCase(), seedName: seed, lastSeenAt: 1 }],
});

const RANDOM = () => 0.5;
const SAME = mixSlidersEngine({ faithfulness: 1, popularity: 3 });
const CLOSE = mixSlidersEngine({ faithfulness: 2, popularity: 3 });
/** The Magic Queue section's sliders at Same genres and Close (what the app passes). */
const sliderStyles = (faithfulness: 1 | 2) => faithfulnessStyles({ faithfulness, popularity: 3 });

describe("Same genres holds a Magic Queue to its seed's style", () => {
  const artists = [
    { id: 1, name: "Rage Against the Machine" },
    { id: 2, name: "Jack Johnson" },
    { id: 3, name: "Dave Matthews Band" },
    { id: 4, name: "Deftones" },
  ];
  const toMagic = magicLibrarySongs(artists);
  const library: MagicLibrarySong[] = [
    { id: 11, artistIds: [1], genres: ["Alternative Metal"] },
    { id: 12, artistIds: [4], genres: ["Nu Metal"] },
    { id: 13, artistIds: [2], genres: ["Soft Rock"] },
    { id: 14, artistIds: [2], genres: ["Acoustic"] },
    { id: 15, artistIds: [3], genres: ["Pop Rock"] },
  ];
  // The seed's radio brings every artist's songs: their styles alone tell them apart.
  const catalog = [
    broughtBy("jj", "Jack Johnson", "Rage Against the Machine"),
    broughtBy("jj2", "Jack Johnson", "Rage Against the Machine"),
    broughtBy("dmb", "Dave Matthews Band", "Rage Against the Machine"),
    broughtBy("deftones", "Deftones", "Rage Against the Machine"),
  ];

  for (const tag of ["Rap Metal", "Alternative Metal"]) {
    test(`a Magic Queue seeded by a "${tag}" song never picks a Library or YouTube Music song tagged Soft Rock, Pop Rock or Acoustic`, () => {
      const seed: MagicLibrarySong = { id: 10, artistIds: [1], genres: [tag] };
      const ofLibrary = { artists, songs: [seed, ...library] };
      const styleOf = libraryStyleOf(ofLibrary);
      let session = startMagicQueue(
        { kind: "track", id: "10", title: "Bullet in the Head" },
        [toMagic(seed)],
        {
          id: "rage",
          random: RANDOM,
          radio: { artists: ["Rage Against the Machine"], profile: genreProfile([seed]) },
        },
      )!.session;
      const picked: string[] = [];
      for (let batch = 0; batch < 4; batch += 1) {
        const yt = magicCatalogCandidates(
          session,
          { catalog, graph: null, profileOf: () => undefined, styleOf, now: 2 },
          { inLibrary: () => false, engine: SAME },
        ).candidates;
        const libraryCandidates = magicLibraryCandidates(session, ofLibrary, {
          profileOf: () => undefined,
          threshold: magicLibraryThreshold({ faithfulness: 1, popularity: 3 }),
          styles: sliderStyles(1),
        });
        const result = magicBatch(session, libraryCandidates, RANDOM, yt);
        session = result.session;
        picked.push(...result.trackIds);
      }
      // The mix does hold its own style: the Library's and YouTube Music's songs of it come.
      assert.ok(picked.includes("11"), "a Library song of the seed's style");
      assert.ok(picked.includes("yt:deftones"), "a YouTube Music song of the seed's style");
      for (const soft of ["13", "14", "15", "yt:jj", "yt:jj2", "yt:dmb"])
        assert.ok(!picked.includes(soft), `${soft} is soft, and was picked`);
    });
  }
});

describe("Close admits the neighbouring styles, and only those", () => {
  const artists = [
    { id: 1, name: "Seed Band" },
    { id: 2, name: "Soft Band" },
    { id: 3, name: "Hard Band" },
  ];
  const seed: MagicLibrarySong = { id: 10, artistIds: [1], genres: ["Nu Metal"] };
  const songs: MagicLibrarySong[] = [
    seed,
    { id: 21, artistIds: [3], genres: ["Hard Rock"] },
    { id: 22, artistIds: [2], genres: ["Soft Rock"] },
  ];
  const session = startMagicQueue(
    { kind: "track", id: "10", title: "Seed" },
    [magicLibrarySongs(artists)(seed)],
    {
      id: "close",
      random: RANDOM,
      radio: { artists: ["Seed Band"], profile: null },
    },
  )!.session;
  const ids = (styles: 1 | 2) =>
    magicLibraryCandidates(
      session,
      { artists, songs },
      {
        profileOf: () => undefined,
        styles: sliderStyles(styles),
      },
    ).map((song) => song.trackId);

  test("Same genres keeps only the seed's style", () => {
    assert.deepEqual(ids(1), ["10"]);
  });

  test("Close also keeps hard rock (a neighbour of heavy), never soft", () => {
    assert.deepEqual(ids(2), ["10", "21"]);
  });
});

describe("A song of no known style at Same genres and Close", () => {
  const artists = [
    { id: 1, name: "Seed Artist" },
    { id: 2, name: "Neighbour" },
    { id: 3, name: "Soft Stranger" },
    { id: 4, name: "Unknown Stranger" },
  ];
  // The seed is tagged only "Rock": a generic tag, so its style is unknown too.
  const seed: MagicLibrarySong = { id: 10, artistIds: [1], genre: "Rock" };
  const songs: MagicLibrarySong[] = [
    seed,
    { id: 31, artistIds: [1], genre: "Rock" },
    { id: 32, artistIds: [2], genre: "Rock" },
    { id: 33, artistIds: [3], genres: ["Soft Rock"] },
    { id: 34, artistIds: [4], genre: "Rock" },
  ];
  // Neighbour sounds near Seed Artist: its radio brought Neighbour's songs.
  const graph = artistGraph({
    catalog: [broughtBy("n1", "Neighbour", "Seed Artist")],
    pages: [],
    plays: [],
  });
  const session: MagicSession = startMagicQueue(
    { kind: "track", id: "10", title: "Seed" },
    [magicLibrarySongs(artists)(seed)],
    {
      id: "unknown",
      random: RANDOM,
      radio: { artists: ["Seed Artist"], profile: null },
    },
  )!.session;

  test("the seed's artists and their neighbourhood are close, the rest aren't", () => {
    const close = magicCloseArtists(session, graph);
    assert.ok(close.has(magicArtistKey("Seed Artist")));
    assert.ok(close.has(magicArtistKey("Neighbour")));
    assert.ok(!close.has(magicArtistKey("Soft Stranger")));
  });

  for (const styles of [1, 2] as const)
    test(`at ${styles === 1 ? "Same genres" : "Close"}, joins only when its artist is close`, () => {
      const ids = magicLibraryCandidates(
        session,
        { artists, songs },
        {
          profileOf: () => undefined,
          styles: sliderStyles(styles),
          graph,
        },
      ).map((song) => song.trackId);
      // Seed's own artist and its neighbour are close; a soft stranger's style is known and not the seed's; an unknown stranger is not close.
      assert.deepEqual(ids, ["10", "31", "32"]);
    });

  test("a song of the seed's style (known) joins without any closeness", () => {
    const styled = { ...seed, genres: ["Nu Metal"] };
    const stranger: MagicLibrarySong = { id: 41, artistIds: [4], genres: ["Nu Metal"] };
    const styledSession = startMagicQueue(
      { kind: "track", id: "10", title: "Seed" },
      [magicLibrarySongs(artists)(styled)],
      { id: "styled", random: RANDOM, radio: { artists: ["Seed Artist"], profile: null } },
    )!.session;
    const ids = magicLibraryCandidates(
      styledSession,
      { artists, songs: [styled, stranger] },
      { profileOf: () => undefined, styles: sliderStyles(1), graph: null },
    ).map((song) => song.trackId);
    assert.deepEqual(ids, ["10", "41"]);
  });
});

test("Balanced and the looser steps keep the families' rule: no style comparison", () => {
  assert.equal(sliderStyles(1), "same");
  assert.equal(sliderStyles(2), "close");
  assert.equal(faithfulnessStyles({ faithfulness: 3, popularity: 3 }), null);
  assert.equal(faithfulnessStyles({ faithfulness: 5, popularity: 3 }), null);
  // The engine's rule at the defaults is the same as before: no style level passed.
  assert.equal("styles" in mixSlidersEngine({ faithfulness: 3, popularity: 3 }), false);
  assert.equal(SAME.styles, "same");
  assert.equal(CLOSE.styles, "close");
});
