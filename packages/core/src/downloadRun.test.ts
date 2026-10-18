import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  NO_DOWNLOAD_RUN,
  downloadRunGroupLine,
  downloadRunLines,
  downloadRunNotice,
  downloadRunPanelLine,
  downloadRunProgress,
  downloadTimeLeft,
  downloadTimeLeftLine,
  downloadsPaused,
  followDownloadRun,
  keptDownloadRun,
  playlistDownloadOrigin,
  qualityJobId,
  restoredDownloadRun,
} from "./index.ts";
import type { DownloadRun, YtDownloadJournalJob, YtSong } from "./index.ts";

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

const done = (videoId: string, patch: Partial<YtDownloadJournalJob> = {}) =>
  job(videoId, {
    phase: "completed",
    acknowledged: true,
    saved: { path: `/m/${videoId}.m4a` },
    ...patch,
  });
const failed = (videoId: string, patch: Partial<YtDownloadJournalJob> = {}) =>
  job(videoId, { phase: "failed", reason: "failed", ...patch });

/** Follows the journal through [snapshots], one a minute from 0. */
const follow = (...snapshots: YtDownloadJournalJob[][]): DownloadRun =>
  snapshots.reduce<DownloadRun>(
    (run, jobs, index) => followDownloadRun(run, jobs, index * 60_000),
    NO_DOWNLOAD_RUN,
  );

const counts = (run: DownloadRun) => downloadRunProgress(run).overall;

describe("Settings › Downloads: the run", () => {
  test("no run while nothing is on its way", () => {
    assert.equal(counts(follow([])), null);
    assert.equal(counts(follow([done("a"), failed("b")])), null);
  });

  test("the run counts the songs queued since the queue was last empty", () => {
    const run = follow(
      [done("old"), failed("oldFailure"), job("a"), job("b", { phase: "transferring" })],
      [done("old"), failed("oldFailure"), done("a"), job("b", { phase: "transferring" }), job("c")],
      [done("old"), failed("oldFailure"), done("a"), failed("b"), job("c")],
    );
    assert.deepEqual(counts(run), { done: 1, failed: 1, left: 1, total: 3 });
  });

  test("the run resets once nothing is left, and the next one counts afresh", () => {
    const run = follow([job("a")], [done("a")], [done("a"), job("b")]);
    assert.equal(counts(follow([job("a")], [done("a")])), null);
    assert.deepEqual(counts(run), { done: 0, failed: 0, left: 1, total: 1 });
  });

  test("a failed song retried is left again", () => {
    const run = follow([job("a"), job("b")], [failed("a"), job("b")], [job("a"), job("b")]);
    assert.deepEqual(counts(run), { done: 0, failed: 0, left: 2, total: 2 });
  });

  test("a cancelled song leaves the run; a done one the journal forgets stays done", () => {
    const run = follow(
      [job("a"), job("b"), job("c")],
      [done("a"), job("b", { phase: "cancelled" }), job("c")],
      [job("c")],
    );
    assert.deepEqual(counts(run), { done: 1, failed: 0, left: 1, total: 2 });
  });

  test("a replacement that found no better copy keeps its file: it's done, not failed", () => {
    const upgrade = qualityJobId("upgrade", 7);
    const other = qualityJobId("upgrade", 8);
    const run = follow(
      [job(upgrade), job(other), job("c")],
      [failed(upgrade, { reason: "notFound" }), failed(other, { reason: "unavailable" }), job("c")],
    );
    assert.deepEqual(counts(run), { done: 1, failed: 1, left: 1, total: 3 });
  });

  test("each group counts its own songs", () => {
    const mix = playlistDownloadOrigin({ id: 7, name: "Road trip" });
    const run = follow(
      [job("a", { origin: mix }), job("b", { origin: mix }), job("c")],
      [done("a", { origin: mix }), job("b", { origin: mix }), failed("c")],
    );
    const { groups } = downloadRunProgress(run);
    assert.deepEqual(groups.get("playlist:7"), { done: 1, failed: 0, left: 1, total: 2 });
    assert.deepEqual(groups.get("songs"), { done: 0, failed: 1, left: 0, total: 1 });
  });

  test("its counts in words, and how far along it is", () => {
    assert.deepEqual(downloadRunLines({ done: 1234, failed: 12, left: 1254, total: 2500 }), {
      count: "1,234 of 2,500",
      detail: "12 failed · 1,254 left",
      fraction: 0.4984,
    });
    assert.equal(downloadRunLines({ done: 1, failed: 0, left: 3, total: 4 }).detail, "3 left");
  });
});

