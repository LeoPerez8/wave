import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { queuedDownloads, queuedDownloadsSummary } from "./index.ts";
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
    assert.equal(queuedDownloadsSummary(queuedDownloads([])), null);
    assert.equal(
      queuedDownloadsSummary(
        queuedDownloads([
          job("a", { phase: "transferring" }),
          job("b", { phase: "tagging" }),
          ...waiting(5),
        ]),
      ),
      "2 downloading · 5 waiting",
    );
    assert.equal(queuedDownloadsSummary(queuedDownloads(waiting(1200))), "1,200 waiting");
    assert.equal(
      queuedDownloadsSummary(queuedDownloads([job("a", { phase: "preparing" })])),
      "1 downloading",
    );
  });
});
