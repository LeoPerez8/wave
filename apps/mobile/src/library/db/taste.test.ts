/// <reference types="node" />
import type { PlayEvent, YtAlbumSong } from "@wave/core";
import { eq } from "drizzle-orm";
import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";

import { recordPlay, setFavorites } from "./playHistory.ts";
import * as schema from "./schema.ts";
import { tasteHistory } from "./taste.ts";
import { tastePlaysPage } from "./tastePages.ts";
import { addTrack, openTestDatabase, type TestDatabase } from "./testDatabase.ts";

let db: TestDatabase;

beforeEach(async () => {
  db = await openTestDatabase();
});

const play = (
  trackId: number,
  startedAt: number,
  overrides: Partial<PlayEvent> = {},
): PlayEvent => ({
  trackId: String(trackId),
  context: null,
  startedAt,
  listenedMs: 180_000,
  durationMs: 180_000,
  endReason: "completed",
  counted: true,
  source: "phone",
  ...overrides,
});

describe("What the taste profile is derived from", () => {
  test("the plays of songs in the Library, with how long and how each ended", () => {
    const song = addTrack(db, { title: "Song" });
    recordPlay(db, play(song, 1_000));
    recordPlay(db, play(song, 2_000, { listenedMs: 4_000, endReason: "skipped", counted: false }));
    // A song gone from the Library has no artist or genre left to weigh.
    recordPlay(db, play(999, 3_000));
    assert.deepEqual(tasteHistory(db).plays, [
      { trackId: String(song), startedAt: 1_000, listenedMs: 180_000, endReason: "completed" },
      { trackId: String(song), startedAt: 2_000, listenedMs: 4_000, endReason: "skipped" },
    ]);
  });

  test("the starred songs, with when their star changed; not unstarred ones", () => {
    const starred = addTrack(db, { title: "Starred" });
    const unstarred = addTrack(db, { title: "Unstarred" });
    setFavorites(db, [starred, unstarred], true, 5_000);
    setFavorites(db, [unstarred], false, 6_000);
    assert.deepEqual(tasteHistory(db).favorites, [{ trackId: String(starred), changedAt: 5_000 }]);
  });

  test("the songs downloaded from YouTube Music, by their file's date", () => {
    addTrack(db, { title: "Scanned", addedAt: 1_000 });
    const downloaded = addTrack(db, { title: "Downloaded", addedAt: 7_000 });
    const retagged = addTrack(db, { title: "Retagged", addedAt: 8_000 });
    const { tracks } = schema;
    db.update(tracks).set({ videoId: "v1" }).where(eq(tracks.id, downloaded)).run();
    // Its tags edited later: it still dates from when it came in.
    db.update(tracks)
      .set({ videoId: "v2", modifiedAt: 9_000 })
      .where(eq(tracks.id, retagged))
      .run();
    assert.deepEqual(tasteHistory(db).downloads, [
      { trackId: String(downloaded), downloadedAt: 7_000 },
      { trackId: String(retagged), downloadedAt: 8_000 },
    ]);
  });

  test("the plays of streamed songs, by their queue id until the Library has the song", () => {
    const airbag: YtAlbumSong = {
      videoId: "v-airbag",
      title: "Airbag",
      artists: ["Radiohead"],
      album: "OK Computer",
      durationMs: 284_000,
      artworkUrl: null,
      explicit: false,
      albumId: null,
    };
    const song = addTrack(db, { title: "Song" });
    recordPlay(db, play(song, 1_000));
    const streamed = { ...play(song, 2_000), trackId: "yt:v-airbag" };
    recordPlay(db, streamed, false, airbag);
    recordPlay(db, { ...streamed, startedAt: 3_000, endReason: "skipped" }, false, airbag);
    const plays = () => [tasteHistory(db).plays, tastePlaysPage(db, [-Number.MAX_VALUE, 0]).rows];
    const at = (trackId: string, startedAt: number, endReason = "completed") => ({
      trackId,
      startedAt,
      listenedMs: 180_000,
      endReason,
    });
    for (const read of plays())
      assert.deepEqual(read, [
        at(String(song), 1_000),
        at("yt:v-airbag", 2_000),
        at("yt:v-airbag", 3_000, "skipped"),
      ]);
    // Downloaded, its streamed plays are the Library song's, as in every count.
    const downloaded = addTrack(db, { title: "Airbag" });
    db.update(schema.tracks)
      .set({ videoId: "v-airbag" })
      .where(eq(schema.tracks.id, downloaded))
      .run();
    for (const read of plays())
      assert.deepEqual(read, [
        at(String(song), 1_000),
        at(String(downloaded), 2_000),
        at(String(downloaded), 3_000, "skipped"),
      ]);
  });
});