/** [run] kept at a restart an hour in, as the kv-store gives it back. */
const restarted = (run: DownloadRun): DownloadRun =>
  restoredDownloadRun(keptDownloadRun(run), 3_600_000);

describe("Settings › Downloads: the run across a restart", () => {
  const mix = playlistDownloadOrigin({ id: 7, name: "Road trip" });
  const before = follow(
    [job("a", { origin: mix }), job("b", { origin: mix }), job("c"), job("d"), failed("old")],
    [done("a", { origin: mix }), done("b", { origin: mix }), failed("c"), job("d"), failed("old")],
  );

  test("keeps the songs done, per group, that the journal forgets at the restart", () => {
    // The journal drops the songs in the Library when it loads; the failures stay.
    const run = followDownloadRun(
      restarted(before),
      [failed("c"), job("d"), failed("old")],
      3_600_000,
    );
    assert.deepEqual(counts(run), { done: 2, failed: 1, left: 1, total: 4 });
    const { groups } = downloadRunProgress(run);
    assert.deepEqual(groups.get("playlist:7"), { done: 2, failed: 0, left: 0, total: 2 });
    assert.deepEqual(groups.get("songs"), { done: 0, failed: 1, left: 1, total: 2 });
  });

  test("the pace starts over at the restart", () => {
    const run = restarted(before);
    assert.equal(run.startedAt, 3_600_000);
    assert.deepEqual(run.finishes, []);
  });

  test("songs the journal still holds aren't counted twice", () => {
    const journal = [done("a", { origin: mix }), done("b", { origin: mix }), failed("c"), job("d")];
    const run = followDownloadRun(restarted(before), journal, 3_600_000);
    assert.deepEqual(counts(run), { done: 2, failed: 1, left: 1, total: 4 });
  });

  test("a restored run still resets once everything finishes", () => {
    const run = followDownloadRun(restarted(before), [failed("c"), done("d")], 3_600_000);
    assert.equal(counts(run), null);
    assert.equal(keptDownloadRun(run), null);
  });

  test("with no run kept, or anything else, there's no run", () => {
    assert.equal(keptDownloadRun(NO_DOWNLOAD_RUN), null);
    const stored = [null, "run", "5", "{}", '{"done":{"songs":"x"},"failed":{}}'];
    for (const kept of stored) assert.equal(counts(restoredDownloadRun(kept, 0)), null);
  });
});

/** A run of [total] songs started at 0, one more done each [every] ms until [until]. */
const steady = (total: number, every: number, until: number): DownloadRun => {
  const ids = Array.from({ length: total }, (_, index) => `s${index}`);
  let run = followDownloadRun(
    NO_DOWNLOAD_RUN,
    ids.map((id) => job(id)),
    0,
  );
  for (let at = every, finished = 1; at <= until; at += every, finished += 1) {
    run = followDownloadRun(
      run,
      ids.map((id, index) => (index < finished ? done(id) : job(id))),
      at,
    );
  }
  return run;
};

