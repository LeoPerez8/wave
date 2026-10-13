import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  YT_DOWNLOADS_NONE,
  stepYtDownloads,
  ytDownloadActions,
  ytDownloadLine,
  ytDownloadProgress,
  ytDownloadStatus,
  ytDownloadsToStart,
} from "./index.ts";
import type { YtDownloadEvent, YtDownloads, YtDownloadStatus, YtSong } from "./index.ts";

const song = (videoId: string): YtSong => ({
  videoId,
  title: `Song ${videoId}`,
  artists: ["Artist"],
  album: null,
  durationMs: null,
  artworkUrl: null,
  explicit: false,
});

const run = (...events: YtDownloadEvent[]): YtDownloads =>
  events.reduce<YtDownloads>(stepYtDownloads, YT_DOWNLOADS_NONE);

const requested = (videoId: string): YtDownloadEvent => ({
  type: "requested",
  song: song(videoId),
});
const started = (videoId: string): YtDownloadEvent => ({ type: "started", videoId });

describe("the download queue", () => {
  test("a requested song waits its turn, and starts when nothing else downloads", () => {
    const state = run(requested("a"));
    assert.deepEqual(ytDownloadStatus(state, "a"), { kind: "queued" });
    assert.deepEqual(
      ytDownloadsToStart(state).map((s) => s.videoId),
      ["a"],
    );
  });

  test("songs download one at a time, in the order they were asked for", () => {
    let state = run(requested("a"), requested("b"), requested("c"), started("a"));
    assert.deepEqual(ytDownloadsToStart(state), []);
    state = stepYtDownloads(state, { type: "finished", videoId: "a", path: "/m/a.m4a" });
    assert.deepEqual(
      ytDownloadsToStart(state).map((s) => s.videoId),
      ["b"],
    );
  });

  test("asking again for a song that's queued or downloading changes nothing", () => {
    const state = run(requested("a"), started("a"), requested("b"));
    assert.equal(stepYtDownloads(state, requested("a")), state);
    assert.equal(stepYtDownloads(state, requested("b")), state);
  });

  test("a song downloaded before (and since deleted from the Library) downloads again", () => {
    const state = run(
      requested("a"),
      started("a"),
      { type: "finished", videoId: "a", path: "/m/a.m4a" },
      requested("a"),
    );
    assert.deepEqual(ytDownloadStatus(state, "a"), { kind: "queued" });
    assert.deepEqual(
      ytDownloadsToStart(state).map((s) => s.videoId),
      ["a"],
    );
  });

  test("a download reports how much has arrived, then that it's being saved, then where", () => {
    let state = run(requested("a"), started("a"));
    assert.deepEqual(ytDownloadStatus(state, "a"), {
      kind: "downloading",
      received: 0,
      total: null,
    });
    state = stepYtDownloads(state, {
      type: "progress",
      videoId: "a",
      received: 2_500,
      total: 10_000,
    });
    assert.deepEqual(ytDownloadStatus(state, "a"), {
      kind: "downloading",
      received: 2_500,
      total: 10_000,
    });
    state = stepYtDownloads(state, { type: "saving", videoId: "a" });
    assert.deepEqual(ytDownloadStatus(state, "a"), { kind: "saving" });
    assert.deepEqual(ytDownloadsToStart(stepYtDownloads(state, requested("b"))), []);
    state = stepYtDownloads(state, { type: "finished", videoId: "a", path: "/m/a.m4a" });
    assert.deepEqual(ytDownloadStatus(state, "a"), { kind: "done", path: "/m/a.m4a" });
  });

  test("a failed download says why, lets the next one start and can be retried", () => {
    let state = run(requested("a"), requested("b"), started("a"));
    state = stepYtDownloads(state, { type: "failed", videoId: "a", reason: "offline" });
    assert.deepEqual(ytDownloadStatus(state, "a"), { kind: "failed", reason: "offline" });
    assert.deepEqual(
      ytDownloadsToStart(state).map((s) => s.videoId),
      ["b"],
    );
    state = stepYtDownloads(stepYtDownloads(state, started("b")), requested("a"));
    assert.deepEqual(ytDownloadStatus(state, "a"), { kind: "queued" });
  });

  test("a retried download waits behind the songs already queued", () => {
    let state = run(requested("a"), requested("b"), started("a"));
    state = stepYtDownloads(state, { type: "failed", videoId: "a", reason: "failed" });
    state = stepYtDownloads(state, requested("a"));
    assert.deepEqual(
      ytDownloadsToStart(state).map((s) => s.videoId),
      ["b"],
    );
  });

  test("cancelling forgets a waiting, downloading or failed download", () => {
    for (const events of [
      [requested("a")],
      [requested("a"), started("a")],
      [requested("a"), started("a"), { type: "failed", videoId: "a", reason: "failed" } as const],
    ]) {
      const state = stepYtDownloads(run(...events), { type: "cancelled", videoId: "a" });
      assert.equal(ytDownloadStatus(state, "a"), null);
    }
  });

  test("a download being saved or done can't be cancelled any more", () => {
    const saving = run(requested("a"), started("a"), { type: "saving", videoId: "a" });
    assert.equal(stepYtDownloads(saving, { type: "cancelled", videoId: "a" }), saving);
    const done = stepYtDownloads(saving, { type: "finished", videoId: "a", path: "/m/a.m4a" });
    assert.equal(stepYtDownloads(done, { type: "cancelled", videoId: "a" }), done);
  });

  test("news about a cancelled download is ignored", () => {
    const state = run(requested("a"), started("a"), { type: "cancelled", videoId: "a" });
    for (const event of [
      { type: "progress", videoId: "a", received: 1, total: 2 },
      { type: "saving", videoId: "a" },
      { type: "failed", videoId: "a", reason: "failed" },
      { type: "finished", videoId: "a", path: "/m/a.m4a" },
    ] as const) {
      assert.equal(stepYtDownloads(state, event), state);
    }
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

  test("the row's progress rule shows how much has arrived, once the size is known", () => {
    assert.equal(ytDownloadProgress({ kind: "downloading", received: 2_500, total: 10_000 }), 0.25);
    assert.equal(ytDownloadProgress({ kind: "downloading", received: 2_500, total: null }), null);
    assert.equal(ytDownloadProgress({ kind: "downloading", received: 20, total: 10 }), 1);
    assert.equal(ytDownloadProgress({ kind: "queued" }), null);
    assert.equal(ytDownloadProgress(null), null);
  });
});
