import assert from "node:assert/strict";
import { test } from "node:test";
import type { LeavingSong, YtSong } from "@wave/core";
import { createDeletePlayingSong, type DeletablePlayingSong } from "./deletePlayingSong.ts";

const track: DeletablePlayingSong = { id: 7, path: "/Music/song.mp3", title: "Song" };
const leaving: LeavingSong = {
  videoId: "abc",
  title: "Song",
  artist: "Artist & Other",
  artists: ["Artist", "Other"],
  album: "Album",
  durationMs: 200_000,
  explicit: false,
};
const target = { trackId: "7" };

test("the file gone, the playing song streams on before the delete takes it out of the queue", async () => {
  const log: string[] = [];
  const streamed: [string, YtSong][] = [];
  const deletePlayingSong = createDeletePlayingSong({
    leaving: async () => leaving,
    ytMusicOn: () => true,
    // The menu's Delete: files first, then the songs leave the Library and the queue.
    confirmDelete: async (songs, { filesGone }) => {
      log.push("files deleted");
      await filesGone(songs);
      log.push("left the queue");
    },
    streamInstead: async (trackId, song) => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      streamed.push([trackId, song]);
      log.push("streams");
    },
  });

  await deletePlayingSong(target, track);

  assert.deepEqual(log, ["files deleted", "streams", "left the queue"]);
  assert.deepEqual(streamed, [
    [
      "7",
      {
        videoId: "abc",
        title: "Song",
        artists: ["Artist", "Other"],
        album: "Album",
        durationMs: 200_000,
        artworkUrl: "https://i.ytimg.com/vi/abc/hqdefault.jpg",
        explicit: false,
      },
    ],
  ]);
});

test("a file that couldn't be deleted, or a cancelled delete, keeps the song playing from it", async () => {
  const streamed: string[] = [];
  const deletePlayingSong = createDeletePlayingSong({
    leaving: async () => leaving,
    ytMusicOn: () => true,
    // Nothing was deleted: the songs stay, and the files-gone step never runs.
    confirmDelete: async () => {},
    streamInstead: async (trackId) => {
      streamed.push(trackId);
    },
  });

  await deletePlayingSong(target, track);

  assert.deepEqual(streamed, []);
});

test("without YouTube Music, nothing streams and the delete moves the queue on", async () => {
  const streamed: string[] = [];
  const left: number[][] = [];
  const deletePlayingSong = createDeletePlayingSong({
    leaving: async () => leaving,
    ytMusicOn: () => false,
    confirmDelete: async (songs, { filesGone }) => {
      await filesGone(songs);
      left.push(songs.map((song) => song.id));
    },
    streamInstead: async (trackId) => {
      streamed.push(trackId);
    },
  });

  await deletePlayingSong(target, track);

  assert.deepEqual(streamed, []);
  assert.deepEqual(left, [[7]]);
});
