import assert from "node:assert/strict";
import { test } from "node:test";
import { catalogMixReader, discoverMixesOfCatalog } from "./catalogMixes.ts";
import { discoverMixesOfCatalogSteps } from "./catalogMixes.ts";
import { seededRandom } from "./weightedPick.ts";
import { mixKnownSongs } from "./mixKnownSongs.ts";

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
