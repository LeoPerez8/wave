import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { ytSongsDownload } from "./index.ts";
import type { YtDownloadJournalJob, YtSong } from "./index.ts";

const song = (videoId: string, title = `Song ${videoId}`): YtSong => ({
  videoId,
  title,
  artists: ["Artist"],
  album: null,
  durationMs: 200_000,
  artworkUrl: null,
  explicit: false,
});

const job = (videoId: string, patch: Partial<YtDownloadJournalJob> = {}): YtDownloadJournalJob => ({
  id: videoId,
  song: song(videoId),
  phase: "queued",
  ...patch,
});

const nothingInLibrary = (_song: YtSong): boolean => false;

describe("downloading a list of YT Music songs", () => {
  test("songs from different albums are decided as one list: Download, Cancel, then Retry Failed", () => {
    const songs = [{ ...song("a"), album: "One" }, { ...song("b"), album: "Two" }, song("c")];
    const fresh = ytSongsDownload(songs, { inLibrary: nothingInLibrary, jobs: [] });
    assert.deepEqual(fresh.actions, ["download"]);
    assert.deepEqual(
      fresh.toDownload.map(({ song: { videoId } }) => videoId),
      ["a", "b", "c"],
    );

    const going = ytSongsDownload(songs, {
      inLibrary: nothingInLibrary,
      jobs: [job("a"), job("b"), job("c", { phase: "failed", reason: "account" })],
    });
    assert.deepEqual(going.actions, ["cancel"]);
    assert.equal(going.line, "Downloading · 0 of 3");

    const ended = ytSongsDownload(songs, {
      inLibrary: ({ videoId }) => videoId !== "c",
      jobs: [
        job("a", { phase: "completed", acknowledged: true, saved: { path: "/a.mp3" } }),
        job("b", { phase: "completed", acknowledged: true, saved: { path: "/b.mp3" } }),
        job("c", { phase: "failed", reason: "account" }),
      ],
    });
    assert.deepEqual(ended.actions, ["retryFailed"]);
    assert.deepEqual(ended.toCancel, []);
  });
});
