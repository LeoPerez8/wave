import assert from "node:assert/strict";
import { test } from "node:test";
import {
  catalogMixReader,
  discoverMixesOfCatalog,
  discoverMixesOfCatalogSteps,
  seededRandom,
  mixKnownSongs,
} from "./index.ts";

test("stepped catalog mixes preserve every song, weight and seed with the same variety", () => {
  const random = seededRandom("594");
  const artists = [{ id: 1, name: "Portishead" }];
  const songs = Array.from({ length: 180 }, (_, i) => ({
    id: i + 1,
    title: `Known ${i}`,
    artist: "Portishead",
    artistIds: [1],
    durationMs: 180000,
    addedAt: i,
    genre: "Rock",
  }));
  const library = {
    artists,
    songs,
    plays: songs.map((s) => ({ id: s.id, countedPlays: Math.floor(random() * 20) })),
  };
  const sources = {
    library,
    catalog: Array.from({ length: 1600 }, (_, i) => ({
      song: {
        videoId: `v${i}`,
        title: `New ${i}`,
        artists: ["Portishead"],
        album: null,
        albumId: null,
        durationMs: 180000,
        artworkUrl: null,
        explicit: false,
      },
      firstSeenAt: i,
      lastSeenAt: i,
      radios: [{ seed: "portishead", seedName: "Portishead", lastSeenAt: 0 }],
    })),
    graph: null,
    profileOf: () => null,
    now: 1000,
  };
  const seeds = [
    {
      id: "artist:portishead",
      kind: "artist" as const,
      name: "Portishead",
      from: "plays" as const,
    },
  ];
  const options = {
    library,
    known: mixKnownSongs({ library: songs, playedRecordingKeys: [], streamed: [], playlisted: [] }),
  };
  const expected = discoverMixesOfCatalog(
    seeds,
    catalogMixReader(sources, { variety: 594 }),
    options,
  );
  const steps = discoverMixesOfCatalogSteps(
    seeds,
    catalogMixReader(sources, { variety: 594 }),
    options,
  );
  let work = 0;
  let next = steps.next();
  while (!next.done) {
    work++;
    next = steps.next();
  }
  assert.deepEqual(next.value, expected);
  assert.ok(work > 1600);
});

test("genre seed derivation yields while visiting a large family of eligible artists", async () => {
  const { genreMixSeedsSteps } = await import("./index.ts");
  let namesRead = 0;
  const artists = Array.from({ length: 1400 }, (_, id) => ({
    id,
    get name() {
      namesRead++;
      return `Artist ${id}`;
    },
  }));
  const songs = artists.map(({ id }) => ({
    id,
    artistIds: [id],
    genre: "Rock",
    addedAt: 0,
    title: `Song ${id}`,
    artist: `Artist ${id}`,
    durationMs: 180000,
  }));
  const steps = genreMixSeedsSteps({ artists, songs }, seededRandom("594-family"));
  for (;;) {
    namesRead = 0;
    const next = steps.next();
    assert.ok(namesRead <= 4, `${namesRead} artist names read in one operation`);
    if (next.done) {
      assert.equal(next.value.length, 1);
      assert.equal(next.value[0]!.artists!.length, 3);
      break;
    }
  }
});

test("Artist seed derivation yields through Library sorting and preserves a known ordered pick", async () => {
  const { artistMixSeedsSteps } = await import("./index.ts");
  let visits = 0;
  const library = Array.from({ length: 1400 }, (_, id) => ({
    id,
    get name() {
      visits++;
      return `Artist ${id}`;
    },
    get songCount() {
      visits++;
      return id + 1;
    },
  }));
  const steps = artistMixSeedsSteps({ played: [], library }, () => 0.5);
  for (;;) {
    visits = 0;
    const next = steps.next();
    assert.ok(visits <= 12, `${visits} artist fields visited in one operation`);
    if (next.done) {
      assert.deepEqual(
        next.value.map((seed) => seed.name),
        ["Artist 1399", "Artist 1398", "Artist 1397", "Artist 1396"],
      );
      break;
    }
  }
});
