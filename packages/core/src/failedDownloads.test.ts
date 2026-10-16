import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { failedDownloads, settledDownloadFailures, ytAudioRejection } from "./index.ts";
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
  phase: "failed",
  reason: "failed",
  ...patch,
});

/** A job that hasn't failed, so it carries no reason. */
const unfailed = (videoId: string, patch: Partial<YtDownloadJournalJob>): YtDownloadJournalJob => ({
  id: videoId,
  song: song(videoId),
  phase: "queued",
  ...patch,
});

const nothingInLibrary = { inLibrary: () => false, missingTrackIds: null };

describe("Settings › Downloads: the songs whose download failed", () => {
  test("a failed download is listed with the line its row shows", () => {
    const [failed, ...rest] = failedDownloads(
      [job("a", { reason: "unavailable" })],
      nothingInLibrary,
    );
    assert.deepEqual(rest, []);
    assert.equal(failed?.id, "a");
    assert.equal(failed?.song.title, "Song a");
    assert.equal(failed?.line, "This recording is unavailable in 320 kbps");
  });

  test("only failures are listed: not what's on its way, saved, or cleared", () => {
    const jobs = [
      unfailed("queued", { phase: "queued" }),
      unfailed("moving", { phase: "transferring" }),
      job("saved", { phase: "completed", acknowledged: true, saved: { path: "/m/s.mp3" } }),
      job("cleared", { phase: "cancelled" }),
      job("offline", { reason: "offline" }),
      // Saved to the Library folder, but the Library couldn't import it.
      unfailed("unimported", { phase: "completed", importFailure: "storage" }),
    ];
    assert.deepEqual(
      failedDownloads(jobs, nothingInLibrary).map((failed) => [failed.id, failed.line]),
      [
        ["offline", "Download failed: offline"],
        ["unimported", "Download failed: couldn't save the file"],
      ],
    );
  });

  test("a song the Library has now, under any of its videos, has left the list", () => {
    const jobs = [job("a"), job("b"), job("c", { aliases: [song("c2")] })];
    const inLibrary = (found: YtSong) => found.videoId === "b" || found.videoId === "c2";
    assert.deepEqual(
      failedDownloads(jobs, { inLibrary, missingTrackIds: null }).map((failed) => failed.id),
      ["a"],
    );
  });

  test("a missing song's failure leaves once its Track isn't missing, and stays until they're read", () => {
    const jobs = [job("missing:1"), job("missing:2"), job("missing:x")];
    const ids = (missingTrackIds: ReadonlySet<number> | null) =>
      failedDownloads(jobs, { inLibrary: () => false, missingTrackIds }).map((failed) => failed.id);
    // Filled in (a scan found its file) or taken out of the Library: nothing's left to retry.
    assert.deepEqual(ids(new Set([2])), ["missing:2", "missing:x"]);
    assert.deepEqual(ids(null), ["missing:1", "missing:2", "missing:x"]);
  });

  test("Retry asks for the song again, a missing song as its Track; Clear lets go of every video on the job", () => {
    const [shared, missing] = failedDownloads(
      [job("a", { aliases: [song("a2"), song("a3")] }), job("missing:7")],
      nothingInLibrary,
    );
    assert.deepEqual(shared?.retry, { kind: "song", song: song("a") });
    assert.deepEqual(shared?.clear, ["a", "a2", "a3"]);
    assert.deepEqual(missing?.retry, { kind: "missingSong", trackId: 7 });
    assert.deepEqual(missing?.clear, ["missing:7"]);
  });

  test("the recorded cause shows under a line that doesn't say what to do, in its own words", () => {
    const detail = (patch: Partial<YtDownloadJournalJob>) =>
      failedDownloads([job("a", patch)], nothingInLibrary)[0]?.detail;
    // Each error says what went wrong in its message; a class name only stands in for a missing one.
    assert.equal(
      detail({
        reason: "failed",
        cause: "java.net.SocketException: Connection reset <- java.io.EOFException",
      }),
      "Connection reset <- EOFException",
    );
    assert.equal(
      detail({ reason: "timedOut", cause: "Out of time while transferring" }),
      "Out of time while transferring",
    );
    assert.equal(
      detail({
        reason: "ytUnavailable",
        cause: "YtFailure [LOGIN_REQUIRED]: Sign in to confirm your age",
      }),
      "Sign in to confirm your age",
    );
    // A path in a message keeps its dots.
    assert.equal(
      detail({ reason: "storage", cause: "java.io.IOException: No space left for /Music/A.B.mp3" }),
      "No space left for /Music/A.B.mp3",
    );
    // An error wrapping another names it in its message.
    assert.equal(
      detail({
        reason: "failed",
        cause: "java.io.IOException: java.net.SocketTimeoutException: timeout",
      }),
      "timeout",
    );
    // Lines that already say what to do, or no cause at all, stand alone.
    assert.equal(detail({ reason: "offline", cause: "java.net.UnknownHostException: host" }), null);
    assert.equal(detail({ reason: "noSource", cause: "java.io.IOException: x" }), null);
    assert.equal(detail({ reason: "account", cause: "java.io.IOException: x" }), null);
    assert.equal(detail({ reason: "failed" }), null);
  });

  test("a song that fell back from Soulseek shows why YouTube Music failed it, not Soulseek", () => {
    // The journal sets Soulseek's cause aside when the job falls back; YouTube's
    // length check records its own (`ytAudioRejection`).
    const cause = ytAudioRejection({ durationMs: 225_000 }, 242_400);
    assert.ok(cause !== null);
    const [failed] = failedDownloads(
      [job("a", { source: "youtube", reason: "ytUnavailable", cause })],
      nothingInLibrary,
    );
    assert.equal(failed?.line, "This song is unavailable on YouTube Music");
    assert.equal(failed?.detail, "YouTube's audio is 4:02 long, but the song is 3:45");
    // A YouTube failure with no cause of its own has no second line.
    const [bare] = failedDownloads(
      [job("b", { source: "youtube", reason: "ytUnavailable" })],
      nothingInLibrary,
    );
    assert.equal(bare?.detail, null);
  });

  test("a class name a release build shortened never shows: its message does", () => {
    const detail = (cause: string) =>
      failedDownloads([job("a", { reason: "unavailable", cause })], nothingInLibrary)[0]?.detail;
    // R8 renames Wave's SoulseekException to a bare, unqualified name.
    assert.equal(
      detail("bn5: The peer is unavailable. Retry the download"),
      "The peer is unavailable. Retry the download",
    );
    assert.equal(
      detail("bn5: The peer queue took too long. Retry the download <- a.b: Read timed out"),
      "The peer queue took too long. Retry the download <- Read timed out",
    );
    // One without a message says nothing; a cause of nothing else is no second line.
    assert.equal(
      detail("bn5: Soulseek sent an invalid response <- c4"),
      "Soulseek sent an invalid response",
    );
    assert.equal(detail("bn5"), null);
  });
});

