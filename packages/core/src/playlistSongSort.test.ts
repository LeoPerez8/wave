import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CUSTOM_SONG_SORT,
  PLAYLIST_SONG_SORT_BUCKETS,
  readPlaylistSongSort,
  readPlaylistSongSorts,
  sortPlaylistSongs,
  storedPlaylistSongSort,
  syncedBucket,
  withSyncedBucketEntry,
} from "./index.ts";
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
  for (const value of [null, 5, "bad", "-", "-custom", "release", { key: "title" }])
    assert.deepEqual(readPlaylistSongSort(value), CUSTOM_SONG_SORT);
  assert.deepEqual(readPlaylistSongSort("-artist"), { key: "artist", descending: true });
  assert.deepEqual(readPlaylistSongSort("releaseDate"), { key: "releaseDate", descending: false });
});
test("a sort is stored as its key, descending with a minus; Custom stores nothing", () => {
  assert.equal(storedPlaylistSongSort({ key: "title", descending: false }), "title");
  assert.equal(storedPlaylistSongSort({ key: "releaseDate", descending: true }), "-releaseDate");
  assert.equal(storedPlaylistSongSort(CUSTOM_SONG_SORT), null);
  assert.deepEqual(
    readPlaylistSongSorts(JSON.stringify({ a: "-album", b: "custom", c: 3, d: "added" })),
    { a: "-album", d: "added" },
  );
});
test("the account's every playlist keeps a sort in the same few preferences", () => {
  // As many playlists as the Wave account keeps (`maxPlaylists`), each with the longest sort,
  // under sync ids like the app's (32 hex digits), drawn from a fixed seed.
  let seed = 926;
  const hex = () => {
    // xorshift32
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return (seed >>> 0).toString(16).padStart(8, "0");
  };
  const buckets: Record<string, string>[] = Array.from(
    { length: PLAYLIST_SONG_SORT_BUCKETS },
    () => ({}),
  );
  for (let i = 0; i < 5000; i++) {
    const id = `${hex()}${hex()}${hex()}${hex()}`;
    const bucket = syncedBucket(id, PLAYLIST_SONG_SORT_BUCKETS);
    const next = withSyncedBucketEntry(buckets[bucket]!, id, "-releaseDate");
    assert.notEqual(next, null, `playlist ${i}`);
    buckets[bucket] = next!;
  }
  assert.ok(PLAYLIST_SONG_SORT_BUCKETS + 8 < 200);
});
test("artist and album sort both ways, keeping equal entries in Custom order", () => {
  const a = { title: "A", artist: "Z", album: "B", addedAt: 1 };
  const b = { title: "B", artist: "A", album: "A", addedAt: 2 };
  const c = { ...b, title: "C" };
  for (const key of ["artist", "album"] as const) {
    for (const descending of [false, true]) {
      const sort = { key, descending };
      assert.deepEqual(readPlaylistSongSort(storedPlaylistSongSort(sort)), sort);
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
    assert.deepEqual(readPlaylistSongSort(storedPlaylistSongSort(sort)), sort);
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

test("equal release dates follow album order when disc or track tags are absent", () => {
  const base = { title: "Song", artist: "Artist", album: "Album", addedAt: 0, releaseDate: "1985" };
  const songs = [
    { ...base, id: 0, discNumber: null, trackNumber: null },
    { ...base, id: 1, discNumber: 2, trackNumber: 1 },
    { ...base, id: 2, discNumber: 1, trackNumber: 2 },
    { ...base, id: 3, discNumber: null, trackNumber: 1 },
  ];
  for (const descending of [false, true])
    assert.deepEqual(
      sortPlaylistSongs(songs, { key: "releaseDate", descending }).map((song) => song.id),
      [3, 2, 0, 1],
    );
});
