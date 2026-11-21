/// <reference types="node" />
import { EMPTY_QUEUE, reduceQueue, type PlayEvent, type YtAlbumSong } from "@wave/core";
import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";

import { recordPlay } from "./db/playHistory.ts";
import { addTrack, openTestDatabase, type TestDatabase } from "./db/testDatabase.ts";
import { queueShuffle } from "./queueShuffle.ts";

let db: TestDatabase;

beforeEach(async () => {
  db = await openTestDatabase();
});

const airbag: YtAlbumSong = {
  videoId: "v-airbag",
  title: "Airbag",
  artists: ["Radiohead", "Someone Else"],
  album: "OK Computer",
  durationMs: 284_000,
  artworkUrl: null,
  explicit: false,
  albumId: "MPREb_ok",
};

const streamed = (videoId: string) => (videoId === airbag.videoId ? airbag : undefined);

const counted = (trackId: number, startedAt: number): PlayEvent => ({
  trackId: String(trackId),
  context: null,
  startedAt,
  listenedMs: 180_000,
  durationMs: 180_000,
  endReason: "completed",
  counted: true,
  source: "desktop",
});

const songs = { kind: "songs", id: null } as const;
const playing = (trackIds: readonly string[]) =>
  reduceQueue(EMPTY_QUEUE, { type: "play", trackIds, startIndex: 0, context: songs }).state;
const on = { type: "setShuffle", on: true } as const;

describe("the shuffle a queue command uses", () => {
  test("is Real Shuffle while that is the kind chosen", () => {
    const id = String(addTrack(db, { title: "So What" }));
    const shuffle = queueShuffle({ db, kind: () => "real", streamed });
    assert.deepEqual(shuffle(playing([id]), on), { kind: "real" });
  });

  test("is Smart Shuffle with the songs' counted plays", () => {
    const played = addTrack(db, { title: "So What" });
    const never = addTrack(db, { title: "Blue in Green" });
    recordPlay(db, counted(played, 1_000));
    recordPlay(db, counted(played, 2_000));
    const shuffle = queueShuffle({ db, kind: () => "smart", streamed });
    assert.deepEqual(shuffle(playing([String(played), String(never)]), on), {
      kind: "smart",
      plays: new Map([[String(played), 2]]),
    });
  });

  test("is Even Shuffle with each song's artist, genre and album, streamed ones included", () => {
    const id = String(
      addTrack(db, { title: "Dive", artist: "Sleep Token", album: "Eden", genre: "Metal" }),
    );
    const shuffle = queueShuffle({ db, kind: () => "even", streamed });
    assert.deepEqual(shuffle(playing([id, "yt:v-airbag", "yt:v-unknown"]), on), {
      kind: "even",
      songs: new Map([
        [id, { artist: "Sleep Token", genre: "Metal", album: "Eden" }],
        ["yt:v-airbag", { artist: "Radiohead", genre: null, album: "OK Computer" }],
      ]),
    });
  });

  test("follows a change of kind, and reads nothing for a command that doesn't shuffle", () => {
    const id = String(addTrack(db, { title: "So What" }));
    let kind: "real" | "smart" = "real";
    const shuffle = queueShuffle({ db, kind: () => kind, streamed });
    kind = "smart";
    assert.equal(shuffle(playing([id]), on).kind, "smart");
    assert.deepEqual(shuffle(playing([id]), { type: "next" }), { kind: "real" });
  });
});
