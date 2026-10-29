import { test } from "node:test";
import assert from "node:assert/strict";
import { openTestDatabase, reopenTestDatabase, closeTestDatabase } from "./testDatabase.ts";
import { readFollowReleases, saveFollowReleases, hideFollowRelease } from "./followReleases.ts";
test("a release cache and Hide survive restarting the database", async () => {
  const db = await openTestDatabase();
  saveFollowReleases(db, "abba", [], 123);
  hideFollowRelease(db, "deezer:12");
  const reopened = await reopenTestDatabase(db);
  assert.deepEqual(readFollowReleases(reopened), {
    artists: [{ key: "abba", releases: [], checkedAt: 123 }],
    hidden: ["deezer:12"],
  });
  closeTestDatabase(reopened);
});

import { addTrack } from "./testDatabase.ts";
import { recordPlay } from "./playHistory.ts";
import { followReleaseListening } from "./followReleases.ts";
import { followFeed, type FollowRelease } from "@wave/core";
test("owned releases open the Library album and a counted song clears the feed after restart", async () => {
  const db = await openTestDatabase();
  const trackId = addTrack(db, { title: "One", album: "New (Deluxe Edition)", artist: "ABBA" });
  const release: FollowRelease = {
    key: "deezer:1",
    artistKey: "abba",
    title: "New",
    type: "album",
    releaseDate: "2026-10-29",
    artworkUrl: null,
    explicit: false,
    browseId: null,
    videoIds: [],
    recordingKeys: [],
  };
  const input = () => followReleaseListening(db, [release], { abba: "ABBA" });
  assert.equal(typeof input().releases[0]?.libraryAlbumId, "number");
  recordPlay(db, {
    trackId: String(trackId),
    context: { kind: "album", id: "1" },
    startedAt: 1,
    listenedMs: 16000,
    durationMs: 180000,
    endReason: "skipped",
    counted: true,
    source: "phone",
  });
  const reopened = await reopenTestDatabase(db);
  const listening = followReleaseListening(reopened, [release], { abba: "ABBA" });
  const follows = [
    {
      key: "abba",
      name: "ABBA",
      level: "releases" as const,
      followedAt: Date.UTC(2026, 9, 29),
      deezerId: 1,
      ytBrowseId: null,
    },
  ];
  assert.equal(
    followFeed({ follows, ...listening, now: Date.UTC(2026, 9, 29), hidden: [] }).releaseCards
      .length,
    0,
  );
  closeTestDatabase(reopened);
});
test("streamed counted video ids clear releases without any Library files", async () => {
  const db = await openTestDatabase();
  const release: FollowRelease = {
    key: "deezer:2",
    artistKey: "abba",
    title: "Stream",
    type: "single",
    releaseDate: "2026-10-29",
    artworkUrl: null,
    explicit: false,
    browseId: "MPRE1",
    videoIds: ["abc"],
    recordingKeys: [],
  };
  recordPlay(
    db,
    {
      trackId: "yt:abc",
      context: { kind: "ytAlbum", id: "MPRE1" },
      startedAt: 1,
      listenedMs: 16000,
      durationMs: 180000,
      endReason: "skipped",
      counted: true,
      source: "phone",
    },
    false,
    {
      explicit: false,
      videoId: "abc",
      title: "Song",
      artists: ["ABBA"],
      album: "Stream",
      albumId: "MPRE1",
      artworkUrl: null,
      durationMs: 180000,
    },
  );
  assert.deepEqual(followReleaseListening(db, [release], {}).countedPlays, ["abc"]);
  closeTestDatabase(db);
});
