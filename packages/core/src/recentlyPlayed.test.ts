import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { recentlyPlayedAlbums, type LatestPlayedSong } from "./index.ts";

/** Songs as the store reads them, latest played first: [album id, latest play]. */
const songs = (...rows: [number, number][]): LatestPlayedSong[] =>
  rows.map(([albumId, lastPlayedAt]) => ({ albumId, lastPlayedAt }));

describe("recentlyPlayedAlbums", () => {
  test("lists each album once, by its latest play, the latest first", () => {
    const read = songs([3, 900], [1, 800], [3, 700], [2, 600], [1, 500]);

    assert.deepEqual(recentlyPlayedAlbums(read, 12, true), [3, 1, 2]);
  });

  test("stops at the limit", () => {
    const read = songs([5, 900], [4, 800], [3, 700], [2, 600], [1, 500]);

    assert.deepEqual(recentlyPlayedAlbums(read, 2, false), [5, 4]);
  });

  test("albums last played at the same time come by album, the latest added first", () => {
    const read = songs([2, 900], [7, 900], [4, 800]);

    assert.deepEqual(recentlyPlayedAlbums(read, 12, true), [7, 2, 4]);
  });

  test("on a tie, Library albums, the latest added first, come before online ones in order", () => {
    const read: LatestPlayedSong<number | string>[] = [
      { albumId: "MPREb_b", lastPlayedAt: 900 },
      { albumId: 2, lastPlayedAt: 900 },
      { albumId: "MPREb_a", lastPlayedAt: 900 },
      { albumId: 7, lastPlayedAt: 900 },
    ];

    assert.deepEqual(recentlyPlayedAlbums(read, 12, true), [7, 2, "MPREb_a", "MPREb_b"]);
  });

  test("needs more songs while the songs read hold too few albums and others remain", () => {
    const read = songs([3, 900], [3, 800], [2, 700]);

    assert.equal(recentlyPlayedAlbums(read, 3, false), null);
  });

  test("an album played when the songs read stop may tie with one not read yet", () => {
    // Album 1's song at 700 is the last read: an unread song of album 9 may have played at 700 too.
    const read = songs([3, 900], [2, 800], [1, 700]);

    assert.equal(recentlyPlayedAlbums(read, 3, false), null);
    assert.deepEqual(recentlyPlayedAlbums(read, 2, false), [3, 2]);
  });

  test("with every played song read, the albums there are, however few", () => {
    assert.deepEqual(recentlyPlayedAlbums(songs([3, 900], [2, 700]), 12, true), [3, 2]);
    assert.deepEqual(recentlyPlayedAlbums([], 12, true), []);
  });
});
