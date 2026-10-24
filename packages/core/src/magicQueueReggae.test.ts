import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  artistGraph,
  catalogSeedKey,
  deezerArtistProfile,
  deezerGenreNames,
  faithfulnessStyles,
  genreProfile,
  libraryGenreProfiles,
  libraryStyleOf,
  magicBatch,
  magicCatalogCandidates,
  magicLibraryCandidates,
  magicLibrarySongs,
  magicLibraryThreshold,
  magicSignal,
  magicYtSong,
  mixSlidersEngine,
  parseMagicSession,
  startMagicQueue,
  tasteProfile,
  type CatalogSong,
  type GenreProfileOf,
  type MagicLibrarySong,
  type MagicSession,
  type MixSliderStep,
} from "./index.ts";

// Live, projected Deezer responses, not recovered metadata from the owner's queue.
const captured = JSON.parse(
  readFileSync(new URL("./fixtures/magicQueue606.deezer.json", import.meta.url), "utf8"),
);
const genreNames = deezerGenreNames(captured.genres.response)!;
const marley = "Bob Marley & The Wailers";
const rage = "Rage Against the Machine";
const capturedProfile: GenreProfileOf = (name) => {
  const artist = captured.artists.find((entry: { name: string }) => entry.name === name);
  return artist === undefined ? undefined : deezerArtistProfile(artist.response, genreNames);
};
const random = () => 0.5;

const artists = [
  { id: 1, name: marley },
  { id: 2, name: rage },
  { id: 3, name: "Compatible reggae fixture" },
  { id: 4, name: "Minor reggae share fixture" },
  { id: 5, name: "Unknown fixture" },
  { id: 6, name: "First style misleading fixture" },
];

const catalogSong = (videoId: string, artist: string): CatalogSong => ({
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
  // Deliberately adversarial association, not an observed Bob Marley radio response.
  radios: [{ seed: catalogSeedKey(marley)!, seedName: marley, lastSeenAt: 1 }],
});

const setup = (tag: "Reggae" | "Roots Reggae" | null = "Reggae") => {
  const seed: MagicLibrarySong = { id: 1, artistIds: [1], genre: tag };
  const library = {
    artists,
    songs: [
      seed,
      ...Array.from({ length: 40 }, (_, i) => ({
        id: 10 + i,
        artistIds: [3],
        genre: "Roots Reggae",
      })),
      // No file tag: the app falls back to the artist's other Library songs.
      { id: 100, artistIds: [2], genre: null },
      // Representative detailed tags, not the owner's or Deezer's track tags.
      { id: 101, artistIds: [2], genres: ["Rap Metal", "Funk Metal", "Rap Rock"] },
      { id: 102, artistIds: [4], genres: ["Reggae", "Rock", "Hip Hop"] },
      { id: 103, artistIds: [5], genre: null },
      { id: 104, artistIds: [6], genres: ["Roots Reggae", "Rock", "Hip Hop"] },
    ] satisfies MagicLibrarySong[],
  };
  const ofLibrary = libraryGenreProfiles(library);
  // The app prefers the Library profile, then Deezer when the Library knows none.
  const profileOf: GenreProfileOf = (name) => ofLibrary(name) ?? capturedProfile(name);
  const styleOf = libraryStyleOf(library);
  const catalog = [
    ...Array.from({ length: 40 }, (_, i) => catalogSong(`reggae-${i}`, artists[2]!.name)),
    catalogSong("rage", rage),
    catalogSong("minor", artists[3]!.name),
    catalogSong("unknown", artists[4]!.name),
    catalogSong("first-style", artists[5]!.name),
  ];
  // Every offending artist is close in the graph as well as on the seed radio.
  const graph = artistGraph({ catalog, pages: [], plays: [] });
  const toMagic = magicLibrarySongs(artists);
  const session = startMagicQueue(
    { kind: "track", id: "1", title: "Reggae-tagged Bob Marley fixture (owner seed unknown)" },
    [toMagic(seed)],
    { id: "606", random, radio: { artists: [marley], profile: genreProfile([seed]) } },
  )!.session;
  const sources = { catalog, graph, profileOf, styleOf, now: 2 };
  const candidates = (current: MagicSession, faithfulness: MixSliderStep) => {
    const sliders = { faithfulness, popularity: 3 } as const;
    return {
      library: magicLibraryCandidates(current, library, {
        profileOf,
        graph,
        threshold: magicLibraryThreshold(sliders),
        styles: faithfulnessStyles(sliders),
      }),
      online: magicCatalogCandidates(current, sources, {
        inLibrary: () => false,
        engine: mixSlidersEngine(sliders),
      }).candidates,
    };
  };
  return { session, candidates, sources, library, toMagic };
};

test("the captured album profiles establish coarse, incompatible family evidence", () => {
  const seed = capturedProfile(marley)!;
  const offender = capturedProfile(rage)!;
  assert.ok(seed.get("reggae")! > 0.9);
  assert.ok(offender.get("rock")! > 0.9);
  assert.equal(offender.has("reggae"), false);
  assert.equal(deezerArtistProfile({ data: [{ genre_id: -1 }] }, genreNames), null);
});

