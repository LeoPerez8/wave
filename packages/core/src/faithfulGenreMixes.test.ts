import assert from "node:assert/strict";
import { test } from "node:test";
import {
  blendDiscoverMix,
  faithfulGenreMixesSteps,
  rankedDiscoverMixes,
  type CatalogSong,
  type DiscoverMixSeed,
  type RadioRankingPage,
  type YtAlbumSong,
} from "./index.ts";

const song = (videoId: string, artist = "Rock Band"): YtAlbumSong => ({
  videoId,
  title: videoId,
  artists: [artist],
  durationMs: 180_000,
  album: null,
  albumId: null,
  artworkUrl: null,
  explicit: false,
});
const catalog = (songs: readonly YtAlbumSong[]): CatalogSong[] =>
  songs.map((song) => ({ song, firstSeenAt: 1, lastSeenAt: 1, radios: [] }));
const rock: DiscoverMixSeed = {
  kind: "genre",
  id: "genre:rock",
  name: "Rock",
  genre: "Rock",
  from: "library",
  artists: ["Rock Band", "Second Band", "Third Band", "Fourth Band"].map((name, id) => ({
    name,
    id,
  })),
};

test("a complete catalog mix is published offline, capped at 25, with song tags ahead of artist profiles", () => {
  const known = song("familiar funk", "Rock Band");
  const familiar = song("familiar rock", "Funk Band");
  const fresh = Array.from({ length: 30 }, (_, i) => song(`rock ${i}`));
  const songs = [
    song("override", "Funk Band"),
    song("funk", "Rock Band"),
    song("unknown", "Unknown"),
    ...fresh,
  ];
  const build = faithfulGenreMixesSteps(
    [rock],
    {
      catalog: catalog(songs),
      genreOf: (videoId) =>
        new Map([
          ["funk", "Funk carioca"],
          ["override", "Rock"],
          [known.videoId, "Funk carioca"],
          [familiar.videoId, "Rock"],
        ]).get(videoId),
      library: {
        artists: [],
        songs: [],
        profileOf: (name) =>
          name === "Rock Band"
            ? new Map([["rock", 1]])
            : name === "Funk Band"
              ? new Map([["brazilianfunk", 1]])
              : undefined,
      },
      known: {
        inLibrary: () => null,
        known: ({ videoId }) => videoId === known.videoId || videoId === familiar.videoId,
        nonD: [known, familiar].map((song) => ({ song, plays: 1, addedAt: 1 })),
      },
    },
    { faithfulness: 5, popularity: 3 },
  );
  let step = build.next();
  while (!step.done && step.value === undefined) step = build.next();
  assert.equal(step.done, false);
  assert.equal(step.value?.kind, "local");
  if (step.value?.kind !== "local") assert.fail("Expected local mixes before any request");
  const [mix] = step.value.mixes;
  assert.equal(mix?.songs.length, 25);
  assert.deepEqual(
    mix?.songs.map(({ videoId }) => videoId),
    ["override", ...fresh.slice(0, 24).map((s) => s.videoId)],
  );
  assert.deepEqual(mix?.familiar, [{ source: "stream", song: familiar }]);
  assert.equal(blendDiscoverMix(mix!, { level: 1 }).songs.length, 25);
  do {
    step = build.next();
  } while (!step.done && step.value === undefined);
  assert.deepEqual(step, { done: true, value: [mix] });
});

test("a short family widens one radio at a time and keeps only matching new and familiar songs", () => {
  const knownFunk = song("familiar funk", "Funk Band");
  const knownRock = song("familiar rock");
  const matching = Array.from({ length: 10 }, (_, i) => song(`new ${i}`));
  const build = faithfulGenreMixesSteps(
    [rock],
    {
      catalog: catalog(matching.slice(0, 8)),
      genreOf: () => null,
      library: {
        artists: [],
        songs: [],
        profileOf: (name) => (name === "Rock Band" ? new Map([["rock", 1]]) : undefined),
      },
      known: {
        inLibrary: () => null,
        known: ({ videoId }) => [knownFunk.videoId, knownRock.videoId].includes(videoId),
        nonD: [],
      },
    },
    { faithfulness: 3, popularity: 3 },
  );
  const next = (page?: RadioRankingPage) => {
    let step = build.next(page);
    while (!step.done && step.value === undefined) step = build.next();
    return step;
  };
  const page = (...songs: YtAlbumSong[]): RadioRankingPage => ({ id: "radio", artists: [], songs });
  assert.deepEqual(next(), { done: false, value: { kind: "local", mixes: [] } });
  for (const [index, response] of [
    undefined,
    page(knownFunk),
    page(knownRock, matching[8]!),
  ].entries()) {
    const step = next(response);
    assert.equal(step.done, false);
    assert.equal(
      step.value?.kind === "radio" && step.value.artist.name,
      rock.artists?.[index]?.name,
    );
  }
  const result = next(page(matching[9]!));
  assert.ok(result.done);
  assert.deepEqual(
    result.value[0]?.songs.map(({ videoId }) => videoId),
    matching.map(({ videoId }) => videoId),
  );
  assert.deepEqual(result.value[0]?.familiar, [{ source: "stream", song: knownRock }]);
});

test("an exhausted family with fewer than ten new songs makes no mix", () => {
  const build = faithfulGenreMixesSteps(
    [rock],
    {
      catalog: catalog([song("one")]),
      genreOf: () => "Rock",
      library: { artists: [], songs: [] },
      known: { inLibrary: () => null, known: () => false, nonD: [] },
    },
    { faithfulness: 1, popularity: 3 },
  );
  const requests = [];
  let result = build.next();
  while (!result.done) {
    if (result.value?.kind === "radio") requests.push(result.value.artist.name);
    result = build.next();
  }
  assert.deepEqual(
    requests,
    rock.artists?.map(({ name }) => name),
  );
  assert.deepEqual(result.value, []);
});

test("Artist mixes still use radio candidates and allow unknown genres", () => {
  const songs = Array.from({ length: 40 }, (_, i) => song(`unknown ${i}`, "Unknown"));
  const seed = { kind: "artist", id: "artist:rock", name: "Rock Band", from: "library" } as const;
  const mixes = rankedDiscoverMixes(
    [{ seed, pages: [{ id: "rock-radio", artists: [seed.name], songs }] }],
    {
      library: { artists: [], songs: [] },
      known: { inLibrary: () => null, known: () => false, nonD: [] },
    },
    { faithfulness: 1, popularity: 3 },
  );
  assert.deepEqual(
    mixes[0]?.songs.map(({ videoId }) => videoId),
    songs.map(({ videoId }) => videoId),
  );
});
