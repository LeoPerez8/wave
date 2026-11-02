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
test("release dates retain precision, use Year and leave missing dates last", () => {
  const entries = [null, "1985-06-21", "1985", "1985-06", null].map((releaseDate, id) => ({
    id,
    title: "Song",
    artist: "Artist",
    album: "Album",
    addedAt: 0,
    releaseDate,
    year: id === 4 ? 1984 : null,
  }));
  for (const descending of [false, true]) {
    const sort = { key: "releaseDate", descending } as const;
    assert.deepEqual(readPlaylistSongSort(JSON.stringify(sort)), sort);
    assert.deepEqual(
      sortPlaylistSongs(entries, sort).map((x) => x.id),
      descending ? [1, 3, 2, 4, 0] : [4, 2, 3, 1, 0],
    );
  }
});
test("equal release dates use disc and track order while undated songs keep Custom", () => {
  const base = { title: "Song", artist: "Artist", album: "Album", addedAt: 0 };
  const songs = [
    { ...base, id: 0, releaseDate: null, trackNumber: 5 },
    { ...base, id: 1, releaseDate: "1985", discNumber: 2, trackNumber: 1 },
    { ...base, id: 2, releaseDate: "1985", discNumber: 1, trackNumber: 2 },
    { ...base, id: 3, releaseDate: null, trackNumber: 1 },
    { ...base, id: 4, releaseDate: "1985", discNumber: 1, trackNumber: 1 },
  ];
  for (const descending of [false, true])
    assert.deepEqual(
      sortPlaylistSongs(songs, { key: "releaseDate", descending }).map((x) => x.id),
      [4, 2, 1, 0, 3],
    );
});
