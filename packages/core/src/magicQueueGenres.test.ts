import assert from "node:assert/strict";
import { test } from "node:test";

import {
  genreProfile,
  magicBatch,
  magicCatalogCandidates,
  magicLibraryCandidates,
  magicLibrarySongs,
  magicLibraryThreshold,
  magicRadioLookups,
  mixSlidersEngine,
  startMagicQueue,
  type CatalogSong,
  type GenreProfileOf,
  type MagicLibrarySong,
} from "./index.ts";

// Representative metadata, not the unknown tags in the owner's APK. Names have no say in affinity.
const artists = [
  { id: 1, name: "Acoustic seed" },
  { id: 2, name: "Acoustic neighbour" },
  { id: 3, name: "Rap rock band" },
  { id: 4, name: "Metalcore band" },
];
const seed: MagicLibrarySong = {
  id: 1,
  artistIds: [1],
  genres: ["Acoustic", "Soft Rock", "Pop"],
};
const neighbour = genreProfile([{ genres: ["Acoustic", "Soft Rock"] }])!;
const rapRock = genreProfile([{ genre: "Rock" }, { genre: "Rock" }, { genre: "Hip Hop" }])!;
const metal = genreProfile([{ genres: ["Metalcore", "Rock"] }])!;
const profiles: GenreProfileOf = (name) =>
  name === artists[0]!.name
    ? genreProfile([seed])
    : name === artists[1]!.name
      ? neighbour
      : name === artists[2]!.name
        ? rapRock
        : name === artists[3]!.name
          ? metal
          : undefined;

const start = (profile = genreProfile([seed])) =>
  startMagicQueue(
    { kind: "track", id: "1", title: "Acoustic song" },
    [magicLibrarySongs(artists)(seed)],
    { id: "genres", random: () => 0, radio: { artists: [artists[0]!.name], profile } },
  )!.session;

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
  radios: [{ seed: "acoustic seed", seedName: artists[0]!.name, lastSeenAt: 1 }],
});

test("Balanced batches from both sources reject a minor shared family with otherwise incompatible genres", () => {
  const songs: MagicLibrarySong[] = [
    seed,
    ...Array.from({ length: 30 }, (_, i) => ({ id: 10 + i, artistIds: [2], genre: null })),
    { id: 100, artistIds: [3], genre: null },
    { id: 101, artistIds: [4], genres: ["Metalcore", "Rock"] },
  ];
  const catalog = [
    ...Array.from({ length: 40 }, (_, i) => catalogSong(`close-${i}`, artists[1]!.name)),
    catalogSong("rap-rock", artists[2]!.name),
    catalogSong("metalcore", artists[3]!.name),
  ];
  const sliders = { faithfulness: 3, popularity: 3 } as const;
  let session = start();
  for (let batch = 0; batch < 4; batch += 1) {
    const library = magicLibraryCandidates(
      session,
      { artists, songs },
      {
        profileOf: profiles,
        threshold: magicLibraryThreshold(sliders),
      },
    );
    const online = magicCatalogCandidates(
      session,
      {
        catalog,
        profileOf: profiles,
        graph: null,
        now: 2,
      },
      { inLibrary: () => false, engine: mixSlidersEngine(sliders) },
    ).candidates;
    assert.ok(
      !online.some((candidate) => ["yt:rap-rock", "yt:metalcore"].includes(candidate.trackId)),
    );
    const picked = magicBatch(session, library, () => 0.99, online);
    assert.equal(picked.trackIds.length, batch === 0 ? 9 : 10);
    assert.ok(picked.trackIds.some((id) => id.startsWith("yt:")));
    assert.ok(picked.trackIds.some((id) => !id.startsWith("yt:")));
    assert.ok(
      !picked.trackIds.some((id) => ["100", "101", "yt:rap-rock", "yt:metalcore"].includes(id)),
      `batch ${batch + 1}: ${picked.trackIds.join(", ")}`,
    );
    session = picked.session;
  }
});

test("missing seed metadata never turns off the genre gate for either source", () => {
  const session = start(null);
  const songs: MagicLibrarySong[] = [seed, { id: 100, artistIds: [3], genre: "Rock" }];
  for (const profileOf of [() => undefined, () => null, () => new Map()]) {
    assert.deepEqual(magicLibraryCandidates(session, { artists, songs }, { profileOf }), []);
    assert.deepEqual(
      magicCatalogCandidates(
        session,
        {
          catalog: [catalogSong("rap-rock", artists[2]!.name)],
          graph: null,
          profileOf,
          now: 2,
        },
        { inLibrary: () => false },
      ).candidates,
      [],
    );
  }
});

test("a refill looks past cosine-only matches to learn the genres of usable candidates", () => {
  const radio = [
    ...Array.from({ length: 20 }, (_, i) => ({
      ...catalogSong(`rock-${i}`, "Rock band").song,
      video: false,
    })),
    { ...catalogSong("unknown", "Unknown neighbour").song, video: false },
  ];
  assert.deepEqual(
    magicRadioLookups(start(), radio, {
      inLibrary: () => false,
      profileOf: (name) => (name === "Rock band" ? new Map([["rock", 1]]) : undefined),
    }),
    ["Unknown neighbour"],
  );
});

test("only Wander admits unrelated Library genres; online Wander still needs a known overlapping genre", () => {
  const songs: MagicLibrarySong[] = [
    { id: 2, artistIds: [2], genres: ["Acoustic", "Soft Rock"] },
    { id: 3, artistIds: [3], genre: "Hip Hop" },
    { id: 4, artistIds: [99], genre: null },
  ];
  const session = start(new Map([["folk", 1]]));
  const catalog = [
    catalogSong("close", artists[1]!.name),
    catalogSong("unrelated", artists[3]!.name),
    catalogSong("unknown", "Unknown"),
  ];
  for (const faithfulness of [1, 2, 3, 4, 5] as const) {
    const sliders = { faithfulness, popularity: 3 } as const;
    const library = magicLibraryCandidates(
      session,
      { artists, songs },
      {
        profileOf: profiles,
        threshold: magicLibraryThreshold(sliders),
      },
    );
    assert.ok(
      !library.some((song) => song.trackId === "3" || song.trackId === "4") || faithfulness === 5,
    );
    if (faithfulness === 5)
      assert.deepEqual(
        library.map((song) => song.trackId),
        ["2", "3", "4"],
      );
    const online = magicCatalogCandidates(
      session,
      { catalog, graph: null, profileOf: profiles, now: 2 },
      { inLibrary: () => false, engine: mixSlidersEngine(sliders) },
    ).candidates;
    assert.ok(online.every((song) => song.trackId === "yt:close"));
    if (faithfulness >= 3) assert.equal(online.length, 1);
  }
});