describe("Settings › Downloads: the run's time left", () => {
  test("the pace of the last minutes applied to what's left", () => {
    // A song a minute for 10 minutes: the 90 left take 90 minutes.
    const run = steady(100, 60_000, 600_000);
    assert.equal(downloadTimeLeft(run, { now: 600_000, paused: false }), 90 * 60_000);
  });

  test("only the last ~10 minutes count", () => {
    // Two songs a minute for 10 minutes, then none for 5: 10 finished in the last 10 minutes,
    // a song a minute, so the 80 left take 80 minutes.
    const run = steady(100, 30_000, 600_000);
    assert.equal(downloadTimeLeft(run, { now: 900_000, paused: false }), 80 * 60_000);
  });

  test("absent until enough songs have finished", () => {
    const two = steady(100, 60_000, 120_000);
    assert.equal(downloadTimeLeft(two, { now: 120_000, paused: false }), null);
    // Three songs in the first 30 seconds isn't a pace yet.
    const quick = steady(100, 10_000, 30_000);
    assert.equal(downloadTimeLeft(quick, { now: 30_000, paused: false }), null);
    assert.equal(downloadTimeLeft(NO_DOWNLOAD_RUN, { now: 0, paused: false }), null);
  });

  test("absent while paused: songs left, none downloading or saving", () => {
    const run = steady(100, 60_000, 600_000);
    assert.equal(downloadTimeLeft(run, { now: 600_000, paused: true }), null);
    assert.equal(downloadsPaused({ downloading: 0, saving: 0, waiting: 5 }), true);
    assert.equal(downloadsPaused({ downloading: 1, saving: 0, waiting: 5 }), false);
    assert.equal(downloadsPaused({ downloading: 0, saving: 3, waiting: 5 }), false);
    assert.equal(downloadsPaused({ downloading: 0, saving: 0, waiting: 0 }), false);
  });

  test("paused while YouTube is limiting downloads, even with songs held in their slots", () => {
    const held = { downloading: 5, saving: 0, waiting: 300 };
    assert.equal(downloadsPaused(held, { youtubePausedUntil: 5 * 60_000, now: 60_000 }), true);
    assert.equal(downloadsPaused(held, { youtubePausedUntil: 5 * 60_000, now: 5 * 60_000 }), false);
    assert.equal(downloadsPaused(held, { youtubePausedUntil: null, now: 60_000 }), false);
  });

  test("time left in words", () => {
    assert.equal(downloadTimeLeftLine(20_000), "Less than a minute left");
    assert.equal(downloadTimeLeftLine(15 * 60_000), "About 15 min left");
    assert.equal(downloadTimeLeftLine(84 * 60_000), "About 1 h 20 min left");
    assert.equal(downloadTimeLeftLine(118 * 60_000), "About 2 h left");
    assert.equal(downloadTimeLeftLine(7.6 * 3_600_000), "About 8 h left");
  });
});

/** A big run's panel line under its bar. */
const panelLine = (timeLeft: number | null, paused = false, throttled = false) =>
  downloadRunPanelLine(
    { done: 1234, failed: 12, left: 1254, total: 2500 },
    { timeLeft, paused, throttled },
  );

describe("Settings › Downloads: the run panel's lines", () => {
  test("what's left, then the time left once there's a pace", () => {
    assert.equal(panelLine(118 * 60_000), "12 failed · 1,254 left · About 2 h left");
    assert.equal(panelLine(null), "12 failed · 1,254 left");
  });

  test("Paused while nothing moves; nothing more while YouTube's pause says when it tries again", () => {
    assert.equal(panelLine(null, true), "12 failed · 1,254 left · Paused");
    assert.equal(panelLine(null, true, true), "12 failed · 1,254 left");
  });

  test("a group header's line: done of all, then what's left", () => {
    assert.equal(
      downloadRunGroupLine({ done: 40, failed: 2, left: 78, total: 120 }),
      "40 of 120 · 2 failed · 78 left",
    );
  });
});

describe("the download notification: the run", () => {
  test("a run of several songs shows done of all, failed, left and the time left", () => {
    assert.deepEqual(
      downloadRunNotice({ done: 1234, failed: 12, left: 1254, total: 2500 }, 118 * 60_000),
      {
        title: "Downloading 1,234 of 2,500",
        text: "12 failed · 1,254 left · About 2 h left",
        finished: 1246,
        total: 2500,
      },
    );
  });

  test("no time left until Core has an estimate, and no failed when none did", () => {
    assert.deepEqual(downloadRunNotice({ done: 3, failed: 0, left: 7, total: 10 }, null), {
      title: "Downloading 3 of 10",
      text: "7 left",
      finished: 3,
      total: 10,
    });
  });

  test("a one-song run, or none, keeps the per-song notification", () => {
    assert.equal(downloadRunNotice({ done: 0, failed: 0, left: 1, total: 1 }, 60_000), null);
    assert.equal(downloadRunNotice(null, null), null);
  });
});