test("Deezer-only family evidence rejects RATM even when a Bob Marley radio brought it", () => {
  const fixture = setup("Reggae");
  const sources = {
    ...fixture.sources,
    catalog: [catalogSong("rage", rage)],
    profileOf: capturedProfile,
    // Deezer provides no style, and this case assumes no Library style exists.
    styleOf: () => undefined,
  };
  for (const faithfulness of [1, 2, 3] as const) {
    const { candidates, left } = magicCatalogCandidates(fixture.session, sources, {
      inLibrary: () => false,
      engine: mixSlidersEngine({ faithfulness, popularity: 3 }),
    });
    assert.deepEqual(candidates, [], `step ${faithfulness}: Reggae and Rock/Pop do not overlap`);
    assert.equal(left, 0, "excluded songs do not prevent a catalog refill");
    const sliders = { faithfulness, popularity: 3 } as const;
    // With no tagged RATM songs in the Library, its untagged song uses Deezer,
    // exactly as the app's magicProfileOf does.
    assert.deepEqual(
      magicLibraryCandidates(
        fixture.session,
        {
          artists,
          songs: [{ id: 100, artistIds: [2], genre: null }],
        },
        {
          profileOf: capturedProfile,
          graph: fixture.sources.graph,
          threshold: magicLibraryThreshold(sliders),
          styles: faithfulnessStyles(sliders),
        },
      ),
      [],
    );
  }
});

for (const tag of ["Reggae", "Roots Reggae", null] as const)
  for (const faithfulness of [1, 2, 3] as const)
    test(`${tag ?? "untagged, artist-profile fallback"} seed at step ${faithfulness}: both sources exclude incompatible automatic picks through initial, later and restored batches`, () => {
      const fixture = setup(tag);
      let session = fixture.session;
      const liked = [
        "100",
        "101",
        "102",
        "103",
        "104",
        "yt:rage",
        "yt:minor",
        "yt:unknown",
        "yt:first-style",
      ];
      const songOf = (id: string) => {
        const song = fixture.library.songs.find((entry) => String(entry.id) === id);
        return song === undefined
          ? magicYtSong({ trackId: id, artists: [rage] }, fixture.sources.profileOf)
          : fixture.toMagic(song);
      };
      const taste = tasteProfile(
        {
          plays: [],
          favorites: liked.map((trackId) => ({ trackId, changedAt: 2 })),
          downloads: liked.map((trackId) => ({ trackId, downloadedAt: 2 })),
        },
        songOf,
        2,
      );
      // A manually inserted RATM song teaches the session, but does not authorize other RATM picks.
      const manuallyAdded = magicYtSong(
        { trackId: "yt:owner-inserted", artists: [rage] },
        fixture.sources.profileOf,
      );
      session = magicSignal(session, { kind: "added", song: manuallyAdded });
      assert.ok(session.used.includes("yt:owner-inserted"));
      for (const kind of ["favorite", "download", "playedThrough"] as const)
        session = magicSignal(session, { kind, song: manuallyAdded });
      for (let batch = 0; batch < 4; batch += 1) {
        if (batch === 2) {
          session = parseMagicSession(JSON.parse(JSON.stringify(session)))!;
          assert.ok(session, "the app's persisted session is readable");
        }
        const { library, online } = fixture.candidates(session, faithfulness);
        assert.ok(
          library.some((song) => song.trackId === "10"),
          "compatible Library reggae remains eligible",
        );
        assert.ok(online.length > 0, "compatible YouTube reggae remains eligible");
        assert.ok(
          library.every((song) => Number(song.trackId) < 100),
          "incompatible/unknown Library candidates are withheld before weighting",
        );
        assert.ok(
          online.every((song) => song.trackId.startsWith("yt:reggae-")),
          "radio/graph association and minority genre/style cannot authorize unrelated YouTube candidates",
        );
        const picked = magicBatch(session, library, random, online, taste);
        assert.equal(picked.trackIds.length, batch === 0 ? 9 : 10);
        assert.ok(picked.trackIds.some((id) => id.startsWith("yt:")));
        assert.ok(picked.trackIds.some((id) => !id.startsWith("yt:")));
        session = picked.session;
      }
    });

test("a restored session from before style storage still checks families at strict steps", () => {
  const fixture = setup("Reggae");
  const stored = JSON.parse(JSON.stringify(fixture.session));
  delete stored.seedStyle;
  const restored = parseMagicSession(stored)!;
  for (const step of [1, 2] as const) {
    const { library, online } = fixture.candidates(restored, step);
    assert.ok(library.every((song) => Number(song.trackId) < 100));
    assert.ok(online.every((song) => song.trackId.startsWith("yt:reggae-")));
    assert.ok(online.length > 0);
  }
});

