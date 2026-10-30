import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import * as Effect from "effect/Effect";
import type { FollowRelease } from "@wave/core";
import { loadLibraryStore } from "../../bench/fastAgain/store.ts";
import { openTestDatabase, closeTestDatabase } from "../library/db/testDatabase.ts";
import { readHomeFollowSnapshot } from "./readHomeFollowSnapshot.ts";

const root = fileURLToPath(new URL("../../../../", import.meta.url));
test("Home keeps its first and second follow changes for the next visit, including unfollow", async () => {
  const db = await openTestDatabase();
  try {
    const store = await loadLibraryStore(root, db);
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
    await Effect.runPromise(store.unfollow("ABBA"));
    const unfollowed = await read(nextOpening);
    assert.deepEqual(
      unfollowed.visit.releases.map((r) => r.key),
      ["r"],
    );
    assert.equal(unfollowed.visit.follows[0]?.name, "ABBA");
    assert.deepEqual(unfollowed.known.releases, []);
    await Effect.runPromise(store.hideFollowRelease("r"));
    assert.deepEqual((await read(nextOpening)).visit.releases, []);
  } finally {
    closeTestDatabase(db);
  }
});
