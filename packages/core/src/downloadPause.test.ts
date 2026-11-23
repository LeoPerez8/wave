import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  NO_DOWNLOAD_PAUSE,
  cancelAllDownloadsAlert,
  downloadsToCancelAll,
  downloadHeld,
  downloadRequested,
  requestRunsWhilePaused,
  pauseAllDownloads,
  resumeAllDownloads,
} from "./index.ts";
import type { YtDownloadJournalJob, YtSong } from "./index.ts";

const song = (videoId: string): YtSong => ({
  videoId,
  title: `Song ${videoId}`,
  artists: ["Artist"],
  album: null,
  durationMs: null,
  artworkUrl: null,
  explicit: false,
});

const job = (videoId: string, patch: Partial<YtDownloadJournalJob> = {}): YtDownloadJournalJob => ({
  id: videoId,
  song: song(videoId),
  phase: "queued",
  ...patch,
});

describe("Pause in Settings › Downloads and the notification", () => {
  test("nothing is held until Pause", () => {
    assert.equal(downloadHeld(NO_DOWNLOAD_PAUSE, job("a")), false);
  });

  test("Pause holds every song waiting or downloading", () => {
    const paused = pauseAllDownloads(NO_DOWNLOAD_PAUSE);
    for (const phase of ["queued", "preparing", "prepared", "transferring"] as const)
      assert.equal(downloadHeld(paused, job("a", { phase })), true, phase);
  });

  test("a song already downloaded finishes saving", () => {
    const paused = pauseAllDownloads(NO_DOWNLOAD_PAUSE);
    for (const phase of ["sourceReady", "tagging", "awaitingPublication", "publishing"] as const)
      assert.equal(downloadHeld(paused, job("a", { phase })), false, phase);
    assert.equal(downloadHeld(paused, job("a", { phase: "completed" })), false);
    assert.equal(downloadHeld(paused, job("a", { phase: "failed" })), false);
  });

  test("Resume holds nothing again", () => {
    const resumed = resumeAllDownloads(pauseAllDownloads(NO_DOWNLOAD_PAUSE));
    assert.equal(downloadHeld(resumed, job("a")), false);
    assert.deepEqual(resumed, NO_DOWNLOAD_PAUSE);
  });
});

describe("A new request while paused", () => {
  const paused = pauseAllDownloads(NO_DOWNLOAD_PAUSE);

  test("a song, a list's Download and a star download their songs, and the rest stays paused", () => {
    for (const request of ["song", "list", "star"] as const) {
      assert.equal(requestRunsWhilePaused(request), true, request);
      const pause = downloadRequested(paused, ["a"], request);
      assert.equal(downloadHeld(pause, job("a")), false, request);
      assert.equal(downloadHeld(pause, job("b")), true, request);
    }
  });

  test("Retry, quality replacements and Wave's own requeues stay paused", () => {
    for (const request of ["retry", "quality", "background"] as const) {
      assert.equal(requestRunsWhilePaused(request), false, request);
      assert.equal(
        downloadHeld(downloadRequested(paused, ["a"], request), job("a")),
        true,
        request,
      );
    }
  });

  test("asking while not paused changes nothing", () => {
    assert.deepEqual(downloadRequested(NO_DOWNLOAD_PAUSE, ["a"], "song"), NO_DOWNLOAD_PAUSE);
  });

  test("Pause again holds the songs asked for in between", () => {
    const again = pauseAllDownloads(downloadRequested(paused, ["a"], "song"));
    assert.equal(downloadHeld(again, job("a", { phase: "transferring" })), true);
  });

  test("Resume forgets them", () => {
    assert.deepEqual(
      resumeAllDownloads(downloadRequested(paused, ["a"], "song")),
      NO_DOWNLOAD_PAUSE,
    );
  });
});

describe("Cancel All", () => {
  test("removes every song waiting or downloading, and leaves the downloaded and failed ones", () => {
    const jobs = [
      job("waiting"),
      job("starting", { phase: "preparing" }),
      job("downloading", { phase: "transferring" }),
      job("downloaded", { phase: "tagging" }),
      job("saving", { phase: "publishing" }),
      job("done", { phase: "completed", acknowledged: true }),
      job("failed", { phase: "failed", reason: "failed" }),
      job("notImported", { phase: "completed", importFailure: "failed" }),
    ];
    assert.deepEqual(downloadsToCancelAll(jobs), ["waiting", "starting", "downloading"]);
  });

  test("Downloads asks first, saying how many", () => {
    assert.deepEqual(cancelAllDownloadsAlert(12), {
      title: "Cancel 12 downloads?",
      message: "Songs already downloaded stay, and failed songs stay in the failed list.",
      action: { label: "Cancel All", destructive: true },
      dismissLabel: "Keep Downloading",
    });
    assert.equal(cancelAllDownloadsAlert(1).title, "Cancel 1 download?");
    assert.equal(cancelAllDownloadsAlert(1_234, "pt-BR").title, "Cancelar 1.234 downloads?");
    assert.equal(cancelAllDownloadsAlert(1, "pt-BR").title, "Cancelar 1 download?");
  });
});
