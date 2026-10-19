/// <reference types="node" />
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  HARVEST_MOBILE_BYTES,
  startMagicQueue,
  type CatalogSong,
  type MagicSession,
} from "@wave/core";
import * as Effect from "effect/Effect";

import { magicCatalogRead, type MagicCatalogReadDeps } from "./magicCatalogRead.ts";

const DAY = 24 * 60 * 60 * 1000;
const NOW = 100 * DAY;
const MB = 1024 * 1024;

/** A catalog song by [artist] that [artist]'s own radio brought a day ago. */
const radioSong = (videoId: string, artist = "Muse"): CatalogSong => ({
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
  firstSeenAt: NOW - 30 * DAY,
  lastSeenAt: NOW - DAY,
  radios: [{ seed: "muse", seedName: "Muse", lastSeenAt: NOW - DAY }],
});

const songs = (count: number, prefix = "song"): CatalogSong[] =>
  Array.from({ length: count }, (_, at) => radioSong(`${prefix}${at}`));

const session: MagicSession = (() => {
  const started = startMagicQueue(
    { kind: "artist", id: "1", title: "Muse" },
    [{ trackId: "1", artists: [], genre: null }],
    { id: "s1", random: () => 0, radio: { artists: ["Muse"], profile: null } },
  );
  assert.ok(started !== null);
  return started.session;
})();

/**
 * A read over [catalog] (and, after a refill, [refilled]); what it asked of
 * the network (refills) and of the audio cache, and the mobile data it counted.
 */
const read = (
  catalog: CatalogSong[],
  {
    online = true,
    onMobileData = false,
    usedToday = 0,
    refilled = catalog,
    cached = new Set<string>(),
    bytes = MB,
  }: {
    online?: boolean;
    onMobileData?: boolean;
    usedToday?: number;
    refilled?: CatalogSong[];
    cached?: ReadonlySet<string>;
    bytes?: number;
  } = {},
) => {
  let refills = 0;
  let cacheAsks = 0;
  let mobile = 0;
  const deps: MagicCatalogReadDeps<never> = {
    online,
    onMobileData,
    usedToday,
    now: NOW,
    catalog: Effect.sync(() => (refills === 0 ? catalog : refilled)),
    graph: null,
    profileOf: () => undefined,
    taste: null,
    inLibrary: () => false,
    cached: Effect.sync(() => {
      cacheAsks += 1;
      return cached;
    }),
    refill: Effect.sync(() => {
      refills += 1;
      return bytes;
    }),
    usedOnMobile: (used) => {
      mobile += used;
    },
  };
  const pick = Effect.runSync(magicCatalogRead(session, deps));
  return {
    ids: pick.candidates.map((candidate) => candidate.song.videoId),
    refills,
    cacheAsks,
    mobile,
  };
};

describe("A Magic Queue batch's YT Music candidates", () => {
  test("come from the catalog with no request when it has enough", () => {
    const { ids, refills, cacheAsks } = read(songs(30));
    assert.equal(ids.length, 30);
    assert.equal(refills, 0);
    assert.equal(cacheAsks, 0);
  });

  test("running low on Wi-Fi, read the radio first, then come from the grown catalog", () => {
    const { ids, refills, mobile } = read(songs(5), { refilled: songs(40) });
    assert.equal(refills, 1);
    assert.equal(ids.length, 40);
    assert.equal(mobile, 0);
  });

  test("on mobile data, only an empty session reads, counting the mobile data it used", () => {
    assert.equal(read(songs(5), { onMobileData: true }).refills, 0);
    const empty = read([], { onMobileData: true, refilled: songs(10), bytes: 2 * MB });
    assert.equal(empty.refills, 1);
    assert.equal(empty.ids.length, 10);
    assert.equal(empty.mobile, 2 * MB);
    assert.equal(read([], { onMobileData: true, usedToday: HARVEST_MOBILE_BYTES }).refills, 0);
  });

  test("offline, only the songs the audio cache holds whole, and no request", () => {
    const { ids, refills } = read(songs(30), {
      online: false,
      cached: new Set(["song3", "song7"]),
    });
    assert.deepEqual(new Set(ids), new Set(["song3", "song7"]));
    assert.equal(refills, 0);
  });
});
