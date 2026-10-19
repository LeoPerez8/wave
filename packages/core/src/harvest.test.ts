import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  HARVEST_MOBILE_BYTES,
  HARVEST_SEEDS,
  artistGraph,
  harvestDue,
  harvestMobileUsedToday,
  harvestNext,
  harvestSeedPool,
  harvestWants,
  mixKnownSongs,
  mixSlidersEngine,
  networkUseBytes,
  parseHarvestMobileUse,
  storedHarvestMobileUse,
  withHarvestMobileUse,
  type CatalogSong,
  type DiscoverMixSeed,
  type GenreProfile,
  type HarvestWant,
} from "./index.ts";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const NOW = 100 * DAY;

const catalogSong = (videoId: string, artist: string, seed: string, at: number): CatalogSong => ({
  song: {
    videoId,
    title: `Song ${videoId}`,
    artists: [artist],
    album: null,
    albumId: null,
    durationMs: 200_000,
    artworkUrl: null,
    explicit: false,
  },
  firstSeenAt: at,
  lastSeenAt: at,
  radios: [{ seed: seed.toLowerCase(), seedName: seed, lastSeenAt: at }],
});

const artistSeed = (name: string): DiscoverMixSeed => ({
  kind: "artist",
  id: `artist:${name.toLowerCase()}`,
  name,
  from: "plays",
});

const library = { artists: [], songs: [] };
const known = mixKnownSongs({ library: [], playedRecordingKeys: [], streamed: [], playlisted: [] });

const want = (id: string, candidates: number, readAt: number | null = null): HarvestWant => ({
  id,
  candidates,
  readAt,
});

describe("What the harvest wants", () => {
  test("each seed's candidates (the new songs its mix would keep) and when its radio was last read", () => {
    const catalog = [
      ...Array.from({ length: 12 }, (_, n) =>
        catalogSong(`t${n}`, "Tricky", "Tricky", NOW - 2 * DAY),
      ),
      catalogSong("t-late", "Tricky", "Tricky", NOW - DAY),
    ];
    const wants = harvestWants([artistSeed("Tricky"), artistSeed("Björk")], {
      catalog,
      graph: artistGraph({ catalog, pages: [], plays: [] }),
      profileOf: () => undefined,
      now: NOW,
      library,
      known,
    });
    assert.deepEqual(
      wants.map(({ id, candidates, readAt }) => ({ id, candidates, readAt })),
      [
        { id: "artist:tricky", candidates: 13, readAt: NOW - DAY },
        { id: "artist:björk", candidates: 0, readAt: null },
      ],
    );
  });
});

describe("The seeds a harvest may read", () => {
  const rock: DiscoverMixSeed = {
    kind: "genre",
    id: "genre:rock",
    name: "Rock",
    from: "plays",
    genre: "Rock",
    artists: [],
  };
  const played = (names: string[]) =>
    names.map((name, at) => ({ id: at + 1, name, countedPlays: 10 - at }));

  test("on mobile data, only the seeds the builds picked, each once", () => {
    const picked = [artistSeed("Tricky"), rock, artistSeed("Tricky")];
    assert.deepEqual(
      harvestSeedPool({ picked, wifi: null }).map((seed) => seed.id),
      ["artist:tricky", "genre:rock"],
    );
  });

  test("on Wi-Fi, every artist Artist mixes may pick and the families, then the picked seeds left", () => {
    const seeds = harvestSeedPool({
      picked: [artistSeed("Tricky"), artistSeed("Björk")],
      wifi: {
        pools: { played: played(["Tricky", "Portishead", "Massive Attack", "Air"]) },
        families: [rock],
      },
    });
    assert.deepEqual(
      seeds.map((seed) => seed.id),
      [
        "artist:tricky",
        "artist:portishead",
        "artist:massive attack",
        "artist:air",
        "genre:rock",
        "artist:björk",
      ],
    );
  });
});

