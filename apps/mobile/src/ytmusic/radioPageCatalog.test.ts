import assert from "node:assert/strict";
import { test } from "node:test";
import { CATALOG_UNSEEN_MS, CATALOG_MOST } from "@wave/core";
import { createRadioPageCatalog } from "./radioPageCatalog.ts";
const song = {
  videoId: "v",
  title: "Song",
  artists: ["Artist"],
  album: null,
  albumId: null,
  durationMs: 1000,
  artworkUrl: null,
  explicit: false,
};
test("radio identity, order and continuation survive restarting and expire with the catalog", () => {
  let saved: string | null = null;
  let now = 1;
  const storage = {
    read: () => saved,
    write: (value: string) => {
      saved = value;
    },
  };
  const first = createRadioPageCatalog(storage, () => now);
  first.put("song:1", { songs: [song, { ...song, videoId: "second" }], continuation: "next" });
  const restarted = createRadioPageCatalog(storage, () => now);
  assert.deepEqual(
    restarted.get("song:1")?.songs.map((song) => song.videoId),
    ["v", "second"],
  );
  assert.equal(restarted.get("song:1")?.continuation, "next");
  assert.equal(restarted.get("song:2"), null);
  now += CATALOG_UNSEEN_MS;
  assert.equal(restarted.get("song:1"), null);
});
test("the ordered radio index bounds its songs and ignores corrupt storage", () => {
  let saved = "{broken";
  const cache = createRadioPageCatalog({
    read: () => saved,
    write: (value) => {
      saved = value;
    },
  });
  assert.equal(cache.get("song:1"), null);
  cache.put("old", {
    songs: Array.from({ length: CATALOG_MOST }, (_, i) => ({ ...song, videoId: String(i) })),
    continuation: null,
  });
  cache.put("new", { songs: [song], continuation: null });
  assert.equal(cache.get("old")?.songs.length, CATALOG_MOST - 1);
  assert.equal(cache.get("new")?.songs.length, 1);
});

test("mix freshness uses the persisted radio timestamp and expires at seven days", () => {
  let now = 100;
  let saved: string | null = null;
  const storage = {
    read: () => saved,
    write: (value: string) => {
      saved = value;
    },
  };
  const cache = createRadioPageCatalog(storage, () => now);
  const page = { songs: [song], continuation: "next" };
  cache.put("artist:a", page);
  now += 7 * 86400000 - 1;
  const restarted = createRadioPageCatalog(storage, () => now);
  assert.deepEqual(restarted.getFresh("artist:a"), page);
  now++;
  assert.equal(restarted.getFresh("artist:a"), null);
  assert.deepEqual(restarted.get("artist:a"), page, "older radios remain available offline");
});

test("cache readers see each other's radio writes without losing existing radios", () => {
  let saved: string | null = null;
  const storage = {
    read: () => saved,
    write: (value: string) => {
      saved = value;
    },
  };
  const a = createRadioPageCatalog(storage);
  const b = createRadioPageCatalog(storage);
  assert.equal(a.get("a"), null);
  b.put("b", { songs: [song], continuation: null });
  assert.equal(a.getFresh("b")?.songs.length, 1);
  a.put("a", { songs: [song], continuation: null });
  assert.equal(b.getFresh("a")?.songs.length, 1);
  assert.equal(b.getFresh("b")?.songs.length, 1);
});
