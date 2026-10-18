/// <reference types="node" />
import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";

import type { YtAlbumSong } from "@wave/core";
import { eq, sql } from "drizzle-orm";

import {
  noteStreamedSong,
  selectKnownVideos,
  selectPlaylistedSongs,
  selectStreamedSongs,
} from "./mixKnown.ts";
import { recordPlay } from "./playHistory.ts";
import { createPlaylist, deletePlaylist, removePlaylistItems } from "./playlists.ts";
import * as schema from "./schema.ts";
import { addTrack, openTestDatabase, type TestDatabase } from "./testDatabase.ts";

let db: TestDatabase;

beforeEach(async () => {
  db = await openTestDatabase();
});

const yt = (videoId: string, title = `Song ${videoId}`): YtAlbumSong => ({
  videoId,
  title,
  artists: ["Massive Attack"],
  album: null,
  albumId: null,
  durationMs: 200_000,
  artworkUrl: null,
  explicit: true,
});

const playTrack = (trackId: number, startedAt: number): void => {
  recordPlay(db, {
    trackId: String(trackId),
    context: null,
    startedAt,
    listenedMs: 1_000,
    durationMs: 180_000,
    endReason: "skipped",
    counted: false,
    source: "phone",
  });
};

describe("Songs the owner streamed", () => {
  test("read back with how many times each was streamed and when first", () => {
    noteStreamedSong(db, yt("a", "Angel"), 1_000);
    noteStreamedSong(db, yt("b"), 2_000);
    noteStreamedSong(db, yt("a", "Angel"), 3_000);
    const streamed = selectStreamedSongs(db).toSorted((x, y) =>
      x.song.videoId.localeCompare(y.song.videoId),
    );
    assert.deepEqual(streamed, [
      { song: yt("a", "Angel"), plays: 2, firstPlayedAt: 1_000 },
      { song: yt("b"), plays: 1, firstPlayedAt: 2_000 },
    ]);
  });
});

describe("Songs in the owner's playlists, for mixes", () => {
  test("are the entries other than Library songs of playlists not deleted, with when each was added", () => {
    const track = addTrack(db, { title: "Teardrop", artist: "Massive Attack" });
    createPlaylist(
      db,
      "Mine",
      [
        { source: "library", trackId: track },
        { source: "stream", song: yt("p") },
        {
          source: "unsearched",
          song: {
            title: "Glory Box",
            artists: ["Portishead"],
            album: null,
            durationMs: null,
            artworkUrl: null,
          },
        },
      ],
      5_000,
    );
    const gone = createPlaylist(db, "Gone", [{ source: "stream", song: yt("g") }], 6_000);
    deletePlaylist(db, gone.playlistId, 7_000);
    const removed = createPlaylist(db, "Removed", [{ source: "stream", song: yt("r") }], 8_000);
    const [item] = db
      .select({ id: schema.playlistItems.id })
      .from(schema.playlistItems)
      .where(eq(schema.playlistItems.playlistId, removed.playlistId))
      .all();
    removePlaylistItems(db, removed.playlistId, [item!.id], 9_000);

    const listed = selectPlaylistedSongs(db);
    assert.deepEqual(
      listed.map((entry) => [
        entry.song.source,
        entry.song.source === "stream" ? entry.song.song.videoId : entry.song.song.title,
        entry.addedAt,
      ]),
      [
        ["stream", "p", 5_000],
        ["unsearched", "Glory Box", 5_000],
      ],
    );
  });
});

describe("The videos the owner knows now, for re-blending mixes", () => {
  test("are those streamed, those in a playlist, and downloaded songs played or in a playlist", () => {
    noteStreamedSong(db, yt("streamed"), 1_000);
    createPlaylist(db, "Mine", [{ source: "stream", song: yt("listed") }], 2_000);
    const played = addTrack(db, { title: "Played" });
    const listedTrack = addTrack(db, { title: "Listed" });
    const untouched = addTrack(db, { title: "Untouched" });
    for (const [id, videoId] of [
      [played, "dl-played"],
      [listedTrack, "dl-listed"],
      [untouched, "dl-untouched"],
    ] as const) {
      db.run(sql`UPDATE tracks SET video_id = ${videoId} WHERE id = ${id}`);
    }
    playTrack(played, 3_000);
    createPlaylist(db, "Other", [{ source: "library", trackId: listedTrack }], 4_000);
    assert.deepEqual(selectKnownVideos(db).toSorted(), [
      "dl-listed",
      "dl-played",
      "listed",
      "streamed",
    ]);
  });
});
