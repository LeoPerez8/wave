import assert from "node:assert/strict";
import { test } from "node:test";
import { unsearchedTrackId } from "@wave/core";

import { toUnsearchedQueueTrack, toYtQueueTrack } from "../playback/queueTracks.ts";
import { queueSongMenuTarget } from "./queueSongMenu.ts";

test("a Library queue entry opens its usual song menu even before row metadata loads", () => {
  assert.deepEqual(queueSongMenuTarget("42", undefined), { kind: "library", id: 42 });
});

test("an unsearched queue entry opens its imported song menu before metadata loads", () => {
  const song = {
    title: "Still looking",
    artists: ["Artist"],
    album: "Album",
    durationMs: 200000,
    artworkUrl: "https://covers/imported.jpg",
  };
  assert.deepEqual(queueSongMenuTarget(unsearchedTrackId(song), undefined), {
    kind: "unsearched",
    song: { ...song, artworkUrl: null },
  });
});

test("a YT Music queue entry keeps its full song and album link for its usual menu", () => {
  const song = {
    videoId: "one",
    title: "One",
    artists: ["First artist", "Second artist"],
    album: "Album",
    albumId: "album-one",
    durationMs: 180000,
    artworkUrl: "https://covers/one.jpg",
    explicit: true,
  };
  assert.deepEqual(queueSongMenuTarget("yt:one", toYtQueueTrack(song, null)), {
    kind: "stream",
    song,
  });
});

test("an unsearched queue entry keeps the imported cover when its metadata is loaded", () => {
  const song = {
    title: "Still looking",
    artists: ["Artist"],
    album: null,
    durationMs: null,
    artworkUrl: "https://covers/imported.jpg",
  };
  const track = toUnsearchedQueueTrack(song);
  assert.deepEqual(queueSongMenuTarget(track.id, track), { kind: "unsearched", song });
});
