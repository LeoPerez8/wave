import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { throttledFailures, throttledFailuresLine } from "./index.ts";
import type { QualityFile, ThrottledFailureJob, ThrottledFailuresInput, YtSong } from "./index.ts";

const song = (videoId: string): YtSong => ({
  videoId,
  title: `Song ${videoId}`,
  artists: ["Artist"],
  album: null,
  durationMs: null,
  artworkUrl: null,
  explicit: false,
});

/** A YouTube download that failed as unavailable at its first attempt: what Oct 18 left. */
const refused = (
  videoId: string,
  patch: Partial<ThrottledFailureJob> = {},
): ThrottledFailureJob => ({
  id: videoId,
  song: song(videoId),
  phase: "failed",
  reason: "ytUnavailable",
  source: "youtube",
  attempts: 1,
  ...patch,
});

const mp3 = (id: number): QualityFile => ({
  id,
  path: `/music/${id}.mp3`,
  durationMs: 200_000,
  bitrateKbps: 320,
  sizeBytes: 8_000_000,
});

const input = (
  patch: Partial<ThrottledFailuresInput<YtSong>> = {},
): ThrottledFailuresInput<YtSong> => ({
  inLibrary: () => false,
  missingTrackIds: new Set(),
  files: [],
  noBetterCopy: { upgrade: new Set(), downgrade: new Set() },
  direction: "downgrade",
  ...patch,
});

const ids = (jobs: readonly ThrottledFailureJob[], given = input()) =>
  throttledFailures(jobs, given).map((failed) => failed.id);

describe("the songs YouTube's Oct 18 limit failed go back to the queue once", () => {
  test("a song that failed as unavailable at its first attempt goes again, as its Retry asks", () => {
    const [failed, ...rest] = throttledFailures([refused("a")], input());
    assert.deepEqual(rest, []);
    assert.equal(failed?.id, "a");
    assert.deepEqual(failed?.retry, { kind: "song", song: song("a") });
  });

  test("only that failure: other reasons, later attempts, Soulseek's and imports stay as they are", () => {
    const jobs = [
      refused("twice", { attempts: 2 }),
      refused("offline", { reason: "offline" }),
      refused("failed", { reason: "failed" }),
      refused("soulseek", { source: "soulseek" }),
      refused("queued", { phase: "queued" }),
      refused("unimported", { phase: "completed", importFailure: "ytUnavailable" }),
      refused("kept"),
    ];
    assert.deepEqual(ids(jobs), ["kept"]);
  });

  test("a song failed under the new rules, after YouTube's refusals were retried, isn't asked again", () => {
    assert.deepEqual(ids([refused("retried", { refusedAt: 1_000 }), refused("old")]), ["old"]);
  });

  test("a song downloaded since, or a missing song found since, is left alone", () => {
    const jobs = [refused("landed"), refused("missing:7"), refused("missing:8"), refused("still")];
    const given = input({
      inLibrary: (s) => s.videoId === "landed",
      missingTrackIds: new Set([8]),
    });
    assert.deepEqual(ids(jobs, given), ["missing:8", "still"]);
  });

  test("a freeing-space replacement goes again only while its Track is still an MP3 320 to replace", () => {
    const jobs = [
      // Its Track was removed from the Library.
      refused("downgrade:1"),
      // Replaced since: its Track's file is the M4A now.
      refused("downgrade:2"),
      // Recorded as having no YouTube Music copy.
      refused("downgrade:3"),
      refused("downgrade:4"),
    ];
    const given = input({
      files: [{ ...mp3(2), path: "/music/2.m4a", bitrateKbps: 128 }, mp3(3), mp3(4)],
      noBetterCopy: { upgrade: new Set(), downgrade: new Set([3]) },
    });
    const [failed, ...rest] = throttledFailures(jobs, given);
    assert.deepEqual(rest, []);
    assert.equal(failed?.id, "downgrade:4");
    assert.deepEqual(failed?.retry, { kind: "quality", direction: "downgrade", trackId: 4 });
  });

  test("with Download in best quality turned on since, freeing space isn't asked again", () => {
    const given = input({ files: [mp3(4)], direction: "upgrade" });
    assert.deepEqual(ids([refused("downgrade:4"), refused("a")], given), ["a"]);
  });

  test("the app log says how many went back", () => {
    assert.equal(
      throttledFailuresLine(655),
      "655 songs that failed as unavailable while YouTube limited downloads went back to the queue",
    );
    assert.equal(
      throttledFailuresLine(1),
      "1 song that failed as unavailable while YouTube limited downloads went back to the queue",
    );
    assert.equal(
      throttledFailuresLine(0),
      "No songs that failed as unavailable while YouTube limited downloads needed to go back to the queue",
    );
  });
});