describe("What the harvest wants, at a section's sliders", () => {
  test("counts only the songs the mix would keep at its Genre faithfulness", () => {
    const rock: GenreProfile = new Map([["rock", 1]]);
    const rockPop: GenreProfile = new Map([
      ["rock", 0.5],
      ["pop", 0.5],
    ]);
    const profiles: Record<string, GenreProfile> = { Tricky: rock, Pixies: rockPop };
    const at = NOW - DAY;
    const catalog = [
      ...Array.from({ length: 6 }, (_, n) => catalogSong(`t${n}`, "Tricky", "Tricky", at)),
      ...Array.from({ length: 6 }, (_, n) => catalogSong(`p${n}`, "Pixies", "Tricky", at)),
    ];
    const sources = {
      catalog,
      graph: artistGraph({ catalog, pages: [], plays: [] }),
      profileOf: (artist: string) => profiles[artist],
      now: NOW,
      library,
      known,
    };
    const candidates = (faithfulness: 1 | 3) =>
      harvestWants(
        [artistSeed("Tricky")],
        sources,
        mixSlidersEngine({ faithfulness, popularity: 3 }),
      )[0]?.candidates;
    assert.equal(candidates(3), 12);
    // "Same genres": Pixies' half-rock songs don't make the mix, so the seed runs lower.
    assert.equal(candidates(1), 6);
  });
});

describe("Which seed the harvest reads next", () => {
  const wifi = { onMobileData: false, usedToday: 0, now: NOW, read: 0 };

  test("on Wi-Fi: any seed running low, the emptiest first, then the least recently read", () => {
    const wants = [
      want("full", 60),
      want("low", 20, NOW - 2 * DAY),
      want("empty", 0),
      want("low2", 20),
    ];
    const order: string[] = [];
    const tried = new Map<string, number>();
    for (let next = harvestNext(wants, { ...wifi, tried }); next !== null;) {
      order.push(next.id);
      tried.set(next.id, NOW);
      next = harvestNext(wants, { ...wifi, tried, read: order.length });
    }
    assert.deepEqual(order, ["empty", "low2", "low"]);
  });

  test("not a seed read in the last 12 hours", () => {
    assert.equal(harvestNext([want("low", 5, NOW - 11 * HOUR)], wifi), null);
    assert.equal(harvestNext([want("low", 5, NOW - 13 * HOUR)], wifi)?.id, "low");
    assert.equal(
      harvestNext([want("low", 5)], { ...wifi, tried: new Map([["low", NOW - HOUR]]) }),
      null,
    );
  });

  test("at most eight seeds a run", () => {
    assert.equal(HARVEST_SEEDS, 8);
    assert.equal(harvestNext([want("low", 5)], { ...wifi, read: 8 }), null);
  });

  test("on mobile data: only a seed with no candidates left, within ~5 MB a day", () => {
    const mobile = { ...wifi, onMobileData: true };
    const wants = [want("low", 5), want("empty", 0)];
    assert.equal(harvestNext(wants, mobile)?.id, "empty");
    assert.equal(harvestNext([want("low", 5)], mobile), null);
    assert.equal(HARVEST_MOBILE_BYTES, 5 * 1024 * 1024);
    assert.equal(harvestNext(wants, { ...mobile, usedToday: HARVEST_MOBILE_BYTES }), null);
    assert.equal(
      harvestNext(wants, { ...mobile, usedToday: HARVEST_MOBILE_BYTES - 1 })?.id,
      "empty",
    );
  });
});

describe("The harvest's mobile data", () => {
  test("adds up a day's bytes, starting afresh the next day, and survives being saved", () => {
    const morning = new Date(2026, 9, 19, 8).getTime();
    const evening = new Date(2026, 9, 19, 20).getTime();
    const tomorrow = new Date(2026, 9, 20, 8).getTime();
    const used = withHarvestMobileUse(withHarvestMobileUse(null, 1000, morning), 500, evening);
    assert.equal(harvestMobileUsedToday(used, evening), 1500);
    assert.equal(harvestMobileUsedToday(used, tomorrow), 0);
    assert.equal(harvestMobileUsedToday(withHarvestMobileUse(used, 7, tomorrow), tomorrow), 7);
    const saved = parseHarvestMobileUse(storedHarvestMobileUse(used));
    assert.equal(harvestMobileUsedToday(saved, evening), 1500);
    assert.equal(parseHarvestMobileUse("nonsense"), null);
    assert.equal(parseHarvestMobileUse(null), null);
  });

  test("counts every host's bytes", () => {
    assert.equal(
      networkUseBytes({
        ytMusic: { requests: 3, bytes: 100_000 },
        deezer: { requests: 4, bytes: 30_000 },
      }),
      130_000,
    );
  });
});

describe("When the harvest runs", () => {
  test("at most once every 15 minutes", () => {
    assert.equal(harvestDue(null, NOW), true);
    assert.equal(harvestDue(NOW - 14 * 60_000, NOW), false);
    assert.equal(harvestDue(NOW - 15 * 60_000, NOW), true);
  });
});
