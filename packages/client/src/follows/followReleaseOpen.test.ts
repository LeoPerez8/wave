import assert from "node:assert/strict";
import { test } from "node:test";
import type { FollowRelease } from "@wave/core";
import * as Effect from "effect/Effect";
import { readFollowReleases } from "../db/followReleases.ts";
import { closeTestDatabase, openTestDatabase } from "../db/testDatabase.ts";
import { openFollowRelease, type FollowReleaseOpenPorts } from "./followReleaseOpen.ts";
import { databaseFollowStore } from "./followStore.ts";

const voyage: FollowRelease = {
  key: "deezer:1",
  artistKey: "abba",
  title: "Voyage",
  type: "album",
  releaseDate: "2026-11-01",
  artworkUrl: null,
  explicit: false,
  browseId: null,
  videoIds: [],
  recordingKeys: [],
};
const found = [
  { title: "Voyage", releaseType: "album" as const, browseId: "MPRE1", artists: ["ABBA"] },
];

const opened = async (over: Partial<FollowReleaseOpenPorts>, release = voyage) => {
  const db = await openTestDatabase();
  try {
    const store = databaseFollowStore(db);
    await Effect.runPromise(store.setFollow({ name: "ABBA" }, "releases"));
    await Effect.runPromise(store.saveFollowReleases("abba", [voyage], 5));
    const searches: string[] = [];
    const opening = await Effect.runPromise(
      openFollowRelease(store, release, "ABBA", {
        ytMusic: () => true,
        keep: () => true,
        searchAlbums: async (query) => {
          searches.push(query);
          return found;
        },
        albumVideoIds: async () => ["v1", "v2"],
        ...over,
      }),
    );
    const cache = readFollowReleases(db).artists[0]!;
    return { opening, searches, saved: cache.releases[0]!, checkedAt: cache.checkedAt };
  } finally {
    closeTestDatabase(db);
  }
};

test("an unmatched release opens after one Albums search, and the match is kept", async () => {
  const { opening, searches, saved, checkedAt } = await opened({});
  assert.deepEqual(opening, { kind: "open", browseId: "MPRE1" });
  assert.deepEqual(searches, ["ABBA Voyage"]);
  assert.deepEqual([saved.browseId, saved.videoIds, checkedAt], ["MPRE1", ["v1", "v2"], 5]);
});

test("a matched release opens without a search; YT Music off says so", async () => {
  const matched = await opened({}, { ...voyage, browseId: "MPRE9" });
  assert.deepEqual(matched.opening, { kind: "open", browseId: "MPRE9" });
  assert.deepEqual(matched.searches, []);
  const off = await opened({ ytMusic: () => false });
  assert.deepEqual([off.opening, off.searches], [{ kind: "ytMusicOff" }, []]);
});

test("a failed search is no answer, one without the release is not found, and neither is kept", async () => {
  const failed = await opened({ searchAlbums: async () => null });
  assert.deepEqual([failed.opening, failed.saved.browseId], [{ kind: "noAnswer" }, null]);
  const missing = await opened({ searchAlbums: async () => [] });
  assert.deepEqual([missing.opening, missing.saved.browseId], [{ kind: "notFound" }, null]);
  const unread = await opened({ albumVideoIds: async () => null });
  assert.deepEqual(
    [unread.opening, unread.saved.browseId],
    [{ kind: "open", browseId: "MPRE1" }, null],
  );
});
