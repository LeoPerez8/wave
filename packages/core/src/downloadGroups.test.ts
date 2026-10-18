import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { downloadingList } from "./index.ts";
import type { DownloadOrigin, YtDownloadJournalJob, YtSong } from "./index.ts";

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

const roadTrip: DownloadOrigin = { kind: "playlist", id: "7", name: "Road Trip" };
const focus: DownloadOrigin = { kind: "playlist", id: "9", name: "Focus" };
const mix: DownloadOrigin = { kind: "mix", id: "mix-1", name: "Discover Mix 1" };

/** Each group as [name, line, waiting ids]. */
const groupsOf = (jobs: readonly YtDownloadJournalJob[]) =>
  downloadingList(jobs).groups.map((group) => [
    group.name,
    group.line,
    group.queued.map((queued) => queued.id),
  ]);

describe("Settings › Downloads › Downloading: waiting songs grouped by where they were asked from", () => {
  test("two playlists' songs wait in two groups, each named after its playlist", () => {
    const jobs = [
      job("a", { origin: roadTrip }),
      job("b", { origin: roadTrip }),
      job("c", { origin: focus }),
      job("d", { origin: focus }),
    ];
    assert.deepEqual(groupsOf(jobs), [
      ["Road Trip", "2 songs left", ["a", "b"]],
      ["Focus", "2 songs left", ["c", "d"]],
    ]);
  });

  test("songs asked for on their own, and jobs from before sources, wait under Songs", () => {
    // A job queued before this update has no origin at all.
    const jobs = [job("old"), job("a", { origin: mix }), job("own", { origin: null })];
    assert.deepEqual(groupsOf(jobs), [
      ["Songs", "2 songs left", ["old", "own"]],
      ["Discover Mix 1", "1 song left", ["a"]],
    ]);
    assert.equal(downloadingList(jobs).groups[0]?.origin, null);
    assert.deepEqual(downloadingList(jobs).groups[1]?.origin, mix);
  });

  test("the songs downloading now stay at the top, outside the groups", () => {
    const jobs = [
      job("a", { origin: roadTrip, phase: "transferring", received: 42, total: 100 }),
      job("b", { origin: roadTrip }),
      job("c", { origin: focus, phase: "tagging" }),
    ];
    const list = downloadingList(jobs);
    assert.deepEqual(
      list.downloading.map((row) => [row.id, row.line]),
      [
        ["a", "Downloading · 42%"],
        ["c", "Saving to the Library"],
      ],
    );
    // A group counts its songs downloading too, and stays until its last one is done.
    assert.deepEqual(groupsOf(jobs), [
      ["Focus", "1 song left", []],
      ["Road Trip", "2 songs left", ["b"]],
    ]);
  });

  test("groups come in queue order: the one whose next song starts soonest first", () => {
    // The journal lists jobs in the order its queue starts them.
    const jobs = [
      job("f1", { origin: focus, phase: "preparing" }),
      job("r1", { origin: roadTrip }),
      job("f2", { origin: focus }),
      job("s1"),
      job("r2", { origin: roadTrip }),
    ];
    assert.deepEqual(groupsOf(jobs), [
      ["Road Trip", "2 songs left", ["r1", "r2"]],
      ["Focus", "2 songs left", ["f2"]],
      ["Songs", "1 song left", ["s1"]],
    ]);
  });

  test("a song both playlists asked for shows once, in the group of the first that asked", () => {
    // The journal keeps one job per recording, with the origin of its first request, and
    // adds a second playlist's own result for it as an alias.
    const jobs = [
      job("a", { origin: roadTrip }),
      job("shared", { origin: roadTrip, aliases: [song("shared-focus")] }),
      job("c", { origin: focus }),
    ];
    assert.deepEqual(groupsOf(jobs), [
      ["Road Trip", "2 songs left", ["a", "shared"]],
      ["Focus", "1 song left", ["c"]],
    ]);
  });

  test("the same playlist is one group, keyed by what it is rather than its name", () => {
    const renamed: DownloadOrigin = { ...roadTrip, name: "Road Trip 2026" };
    const album: DownloadOrigin = { kind: "album", id: "7", name: "Road Trip" };
    const groups = downloadingList([
      job("a", { origin: roadTrip }),
      job("b", { origin: renamed }),
      job("c", { origin: album }),
    ]).groups;
    assert.deepEqual(
      groups.map((group) => [group.name, group.queued.map((queued) => queued.id)]),
      [
        ["Road Trip", ["a", "b"]],
        ["Road Trip", ["c"]],
      ],
    );
    assert.equal(new Set(groups.map((group) => group.key)).size, 2);
  });

  test("a group is gone once its last song finishes, fails or is cancelled", () => {
    const jobs = [
      job("a", { origin: roadTrip, phase: "completed", acknowledged: true, saved: { path: "/a" } }),
      job("b", { origin: roadTrip, phase: "failed", reason: "offline" }),
      job("c", { origin: roadTrip, phase: "cancelled" }),
      job("d", { origin: focus }),
    ];
    assert.deepEqual(groupsOf(jobs), [["Focus", "1 song left", ["d"]]]);
    assert.deepEqual(downloadingList([]), { downloading: [], groups: [] });
  });
});
