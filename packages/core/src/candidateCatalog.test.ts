import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  CATALOG_MOST,
  CATALOG_UNSEEN_MS,
  catalogLeaving,
  catalogSeen,
  type CatalogSong,
  type DiscoverRadioSong,
} from "./index.ts";

const DAY = 24 * 60 * 60 * 1000;

const radioSong = (
  videoId: string,
  { video = false, title = `Song ${videoId}`, artists = ["Portishead"] } = {},
): DiscoverRadioSong & { readonly albumId: string | null } => ({
  videoId,
  title,
  artists,
  album: "Dummy",
  albumId: "MPREb_dummy",
  durationMs: 240_000,
  artworkUrl: "https://lh3.googleusercontent.com/cover",
  explicit: false,
  video,
});

/** The song as the catalog keeps it: its metadata, without the radio's video mark. */
const kept = (videoId: string, options: { title?: string; artists?: string[] } = {}) => {
  const { video: _video, ...song } = radioSong(videoId, options);
  return song;
};

const none = new Map<string, CatalogSong>();

describe("What a page adds to the catalog", () => {
  test("a radio's songs come in with the radio's seed, seen now", () => {
    const seen = catalogSeen(
      none,
      { songs: [radioSong("a"), radioSong("b")], seed: "Massive Attack" },
      10 * DAY,
    );
    assert.deepEqual(seen, [
      {
        song: kept("a"),
        firstSeenAt: 10 * DAY,
        lastSeenAt: 10 * DAY,
        radios: [{ seed: "massive attack", seedName: "Massive Attack", lastSeenAt: 10 * DAY }],
      },
      {
        song: kept("b"),
        firstSeenAt: 10 * DAY,
        lastSeenAt: 10 * DAY,
        radios: [{ seed: "massive attack", seedName: "Massive Attack", lastSeenAt: 10 * DAY }],
      },
    ]);
  });

  test("music videos and a song the page repeats are left out", () => {
    const seen = catalogSeen(
      none,
      {
        songs: [radioSong("a"), radioSong("v", { video: true }), radioSong("a"), radioSong("b")],
        seed: "Massive Attack",
      },
      DAY,
    );
    assert.deepEqual(
      seen.map((entry) => entry.song.videoId),
      ["a", "b"],
    );
  });

  test("an artist page's songs come in without a radio", () => {
    const [entry] = catalogSeen(none, { songs: [radioSong("a")], seed: null }, DAY);
    assert.deepEqual(entry?.radios, []);
    assert.equal(entry?.lastSeenAt, DAY);
  });

  test("a radio whose seed isn't an artist's brings its songs but no evidence", () => {
    const [entry] = catalogSeen(none, { songs: [radioSong("a")], seed: "Various Artists" }, DAY);
    assert.deepEqual(entry?.radios, []);
    assert.equal(entry?.song.videoId, "a");
  });
});

/** The catalog [entries] make, by video id. */
const catalog = (entries: readonly CatalogSong[]): Map<string, CatalogSong> =>
  new Map(entries.map((entry) => [entry.song.videoId, entry]));

describe("A song seen again", () => {
  const first = catalog(
    catalogSeen(none, { songs: [radioSong("a")], seed: "Massive Attack" }, 10 * DAY),
  );

  test("the same radio again updates its last-seen date and still counts once", () => {
    const [entry] = catalogSeen(
      first,
      { songs: [radioSong("a")], seed: "massive attack" },
      12 * DAY,
    );
    assert.equal(entry?.firstSeenAt, 10 * DAY);
    assert.equal(entry?.lastSeenAt, 12 * DAY);
    assert.deepEqual(entry?.radios, [
      { seed: "massive attack", seedName: "massive attack", lastSeenAt: 12 * DAY },
    ]);
  });

  test("another radio counts once more", () => {
    const [entry] = catalogSeen(first, { songs: [radioSong("a")], seed: "Tricky" }, 12 * DAY);
    assert.deepEqual(entry?.radios, [
      { seed: "massive attack", seedName: "Massive Attack", lastSeenAt: 10 * DAY },
      { seed: "tricky", seedName: "Tricky", lastSeenAt: 12 * DAY },
    ]);
    assert.equal(entry?.firstSeenAt, 10 * DAY);
  });

  test("an artist page keeps its radios and makes it seen now", () => {
    const [entry] = catalogSeen(first, { songs: [radioSong("a")], seed: null }, 11 * DAY);
    assert.equal(entry?.lastSeenAt, 11 * DAY);
    assert.deepEqual(entry?.radios, [
      { seed: "massive attack", seedName: "Massive Attack", lastSeenAt: 10 * DAY },
    ]);
  });

  test("its metadata is the latest page's", () => {
    const [entry] = catalogSeen(
      first,
      { songs: [radioSong("a", { title: "Teardrop (Remastered)" })], seed: null },
      11 * DAY,
    );
    assert.deepEqual(entry?.song, kept("a", { title: "Teardrop (Remastered)" }));
  });
});

describe("What leaves the catalog", () => {
  const now = 100 * DAY;

  test("a song no radio or page brought in 60 days leaves", () => {
    const leaving = catalogLeaving(
      [
        { videoId: "old", lastSeenAt: now - 61 * DAY },
        { videoId: "recent", lastSeenAt: now - 59 * DAY },
      ],
      now,
    );
    assert.deepEqual(leaving.songs, ["old"]);
  });

  test("radios that last brought a song 60 days ago or more stop counting", () => {
    assert.equal(catalogLeaving([], now).radiosSeenBefore, now - 60 * DAY);
    assert.equal(CATALOG_UNSEEN_MS, 60 * DAY);
  });

  test("past 5,000 songs, the least recently seen leave first", () => {
    const songs = Array.from({ length: 5_003 }, (_, i) => ({
      videoId: `v${i}`,
      // v0 seen longest ago, v5002 just now.
      lastSeenAt: now - (5_003 - i) * 60_000,
    }));
    const shuffled = [...songs.slice(2_000), ...songs.slice(0, 2_000)];
    assert.equal(CATALOG_MOST, 5_000);
    assert.deepEqual(catalogLeaving(shuffled, now).songs.toSorted(), ["v0", "v1", "v2"]);
  });

  test("a full catalog drops the stale songs before any recent one", () => {
    const recent = Array.from({ length: 4_999 }, (_, i) => ({
      videoId: `r${i}`,
      lastSeenAt: now - DAY,
    }));
    const stale = [
      { videoId: "s0", lastSeenAt: now - 70 * DAY },
      { videoId: "s1", lastSeenAt: now - 61 * DAY },
    ];
    assert.deepEqual(catalogLeaving([...stale, ...recent], now).songs.toSorted(), ["s0", "s1"]);
  });

  test("nothing leaves a catalog under its cap seen lately", () => {
    assert.deepEqual(catalogLeaving([{ videoId: "a", lastSeenAt: now }], now).songs, []);
  });
});
