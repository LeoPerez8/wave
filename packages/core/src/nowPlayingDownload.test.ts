import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { nowPlayingDownload, nowPlayingDownloadTap, streamedAfterDelete } from "./index.ts";

describe("Now Playing's Download button", () => {
  test("a song with a file in the Library shows it's downloaded", () => {
    assert.deepEqual(nowPlayingDownload(null, { hasFile: true }), { kind: "downloaded" });
  });

  test("a streamed song not on its way offers Download", () => {
    assert.deepEqual(nowPlayingDownload(null, { hasFile: false }), { kind: "download" });
  });

  test("a download waiting its turn shows waiting", () => {
    assert.deepEqual(nowPlayingDownload({ kind: "queued" }, { hasFile: false }), {
      kind: "waiting",
    });
  });

  test("a download receiving the file shows how much has arrived", () => {
    assert.deepEqual(
      nowPlayingDownload(
        { kind: "downloading", received: 250, total: 1000, phase: "transferring" },
        { hasFile: false },
      ),
      { kind: "progress", fraction: 0.25 },
    );
  });

  test("a download being saved to the Library shows a full ring", () => {
    assert.deepEqual(nowPlayingDownload({ kind: "saving" }, { hasFile: false }), {
      kind: "progress",
      fraction: 1,
    });
  });

  test("a failed download shows failed", () => {
    assert.deepEqual(
      nowPlayingDownload({ kind: "failed", reason: "offline" }, { hasFile: false }),
      { kind: "failed" },
    );
  });

  test("a finished download shows it's downloaded while the Library catches up", () => {
    assert.deepEqual(
      nowPlayingDownload({ kind: "done", path: "/music/a.m4a" }, { hasFile: false }),
      { kind: "downloaded" },
    );
  });
});

describe("A tap on Now Playing's Download button", () => {
  const song = { videoId: "abc" };

  test("a Library song with a file asks to delete it, as its menu's Delete does", () => {
    const track = { id: 7, path: "/music/a.m4a", title: "A" };
    assert.deepEqual(nowPlayingDownloadTap(track, song), { kind: "delete", track });
    assert.deepEqual(nowPlayingDownloadTap(track, null), { kind: "delete", track });
  });

  test("a missing song downloads into its Library entry", () => {
    assert.deepEqual(nowPlayingDownloadTap({ id: 7, path: null }, song), {
      kind: "missing",
      id: 7,
    });
  });

  test("a streamed song the Library hasn't got downloads as a new song", () => {
    assert.deepEqual(nowPlayingDownloadTap(null, song), { kind: "stream", song });
  });

  test("a Library song no longer in the Library can't be downloaded", () => {
    assert.deepEqual(nowPlayingDownloadTap(null, null), { kind: "gone" });
  });
});

describe("The song playing once Now Playing's Download deleted its file", () => {
  const track = {
    id: 7,
    title: "Song",
    artist: "Artist & Other",
    album: "Album",
    durationMs: 200_000,
    explicit: "explicit",
  } as const;
  const on = { videoId: "abc", ytMusicOn: true };

  test("playing from its file, it goes on as the YT Music song of the video it came from", () => {
    assert.deepEqual(streamedAfterDelete("7", track, on), {
      videoId: "abc",
      title: "Song",
      artists: ["Artist & Other"],
      album: "Album",
      durationMs: 200_000,
      artworkUrl: "https://i.ytimg.com/vi/abc/hqdefault.jpg",
      explicit: true,
    });
  });

  test("an album or a length the file didn't know stays unknown", () => {
    const song = streamedAfterDelete(
      "7",
      { ...track, album: "Unknown Album", durationMs: 0, explicit: "unknown" },
      on,
    );
    assert.equal(song?.album, null);
    assert.equal(song?.durationMs, null);
    assert.equal(song?.explicit, false);
  });

  test("with YouTube Music off, the queue moves on to the next song", () => {
    assert.equal(streamedAfterDelete("7", track, { ...on, ytMusicOn: false }), null);
  });

  test("without a YouTube id, the queue moves on to the next song", () => {
    assert.equal(streamedAfterDelete("7", track, { ...on, videoId: null }), null);
  });

  test("a song already streamed goes on as it was", () => {
    assert.equal(streamedAfterDelete("yt:abc", track, on), null);
  });
});
