import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  ytDownloadActions,
  ytDownloadLine,
  ytDownloadProgress,
  ytDownloadStatus,
  ytDownloadsFromJournal,
} from "./index.ts";
import type { YtDownloadJournalJob, YtDownloadStatus, YtSong } from "./index.ts";

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

/** The status the rows show for [videoId], from the native journal's [jobs]. */
const shown = (jobs: readonly YtDownloadJournalJob[], videoId: string) =>
  ytDownloadStatus(ytDownloadsFromJournal(jobs), videoId);

describe("the native download journal, as rows show it", () => {
  test("a waiting download says so, in the order the journal keeps", () => {
    const state = ytDownloadsFromJournal([job("a", { phase: "transferring" }), job("b")]);
    assert.deepEqual(
      state.jobs.map((item) => item.song.videoId),
      ["a", "b"],
    );
    assert.deepEqual(shown([job("b")], "b"), { kind: "queued" });
  });

  test("a download finds the recording, waits in a peer's queue, arrives, then is checked", () => {
    assert.deepEqual(shown([job("a", { phase: "preparing" })], "a"), {
      kind: "downloading",
      received: 0,
      total: null,
      phase: "searching",
    });
    assert.deepEqual(shown([job("a", { phase: "prepared" })], "a"), {
      kind: "downloading",
      received: 0,
      total: null,
      phase: "connecting",
    });
    assert.deepEqual(
      shown([job("a", { phase: "transferring", received: 0, total: 0, queuePosition: 4 })], "a"),
      { kind: "downloading", received: 0, total: null, phase: "queued" },
    );
    assert.deepEqual(
      shown([job("a", { phase: "transferring", received: 2_500, total: 10_000 })], "a"),
      { kind: "downloading", received: 2_500, total: 10_000, phase: "transferring" },
    );
    assert.deepEqual(shown([job("a", { phase: "sourceReady" })], "a"), {
      kind: "downloading",
      received: 0,
      total: null,
      phase: "validating",
    });
  });

  test("a download from YouTube Music waits, downloads, is checked, then saved", () => {
    const line = (patch: Partial<YtDownloadJournalJob>) =>
      ytDownloadLine(shown([job("a", { source: "youtube", ...patch })], "a"));
    assert.equal(line({ phase: "queued" }), "Waiting to download");
    assert.equal(line({ phase: "preparing" }), "Waiting to download");
    assert.equal(line({ phase: "prepared" }), "Waiting to download");
    assert.equal(
      line({ phase: "transferring", received: 4_200, total: 10_000 }),
      "Downloading · 42%",
    );
    assert.equal(line({ phase: "sourceReady" }), "Checking the download");
    assert.equal(line({ phase: "tagging" }), "Saving to the Library");
  });

  test("tagging, publishing and importing show as saving until the Library has the Track", () => {
    for (const phase of ["tagging", "awaitingPublication", "publishing", "completed"] as const) {
      assert.deepEqual(shown([job("a", { phase })], "a"), { kind: "saving" });
    }
    assert.deepEqual(
      shown(
        [job("a", { phase: "completed", acknowledged: true, saved: { path: "/m/a.mp3" } })],
        "a",
      ),
      { kind: "done", path: "/m/a.mp3" },
    );
  });

  test("a failure says why, including a file the Library couldn't import", () => {
    assert.deepEqual(shown([job("a", { phase: "failed", reason: "unavailable" })], "a"), {
      kind: "failed",
      reason: "unavailable",
    });
    assert.deepEqual(shown([job("a", { phase: "failed" })], "a"), {
      kind: "failed",
      reason: "failed",
    });
    assert.deepEqual(shown([job("a", { phase: "completed", importFailure: "storage" })], "a"), {
      kind: "failed",
      reason: "storage",
    });
  });

  test("a cancelled download is forgotten", () => {
    assert.equal(shown([job("a", { phase: "cancelled" })], "a"), null);
  });

  test("a result id positively matched to a job shows that job's status", () => {
    const state = ytDownloadsFromJournal([job("a", { phase: "preparing", aliases: [song("b")] })]);
    assert.deepEqual(ytDownloadStatus(state, "b"), ytDownloadStatus(state, "a"));
  });
});

/** The download entries for a song that isn't in the Library. */
const actions = (status: YtDownloadStatus | null) =>
  ytDownloadActions(status, { inLibrary: false });

describe("a YT Music song's download, as its row and menu show it", () => {
  test("the menu offers Download, Cancel Download while it's on its way, Retry after a failure", () => {
    assert.deepEqual(actions(null), ["download"]);
    assert.deepEqual(actions({ kind: "queued" }), ["cancelDownload"]);
    assert.deepEqual(actions({ kind: "downloading", received: 1, total: 9 }), ["cancelDownload"]);
    assert.deepEqual(actions({ kind: "saving" }), []);
    assert.deepEqual(actions({ kind: "failed", reason: "offline" }), [
      "retryDownload",
      "cancelDownload",
    ]);
  });

  test("a downloaded song deleted from the Library offers Download again", () => {
    const done = { kind: "done", path: "/m/a.m4a" } as const;
    assert.deepEqual(ytDownloadActions(done, { inLibrary: true }), []);
    assert.deepEqual(ytDownloadActions(done, { inLibrary: false }), ["download"]);
  });

  test("the row's second line says where the download is", () => {
    assert.equal(ytDownloadLine(null), null);
    assert.equal(ytDownloadLine({ kind: "queued" }), "Waiting to download");
    assert.equal(
      ytDownloadLine({ kind: "downloading", received: 4_200, total: 10_000 }),
      "Downloading · 42%",
    );
    assert.equal(ytDownloadLine({ kind: "downloading", received: 0, total: null }), "Downloading");
    assert.equal(ytDownloadLine({ kind: "saving" }), "Saving to the Library");
    assert.equal(ytDownloadLine({ kind: "done", path: "/m/a.m4a" }), "In the Library");
    assert.equal(ytDownloadLine({ kind: "failed", reason: "offline" }), "Download failed: offline");
    assert.equal(ytDownloadLine({ kind: "failed", reason: "failed" }), "Download failed");
    assert.equal(
      ytDownloadLine({ kind: "failed", reason: "noFolder" }),
      "Download failed: no music folder",
    );
    assert.equal(
      ytDownloadLine({ kind: "failed", reason: "storage" }),
      "Download failed: couldn't save the file",
    );
  });

  test("without YT Music or a Soulseek account, the row says to connect one, and keeps Retry", () => {
    const status = { kind: "failed", reason: "noSource" } as const;
    assert.equal(ytDownloadLine(status), "Connect YT Music or Soulseek in Settings");
    assert.deepEqual(actions(status), ["retryDownload", "cancelDownload"]);
  });

  test("a song YouTube Music won't serve says so, and keeps Retry", () => {
    const status = { kind: "failed", reason: "ytUnavailable" } as const;
    assert.equal(ytDownloadLine(status), "This song is unavailable on YouTube Music");
    assert.deepEqual(actions(status), ["retryDownload", "cancelDownload"]);
  });

  test("the row's progress rule shows how much has arrived, once the size is known", () => {
    assert.equal(ytDownloadProgress({ kind: "downloading", received: 2_500, total: 10_000 }), 0.25);
    assert.equal(ytDownloadProgress({ kind: "downloading", received: 2_500, total: null }), null);
    assert.equal(ytDownloadProgress({ kind: "downloading", received: 20, total: 10 }), 1);
    assert.equal(ytDownloadProgress({ kind: "queued" }), null);
    assert.equal(ytDownloadProgress(null), null);
  });
});
