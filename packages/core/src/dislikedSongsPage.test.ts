import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { dislikedSongRows, type DislikedSong } from "./index.ts";

const dislike = (
  key: string,
  title: string,
  artists: readonly string[],
  dislikedAt: number,
): DislikedSong => ({ key, title, artists, durationMs: 180_000, dislikedAt });

const PINK_MOON = dislike("12", "Pink Moon", ["Nick Drake"], 1_000);
const ROAD = dislike("yt:abcdefghijk", "Road", ["Nick Drake", "John Cale"], 3_000);
const NORTHERN_SKY = dislike("40", "Northern Sky", [], 2_000);

const keys = (...songs: readonly DislikedSong[]): ReadonlySet<string> =>
  new Set(songs.map((song) => song.key));

describe("Settings › Disliked songs", () => {
  test("lists the Library's and YT Music's disliked songs alike, the newest first", () => {
    assert.deepEqual(
      dislikedSongRows([PINK_MOON, ROAD, NORTHERN_SKY], keys(PINK_MOON, ROAD, NORTHERN_SKY)),
      [
        { key: "yt:abcdefghijk", title: "Road", artist: "Nick Drake & John Cale" },
        { key: "40", title: "Northern Sky", artist: "" },
        { key: "12", title: "Pink Moon", artist: "Nick Drake" },
      ],
    );
  });

  test("a song whose dislike was removed leaves the list at once", () => {
    assert.deepEqual(
      dislikedSongRows([ROAD, NORTHERN_SKY, PINK_MOON], keys(ROAD, PINK_MOON)).map(
        (row) => row.title,
      ),
      ["Road", "Pink Moon"],
    );
  });

  test("songs disliked at the same moment keep the order they were read in", () => {
    const first = dislike("1", "First", [], 5_000);
    const second = dislike("2", "Second", [], 5_000);
    assert.deepEqual(
      dislikedSongRows([first, second], keys(first, second)).map((row) => row.title),
      ["First", "Second"],
    );
  });

  test("with no dislikes the list is empty", () => {
    assert.deepEqual(dislikedSongRows([], new Set()), []);
    assert.deepEqual(dislikedSongRows([PINK_MOON], new Set()), []);
  });
});
