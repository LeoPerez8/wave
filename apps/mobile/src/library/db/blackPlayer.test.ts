/// <reference types="node" />
import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";

import { importedPlays, saveImportedPlays, selectImportTracks } from "./blackPlayer.ts";
import { homeSections, latestPlay, recordPlay } from "./playHistory.ts";
import { trackPlayTotals } from "./stats.ts";
import { addTrack, openTestDatabase, type TestDatabase } from "./testDatabase.ts";

let db: TestDatabase;

beforeEach(async () => {
  db = await openTestDatabase();
});

const allTime = { from: null, to: 100_000 };

describe("Imported BlackPlayer plays", () => {
  test("count as counted plays in Stats and Most Played, listened for the song's length", () => {
    const airbag = addTrack(db, { title: "Airbag", durationMs: 284_000 });
    const bloom = addTrack(db, { title: "Bloom", durationMs: 315_000 });
    saveImportedPlays(db, [
      { trackId: airbag, startedAt: 1_000 },
      { trackId: airbag, startedAt: 2_000 },
      { trackId: bloom, startedAt: 3_000 },
    ]);

    assert.deepEqual(
      trackPlayTotals(db, allTime)
        .map((row) => [row.id, row.countedPlays, row.listenedMs, row.latestPlayAt])
        .toSorted(([a], [b]) => Number(a) - Number(b)),
      [
        [airbag, 2, 568_000, 2_000],
        [bloom, 1, 315_000, 3_000],
      ],
    );
    assert.deepEqual(
      homeSections(db).mostPlayed.map((row) => [row.title, row.playCount]),
      [
        ["Airbag", 2],
        ["Bloom", 1],
      ],
    );
  });

  test("are told apart from Wave's own: how many each song has and the latest", () => {
    const airbag = addTrack(db, { title: "Airbag" });
    const bloom = addTrack(db, { title: "Bloom" });
    saveImportedPlays(db, [
      { trackId: airbag, startedAt: 1_000 },
      { trackId: airbag, startedAt: 5_000 },
    ]);
    recordPlay(db, {
      trackId: String(bloom),
      context: null,
      startedAt: 9_000,
      listenedMs: 200_000,
      durationMs: 200_000,
      endReason: "completed",
      counted: true,
      source: "phone",
    });

    assert.deepEqual(importedPlays(db), [{ trackId: airbag, plays: 2, latestAt: 5_000 }]);
  });

  test("are never the play Wave picks back up after a restart", () => {
    const airbag = addTrack(db, { title: "Airbag" });
    const bloom = addTrack(db, { title: "Bloom" });
    const id = recordPlay(db, {
      trackId: String(bloom),
      context: null,
      startedAt: 9_000,
      listenedMs: 20_000,
      durationMs: 200_000,
      endReason: "interrupted",
      counted: true,
      source: "phone",
    });
    saveImportedPlays(db, [{ trackId: airbag, startedAt: 1_000 }]);

    assert.equal(latestPlay(db)?.id, id);
  });
});

describe("selectImportTracks", () => {
  test("lists every track's path, title, credit and length, for matching BlackPlayer's rows", () => {
    const airbag = addTrack(db, {
      title: "Airbag",
      artist: "Radiohead",
      album: "OK Computer",
      durationMs: 284_000,
    });
    assert.deepEqual(selectImportTracks(db), [
      {
        id: airbag,
        path: "/Music/OK Computer/Airbag.mp3",
        title: "Airbag",
        artist: "Radiohead",
        durationMs: 284_000,
      },
    ]);
  });
});