test("coarse compatible genres require closeness at strict steps; with no genre known anywhere only the seed's associates come", () => {
  const fixture = setup("Reggae");
  const strangers = {
    artists: [...artists, { id: 7, name: "Unrelated reggae fixture" }],
    songs: [
      { id: 200, artistIds: [3], genre: "Reggae" },
      { id: 201, artistIds: [7], genre: "Reggae" },
    ],
  };
  for (const styles of ["same", "close"] as const) {
    const admitted = magicLibraryCandidates(fixture.session, strangers, {
      profileOf: fixture.sources.profileOf,
      graph: fixture.sources.graph,
      styles,
    });
    assert.deepEqual(
      admitted.map((song) => song.trackId),
      ["200"],
    );
    // The owner's call (#637): a seed whose genre nobody knows grows from what is associated with it.
    const unknownSeed = { ...fixture.session, seedProfile: null, seedStyle: null };
    assert.deepEqual(
      magicLibraryCandidates(unknownSeed, strangers, {
        profileOf: () => undefined,
        graph: fixture.sources.graph,
        styles,
      }).map((song) => song.trackId),
      ["200"],
    );
    const online = magicCatalogCandidates(
      unknownSeed,
      {
        ...fixture.sources,
        profileOf: () => undefined,
        styleOf: () => undefined,
      },
      { inLibrary: () => false, engine: { styles } },
    ).candidates;
    assert.ok(online.length > 0);
    assert.ok(
      online.every((candidate) =>
        fixture.sources.catalog.some(
          (entry) =>
            entry.song.videoId === candidate.song.videoId &&
            entry.radios.some((radio) => radio.seedName === marley),
        ),
      ),
    );
  }
});

test("Wander preserves every Library genre and YouTube's existing known-overlap restriction", () => {
  const fixture = setup("Reggae");
  const { library, online } = fixture.candidates(fixture.session, 5);
  assert.ok(library.some((song) => song.trackId === "100"));
  assert.ok(library.some((song) => song.trackId === "103"));
  assert.ok(online.some((song) => song.trackId === "yt:minor"));
  assert.ok(online.every((song) => !["yt:rage", "yt:unknown"].includes(song.trackId)));
});

test("strict coarse-profile fallback uses the selected threshold for both sources", () => {
  const fixture = setup("Reggae");
  const mixed = genreProfile([
    ...Array.from({ length: 7 }, () => ({ genre: "Reggae" })),
    ...Array.from({ length: 3 }, () => ({ genre: "Pop" })),
  ])!;
  const profileOf: GenreProfileOf = (name) => (name === rage ? mixed : capturedProfile(name));
  for (const faithfulness of [1, 2, 3] as const) {
    const sliders = { faithfulness, popularity: 3 } as const;
    const library = magicLibraryCandidates(
      fixture.session,
      {
        artists,
        songs: [{ id: 100, artistIds: [2], genre: null }],
      },
      {
        profileOf,
        graph: fixture.sources.graph,
        threshold: magicLibraryThreshold(sliders),
        styles: faithfulnessStyles(sliders),
      },
    );
    const online = magicCatalogCandidates(
      fixture.session,
      {
        ...fixture.sources,
        catalog: [catalogSong("mixed", rage)],
        profileOf,
        styleOf: () => undefined,
      },
      { inLibrary: () => false, engine: mixSlidersEngine(sliders) },
    ).candidates;
    assert.equal(library.length, faithfulness === 1 ? 0 : 1);
    assert.equal(online.length, faithfulness === 1 ? 0 : 1);
  }
});

test("known cross-family styles and Close neighbours retain direct style evidence", () => {
  const bands = [
    { id: 1, name: "Metal seed fixture" },
    { id: 2, name: "Rock fixture" },
  ];
  const seed: MagicLibrarySong = { id: 1, artistIds: [1], genre: "Nu Metal" };
  for (const [tag, faithfulness] of [
    ["Rap Rock", 1],
    ["Hard Rock", 2],
  ] as const) {
    const library = { artists: bands, songs: [seed, { id: 2, artistIds: [2], genre: tag }] };
    const sliders = { faithfulness, popularity: 3 } as const;
    const profileOf = libraryGenreProfiles(library);
    const session = startMagicQueue(
      { kind: "track", id: "1", title: "Nu Metal fixture" },
      [magicLibrarySongs(bands)(seed)],
      {
        id: "cross-family",
        random,
        radio: { artists: [bands[0]!.name], profile: genreProfile([seed]) },
      },
    )!.session;
    assert.ok(
      magicLibraryCandidates(session, library, {
        profileOf,
        threshold: magicLibraryThreshold(sliders),
        styles: faithfulnessStyles(sliders),
      }).some((song) => song.trackId === "2"),
    );
    const entry = catalogSong("rock", bands[1]!.name);
    const online = magicCatalogCandidates(
      session,
      {
        catalog: [
          {
            ...entry,
            radios: [
              {
                seed: catalogSeedKey(bands[0]!.name)!,
                seedName: bands[0]!.name,
                lastSeenAt: 1,
              },
            ],
          },
        ],
        graph: null,
        profileOf,
        styleOf: libraryStyleOf(library),
        now: 2,
      },
      { inLibrary: () => false, engine: mixSlidersEngine(sliders) },
    ).candidates;
    assert.deepEqual(
      online.map((song) => song.trackId),
      ["yt:rock"],
    );
  }
});
