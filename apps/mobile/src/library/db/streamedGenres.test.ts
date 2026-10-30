import assert from "node:assert/strict";
import { test } from "node:test";
import { pendingStreamedGenres, keepStreamedGenre, streamedSongGenres } from "./streamedGenres.ts";
import { openTestDatabase, reopenTestDatabase } from "./testDatabase.ts";
import { playEvents } from "./schema.ts";

test("history fill visits each video once, persisting genres and misses across reads", async () => {
  let db = await openTestDatabase();
  for (const [i, videoId] of ["a", "a", "b"].entries()) {
    db.insert(playEvents)
      .values({
        counted: true,
        videoId,
        startedAt: i + 1,
        listenedMs: 20_000,
        durationMs: 60_000,
        endReason: "completed",
      })
      .run();
  }
  assert.deepEqual(pendingStreamedGenres(db, "", 10), ["a", "b"]);
  keepStreamedGenre(db, "a", "Rock");
  keepStreamedGenre(db, "b", null);
  db = await reopenTestDatabase(db);
  assert.deepEqual(pendingStreamedGenres(db, "", 10), []);
  assert.deepEqual(streamedSongGenres(db, ["a", "b", "unknown"]), [
    { id: "a", genre: "Rock" },
    { id: "b", genre: null },
  ]);
});

test("historical streamed snapshots retain the recorded duration for Deezer matching", async () => {
  const { streamedSongsOf } = await import("./streamedSongs.ts");
  const db = await openTestDatabase();
  db.insert(playEvents)
    .values({
      videoId: "old",
      counted: true,
      startedAt: 1,
      listenedMs: 20_000,
      durationMs: 180_000,
      endReason: "completed",
      snapshot: {
        title: "Airbag",
        artist: "Radiohead",
        album: "OK Computer",
        artworkPath: null,
        thumbPath: null,
      },
    })
    .run();
  assert.equal(streamedSongsOf(db, ["old"]).get("old")?.durationMs, 180_000);
});

test("skipped-only streams are never sent for lookup; a later counted play makes them eligible", async () => {
  const db = await openTestDatabase();
  const play = {
    videoId: "skip",
    startedAt: 1,
    listenedMs: 1000,
    durationMs: 60000,
    endReason: "skipped" as const,
  };
  db.insert(playEvents)
    .values({ ...play, counted: false })
    .run();
  assert.deepEqual(pendingStreamedGenres(db, ""), []);
  db.insert(playEvents)
    .values({ ...play, startedAt: 2, counted: true })
    .run();
  assert.deepEqual(pendingStreamedGenres(db, ""), ["skip"]);
});
