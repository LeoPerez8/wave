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
    await Effect.runPromise(store.saveFollowReleases("abba", [release], 5));
    const searches: string[] = [];
    const reads: string[] = [];
    const opening = await Effect.runPromise(
      openFollowRelease(store, release, "ABBA", {
        ytMusic: () => true,
        keep: () => true,
        searchAlbums: async (query) => {
          searches.push(query);
          return found;
        },
        album: async (browseId) => {
          reads.push(browseId);
          return { videoIds: ["v1", "v2"] };
        },
        ...over,
      }),
    );
    const cache = readFollowReleases(db).artists[0]!;
    return { opening, searches, reads, saved: cache.releases[0]!, checkedAt: cache.checkedAt };
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

test("a matched release opens on its album without a search; YT Music off says so", async () => {
  const matched = await opened({}, { ...voyage, browseId: "MPRE9", videoIds: ["v9"] });
  assert.deepEqual(matched.opening, { kind: "open", browseId: "MPRE9" });
  assert.deepEqual([matched.searches, matched.reads], [[], ["MPRE9"]]);
  assert.equal(matched.saved.browseId, "MPRE9");
  const off = await opened({ ytMusic: () => false });
  assert.deepEqual([off.opening, off.searches], [{ kind: "ytMusicOff" }, []]);
});

test("a failed search is no answer, one without the release is not found, and neither is kept", async () => {
  const failed = await opened({ searchAlbums: async () => null });
  assert.deepEqual([failed.opening, failed.saved.browseId], [{ kind: "noAnswer" }, null]);
  const missing = await opened({ searchAlbums: async () => [] });
  assert.deepEqual([missing.opening, missing.saved.browseId], [{ kind: "notFound" }, null]);
  const unread = await opened({ album: async () => "noAnswer" });
  assert.deepEqual(
    [unread.opening, unread.saved.browseId],
    [{ kind: "open", browseId: "MPRE1" }, null],
  );
});

test("a matched release whose album YT Music answers without says so and loses its match", async () => {
  const matched = { ...voyage, browseId: "MPRE9", videoIds: ["v9"] };
  const gone = await opened({ album: async () => "missing" }, matched);
  assert.deepEqual(gone.opening, { kind: "notFound" });
  assert.deepEqual([gone.saved.browseId, gone.saved.videoIds, gone.checkedAt], [null, [], 5]);
  const empty = await opened({ album: async () => ({ videoIds: [] }) }, matched);
  assert.deepEqual([empty.opening, empty.saved.browseId], [{ kind: "notFound" }, null]);
});

test("no answer from a matched release's album still opens its page and keeps the match", async () => {
  const matched = { ...voyage, browseId: "MPRE9", videoIds: ["v9"] };
  const offline = await opened({ album: async () => "noAnswer" }, matched);
  assert.deepEqual([offline.opening, offline.saved.browseId], [{ kind: "open", browseId: "MPRE9" }, "MPRE9"]);
  const rejected = await opened(
    { album: () => Promise.reject(new Error("passing error")) },
    matched,
  );
  assert.deepEqual(
    [rejected.opening, rejected.saved.browseId],
    [{ kind: "open", browseId: "MPRE9" }, "MPRE9"],
  );
});

test("a gone collaboration loses its match under every artist it's followed through", async () => {
  const db = await openTestDatabase();
  try {
    const store = databaseFollowStore(db);
    const matched = { ...voyage, browseId: "MPRE9", videoIds: ["v9"] };
    const other = { ...matched, artistKey: "other" };
    await Effect.runPromise(store.setFollow({ name: "ABBA" }, "releases"));
    await Effect.runPromise(store.setFollow({ name: "Other" }, "releases"));
    await Effect.runPromise(store.saveFollowReleases("abba", [matched], 5));
    await Effect.runPromise(store.saveFollowReleases("other", [other], 7));
    const opening = await Effect.runPromise(
      openFollowRelease(store, matched, "ABBA", {
        ytMusic: () => true,
        keep: () => true,
        searchAlbums: async () => found,
        album: async () => "missing",
      }),
    );
    assert.deepEqual(opening, { kind: "notFound" });
    assert.deepEqual(
      readFollowReleases(db)
        .artists.map((a) => [a.key, a.releases[0]!.browseId, a.checkedAt])
        .sort(),
      [
        ["abba", null, 5],
        ["other", null, 7],
      ],
    );
  } finally {
    closeTestDatabase(db);
  }
});
