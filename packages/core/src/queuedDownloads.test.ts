import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { queuedDownloadCounts, queuedDownloads, queuedDownloadsSummary } from "./index.ts";
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

describe("Settings › Downloads: the songs on their way", () => {
  test("a waiting song is listed with the line its row shows", () => {
    assert.deepEqual(
      queuedDownloads([job("a")]).map((queued) => [queued.id, queued.song.title, queued.line]),
      [["a", "Song a", "Waiting to download"]],
    );
  });

  test("only songs on their way are listed: not failed, cancelled or in the Library", () => {
    const jobs = [
      job("failed", { phase: "failed", reason: "offline" }),
      job("cancelled", { phase: "cancelled" }),
      job("saved", { phase: "completed", acknowledged: true, saved: { path: "/m/s.mp3" } }),
      // Saved to the Library folder, but the Library couldn't import it: a failure.
      job("unimported", { phase: "completed", importFailure: "storage" }),
      job("tagging", { phase: "tagging" }),
      // Published, not yet imported.
      job("importing", { phase: "completed" }),
    ];
    assert.deepEqual(
      queuedDownloads(jobs).map((queued) => [queued.id, queued.line]),
      [
        ["tagging", "Saving to the Library"],
        ["importing", "Saving to the Library"],
      ],
    );
  });

  test("an album's songs: the ones downloading first, then the waiting ones in queue order", () => {
    // The journal lists jobs in the order they were asked for; a slot frees out of order.
    const jobs = [
      job("1", { phase: "completed", acknowledged: true, saved: { path: "/m/1.mp3" } }),
      job("2", { phase: "queued" }),
      job("3", { phase: "transferring", source: "youtube", received: 42, total: 100 }),
      job("4", { phase: "queued" }),
      job("5", { phase: "preparing", source: "soulseek" }),
      job("6", { phase: "publishing" }),
      job("7", { phase: "queued" }),
    ];
    assert.deepEqual(
      queuedDownloads(jobs).map((queued) => [queued.id, queued.line, queued.waiting]),
      [
        ["3", "Downloading · 42%", false],
        ["5", "Finding this recording", false],
        ["6", "Saving to the Library", false],
        ["2", "Waiting to download", true],
        ["4", "Waiting to download", true],
        ["7", "Waiting to download", true],
      ],
    );
  });

  test("Cancel lets go of every video asked for on the job, until it's saving", () => {
    const jobs = [
      job("a", { phase: "transferring", aliases: [song("b")] }),
      job("c"),
      job("d", { phase: "tagging" }),
    ];
    assert.deepEqual(
      queuedDownloads(jobs).map((queued) => [queued.id, queued.cancel]),
      [
        ["a", ["a", "b"]],
        // Too late to cancel, as its menu says.
        ["d", null],
        ["c", ["c"]],
      ],
    );
  });

  test("the section's line counts the songs downloading and waiting; nothing on its way, no section", () => {
    const waiting = (count: number) =>
      Array.from({ length: count }, (_, i) => job(`w${i}`, { phase: "queued" }));
    assert.equal(queuedDownloadsSummary(queuedDownloadCounts([])), null);
    assert.equal(
      queuedDownloadsSummary(
        queuedDownloadCounts([
          job("a", { phase: "transferring" }),
          job("b", { phase: "tagging" }),
          ...waiting(5),
        ]),
      ),
      "2 downloading · 5 waiting",
    );
    assert.equal(queuedDownloadsSummary(queuedDownloadCounts(waiting(1200))), "1,200 waiting");
    assert.equal(
      queuedDownloadsSummary(queuedDownloadCounts([job("a", { phase: "preparing" })])),
      "1 downloading",
    );
  });

  test("the counts leave out the songs that failed or finished, without listing any", () => {
    assert.deepEqual(
      queuedDownloadCounts([
        job("a", { phase: "transferring" }),
        job("b"),
        job("c"),
        job("failed", { phase: "failed", reason: "failed" }),
        job("cancelled", { phase: "cancelled" }),
        job("unimported", { phase: "completed", importFailure: "storage" }),
      ]),
      { downloading: 1, saving: 0, waiting: 2 },
    );
  });

  test("a song Wave was killed while downloading waits again until the queue takes it up", () => {
    const jobs = [
      job("a", { phase: "prepared", source: "soulseek", resumed: true }),
      job("b", { phase: "transferring" }),
      job("c", { phase: "preparing", source: "youtube", resumed: true }),
    ];
    assert.deepEqual(queuedDownloadCounts(jobs), { downloading: 1, saving: 0, waiting: 2 });
    // Its row says so; it keeps its place among the started songs (it can't be dragged).
    assert.deepEqual(
      queuedDownloads(jobs).map((queued) => [queued.id, queued.line]),
      [
        ["a", "Waiting to download"],
        ["b", "Downloading"],
        ["c", "Waiting to download"],
      ],
    );
  });

  test("an Oct 18 replacement run: only the songs holding a slot count as downloading", () => {
    // 2,365 downgrade jobs: 1,325 in the Library, 5 transferring, 2 started but waiting
    // (a pause before trying again, JS's answer), 3 tagging, 600 downloaded and waiting
    // their turn to be saved one at a time, 1 publishing, 1 waiting for its import,
    // and the rest not started yet.
    const run = (count: number, phase: YtDownloadJournalJob["phase"], patch = {}) =>
      Array.from({ length: count }, (_, i) =>
        job(`downgrade:${phase}${i}`, { phase, source: "youtube", ...patch }),
      );
    const jobs = [
      ...run(1325, "completed", { acknowledged: true, saved: { path: "/m/s.m4a" } }),
      ...run(5, "transferring", { received: 10, total: 100 }),
      ...run(1, "prepared"),
      ...run(1, "preparing"),
      ...run(3, "tagging"),
      ...run(600, "awaitingPublication"),
      ...run(1, "publishing"),
      ...run(1, "completed"),
      ...run(428, "queued"),
    ];
    assert.equal(jobs.length, 2365);
    assert.deepEqual(queuedDownloadCounts(jobs), { downloading: 10, saving: 602, waiting: 428 });
    assert.equal(
      queuedDownloadsSummary(queuedDownloadCounts(jobs)),
      "10 downloading · 602 saving · 428 waiting",
    );
  });
});
