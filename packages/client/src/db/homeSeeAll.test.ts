/// <reference types="node" />
import type { PlayEvent } from "@wave/core";
import assert from "node:assert/strict";
import { test } from "node:test";

import { homeSections, recentlyAddedList, recentlyPlayedList, recordPlay } from "./playHistory.ts";
import { addTrack, openTestDatabase } from "./testDatabase.ts";

const play = (trackId: number, startedAt: number): PlayEvent => ({
  trackId: String(trackId),
  context: null,
  startedAt,
  listenedMs: 180_000,
  durationMs: 180_000,
  endReason: "completed",
  counted: true,
  source: "phone",
});

test("See all lists every album Recently Added and Recently Played hold, past the shelf's 12", async () => {
  const db = await openTestDatabase();
  const tracks = Array.from({ length: 15 }, (_, i) =>
    addTrack(db, { title: `Song ${i}`, album: `Album ${i}`, artist: "A", addedAt: i + 1 }),
  );
  // The first added is the latest played: it leads Recently Played.
  tracks.forEach((id, i) => recordPlay(db, play(id, 1_000 - i)));
  const albums = Array.from({ length: 15 }, (_, i) => `Album ${i}`);

  assert.equal(homeSections(db).recentlyAdded.length, 12);
  assert.deepEqual(
    recentlyAddedList(db).map((album) => album.title),
    [...albums].reverse(),
  );
  assert.equal(homeSections(db).recentlyPlayed.length, 12);
  assert.deepEqual(
    recentlyPlayedList(db).map((album) => album.title),
    albums,
  );
});
