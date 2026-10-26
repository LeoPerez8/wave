import assert from "node:assert/strict";
import { test } from "node:test";
import { artistStats } from "./artistStats.ts";

test("an artist's streamed listening counts even when none of their Library songs played", () => {
  const stats = artistStats({
    artistId: 1,
    songIds: [10],
    listening: [],
    songPlays: [],
    now: 5_000,
    streamedListening: [{ countedPlays: 2, listenedMs: 180_000, lastPlayedAt: 4_000 }],
  });
  assert.deepEqual(stats, {
    played: true,
    plays: "2 plays",
    minutesListened: "3 minutes listened",
    songsListened: "0 of 1 song",
    lastPlayed: "Last played just now",
    mostPlayed: [],
  });
});
