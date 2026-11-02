import assert from "node:assert/strict";
import { test } from "node:test";
import { readPlaylistSongSort, sortPlaylistSongs } from "./index.ts";
test("sorts mixed entries without changing custom order and survives additions/removals", () => {
  const entries = ["library", "stream", "unsearched", "unavailable"].map((source, i) => ({
    source,
    title: ["Z", "B", "A", "C"][i]!,
    artist: "Artist",
    album: "Album",
    addedAt: i,
  }));
  assert.deepEqual(
    sortPlaylistSongs(entries, { key: "title", descending: false }).map((x) => x.title),
    ["A", "B", "C", "Z"],
  );
  assert.deepEqual(
    sortPlaylistSongs(entries, { key: "added", descending: true }),
    [...entries].reverse(),
  );
  assert.deepEqual(
    sortPlaylistSongs(entries.slice(1), { key: "custom", descending: false }),
    entries.slice(1),
  );
  assert.equal(entries[0]!.title, "Z");
});
test("unreadable and older choices default to Custom", () => {
  for (const value of [null, "bad", "{}", '{"key":"release"}'])
    assert.deepEqual(readPlaylistSongSort(value), { key: "custom", descending: false });
  assert.deepEqual(readPlaylistSongSort('{"key":"artist","descending":true}'), {
    key: "artist",
    descending: true,
  });
});
test("artist and album sort both ways, keeping equal entries in Custom order", () => {
  const a = { title: "A", artist: "Z", album: "B", addedAt: 1 };
  const b = { title: "B", artist: "A", album: "A", addedAt: 2 };
  const c = { ...b, title: "C" };
  for (const key of ["artist", "album"] as const) {
    for (const descending of [false, true]) {
      const sort = { key, descending };
      assert.deepEqual(readPlaylistSongSort(JSON.stringify(sort)), sort);
      assert.deepEqual(sortPlaylistSongs([a, b, c], sort), descending ? [a, b, c] : [b, c, a]);
    }
  }
});
