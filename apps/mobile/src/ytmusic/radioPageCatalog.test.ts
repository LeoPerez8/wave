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