describe("Failures the journal can forget: those that settled another way", () => {
  test("a settled failure is let go of under every video on its job; the rest stay", () => {
    const jobs = [
      job("a"),
      job("b", { aliases: [song("b2")] }),
      job("missing:1"),
      job("missing:2"),
      unfailed("moving", { phase: "transferring" }),
      job("cleared", { phase: "cancelled" }),
      unfailed("unimported", { phase: "completed", importFailure: "storage" }),
    ];
    const inLibrary = (found: YtSong) =>
      ["b2", "moving", "cleared", "unimported"].includes(found.videoId);
    assert.deepEqual(settledDownloadFailures(jobs, { inLibrary, missingTrackIds: new Set([2]) }), [
      "b",
      "b2",
      "missing:1",
      "unimported",
    ]);
  });

  test("nothing has settled while the Library or its missing songs aren't read", () => {
    assert.deepEqual(settledDownloadFailures([job("a"), job("missing:1")], nothingInLibrary), []);
  });

  test("exactly the failures the Downloads page no longer lists", () => {
    const jobs = [job("a"), job("b"), job("missing:1"), job("missing:2")];
    const input = {
      inLibrary: (found: YtSong) => found.videoId === "b",
      missingTrackIds: new Set([2]),
    };
    const listed = failedDownloads(jobs, input).flatMap((failed) => failed.clear);
    const settled = settledDownloadFailures(jobs, input);
    assert.deepEqual([...listed, ...settled].toSorted(), ["a", "b", "missing:1", "missing:2"]);
  });
});
