import assert from "node:assert/strict";
import test from "node:test";
import * as Effect from "effect/Effect";
import type { FollowRelease } from "@wave/core";
import { hideFollowRelease } from "../db/followReleases.ts";
import { removeFollow } from "../db/follows.ts";
import { openTestDatabase, closeTestDatabase } from "../db/testDatabase.ts";
import { databaseFollowStore } from "./followStore.ts";
import { readHomeFollowSnapshot } from "./homeFollowSnapshot.ts";

test("Home keeps its first and second follow changes for the next visit, including unfollow", async () => {
  const db = await openTestDatabase();
  try {
    const store = databaseFollowStore(db);
    const now = Date.now();
    const read = (admitted?: Parameters<typeof readHomeFollowSnapshot>[3]) =>
      Effect.runPromise(readHomeFollowSnapshot(store, "BR", now, admitted));
    const opening = (await read()).known;
    const release: FollowRelease = {
      key: "r",
      artistKey: "abba",
      title: "New",
      type: "album",
      releaseDate: new Date(now).toISOString().slice(0, 10),
      artworkUrl: null,
      explicit: false,
      browseId: null,
      videoIds: [],
      recordingKeys: [],
    };
    await Effect.runPromise(store.setFollow({ name: "ABBA" }, "releases"));
    await Effect.runPromise(store.saveFollowReleases("abba", [release], now));
    const followed = await read(opening);
    assert.deepEqual(followed.visit.releases, []);
    assert.deepEqual(
      followed.known.releases.map((r) => r.key),
      ["r"],
    );
    await Effect.runPromise(store.setFollow({ name: "Aurora" }, "releases"));
    const second = await read(opening);
    assert.deepEqual(second.visit.releases, []);
    const nextOpening = second.known;
    removeFollow(db, "ABBA", Date.now());
    const unfollowed = await read(nextOpening);
    assert.deepEqual(
      unfollowed.visit.releases.map((r) => r.key),
      ["r"],
    );
    assert.equal(unfollowed.visit.follows[0]?.name, "ABBA");
    assert.deepEqual(unfollowed.known.releases, []);
    hideFollowRelease(db, "r", Date.now());
    assert.deepEqual((await read(nextOpening)).visit.releases, []);
  } finally {
    closeTestDatabase(db);
  }
});
