import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { rankMostPlayed } from "./index.ts";

const library = (id: number) => ({ kind: "library", id }) as const;
const streamed = (videoId: string) => ({ kind: "yt", videoId }) as const;

describe("rankMostPlayed", () => {
  test("ranks Library and streamed songs by counted plays, then by their latest counted play", () => {
    const ranking = rankMostPlayed(
      [
        { id: 1, countedPlays: 3, lastCountedAt: 1_000 },
        { id: 2, countedPlays: 3, lastCountedAt: 5_000 },
        { id: 3, countedPlays: 0, lastCountedAt: null },
      ],
      [
        { videoId: "five", trackId: null, countedPlays: 5, lastCountedAt: 100 },
        { videoId: "tie", trackId: null, countedPlays: 3, lastCountedAt: 3_000 },
        { videoId: "skipped", trackId: null, countedPlays: 0, lastCountedAt: null },
      ],
      10,
    );
    assert.deepEqual(ranking, [
      { song: streamed("five"), countedPlays: 5, lastCountedAt: 100 },
      { song: library(2), countedPlays: 3, lastCountedAt: 5_000 },
      { song: streamed("tie"), countedPlays: 3, lastCountedAt: 3_000 },
      { song: library(1), countedPlays: 3, lastCountedAt: 1_000 },
    ]);
  });

  test("a streamed song in the Library adds its plays to that song's, once across its videos", () => {
    const ranking = rankMostPlayed(
      [
        { id: 7, countedPlays: 2, lastCountedAt: 2_000 },
        { id: 8, countedPlays: 4, lastCountedAt: 500 },
      ],
      [
        { videoId: "a", trackId: 7, countedPlays: 2, lastCountedAt: 9_000 },
        { videoId: "b", trackId: 7, countedPlays: 1, lastCountedAt: 1_000 },
        // No plays from its file yet.
        { videoId: "c", trackId: 9, countedPlays: 1, lastCountedAt: 100 },
        // One video under two recording keys.
        { videoId: "d", trackId: null, countedPlays: 1, lastCountedAt: 300 },
        { videoId: "d", trackId: null, countedPlays: 1, lastCountedAt: 400 },
      ],
      10,
    );
    assert.deepEqual(ranking, [
      { song: library(7), countedPlays: 5, lastCountedAt: 9_000 },
      { song: library(8), countedPlays: 4, lastCountedAt: 500 },
      { song: streamed("d"), countedPlays: 2, lastCountedAt: 400 },
      { song: library(9), countedPlays: 1, lastCountedAt: 100 },
    ]);
  });

  test("a full tie goes to the latest added Library song, then Library songs before streamed ones", () => {
    const tie = { countedPlays: 1, lastCountedAt: 1_000 };
    const ranking = rankMostPlayed(
      [
        { id: 1, ...tie },
        { id: 2, ...tie },
      ],
      [
        { videoId: "y", trackId: null, ...tie },
        { videoId: "x", trackId: null, ...tie },
      ],
      3,
    );
    assert.deepEqual(
      ranking.map((entry) => entry.song),
      [library(2), library(1), streamed("x")],
    );
  });
});
