import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  albumDownloadOrigin,
  applyJournalChanges,
  downloadingList,
  moveDownloadGroup,
  moveDownloadInGroup,
  moveQueuedJobs,
  playlistDownloadOrigin,
} from "./index.ts";
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

  test("a Library playlist or album asked from anywhere (its page, its menu, an import) is the same source", () => {
    const fromPage = playlistDownloadOrigin({ id: 7, name: "Road Trip" });
    const fromImport = playlistDownloadOrigin({ id: 7, name: "Road Trip" });
    assert.deepEqual(fromPage, roadTrip);
    assert.deepEqual(fromImport, fromPage);
    assert.deepEqual(albumDownloadOrigin({ id: 3, title: "Dummy" }), {
      kind: "album",
      id: "3",
      name: "Dummy",
    });
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

/** The journal's waiting jobs, in the order its queue starts them. */
const startOrder = (jobs: readonly YtDownloadJournalJob[]) =>
  jobs.filter((entry) => entry.phase === "queued").map((entry) => entry.id);

describe("Settings › Downloads › Downloading: dragging changes what downloads first", () => {
  test("dragging playlist B's header above A's makes B's songs start before A's", () => {
    const jobs = [
      job("a1", { origin: roadTrip }),
      job("a2", { origin: roadTrip }),
      job("b1", { origin: focus }),
      job("b2", { origin: focus }),
    ];
    const moved = moveQueuedJobs(jobs, moveDownloadGroup(downloadingList(jobs), 1, 0));
    assert.deepEqual(startOrder(moved), ["b1", "b2", "a1", "a2"]);
    assert.deepEqual(
      groupsOf(moved).map(([name]) => name),
      ["Focus", "Road Trip"],
    );
  });

  test("dragging a song to the top of its group makes it the next of that group to start", () => {
    // The two playlists' songs were asked for in turns.
    const jobs = [
      job("a1", { origin: roadTrip }),
      job("b1", { origin: focus }),
      job("a2", { origin: roadTrip }),
      job("b2", { origin: focus }),
      job("a3", { origin: roadTrip }),
    ];
    const [roadTripGroup] = downloadingList(jobs).groups;
    assert.ok(roadTripGroup !== undefined);
    const moved = moveQueuedJobs(jobs, moveDownloadInGroup(roadTripGroup, 2, 0));
    // Focus's songs keep their places.
    assert.deepEqual(startOrder(moved), ["a3", "b1", "a1", "b2", "a2"]);
    assert.deepEqual(groupsOf(moved), [
      ["Road Trip", "3 songs left", ["a3", "a1", "a2"]],
      ["Focus", "2 songs left", ["b1", "b2"]],
    ]);
  });

  test("a song can't be dropped into another group: past its group's end it stays last in it", () => {
    const jobs = [
      job("a1", { origin: roadTrip }),
      job("a2", { origin: roadTrip }),
      job("b1", { origin: focus }),
    ];
    const [roadTripGroup] = downloadingList(jobs).groups;
    assert.ok(roadTripGroup !== undefined);
    const moved = moveQueuedJobs(jobs, moveDownloadInGroup(roadTripGroup, 0, 5));
    assert.deepEqual(groupsOf(moved), [
      ["Road Trip", "2 songs left", ["a2", "a1"]],
      ["Focus", "1 song left", ["b1"]],
    ]);
  });

  test("a song that started while the drag was on keeps its place; the rest still move", () => {
    const jobs = [
      job("a1", { origin: roadTrip }),
      job("a2", { origin: roadTrip }),
      job("b1", { origin: focus }),
      job("b2", { origin: focus }),
    ];
    const order = moveDownloadGroup(downloadingList(jobs), 1, 0);
    const meanwhile = jobs.map((entry) =>
      entry.id === "a1" ? { ...entry, phase: "preparing" as const } : entry,
    );
    const moved = moveQueuedJobs(meanwhile, order);
    assert.deepEqual(
      moved.map((entry) => entry.id),
      ["a1", "b1", "b2", "a2"],
    );
    assert.deepEqual(
      downloadingList(moved).downloading.map((row) => row.id),
      ["a1"],
    );
  });
});

describe("Downloading groups while following the journal by its changes", () => {
  test("a job's source survives the changes it's followed by, so its group stays", () => {
    const first = applyJournalChanges([], {
      revision: 2,
      jobs: [job("a", { origin: roadTrip }), job("b", { origin: focus })],
      ids: ["a", "b"],
    });
    // Progress on "b" comes as that job alone, still carrying where it was asked from.
    const started = applyJournalChanges(first, {
      revision: 3,
      jobs: [job("b", { origin: focus, phase: "transferring", received: 10, total: 100 })],
      ids: null,
    });
    assert.deepEqual(groupsOf(started), [
      ["Focus", "1 song left", []],
      ["Road Trip", "1 song left", ["a"]],
    ]);
    // Another playlist's Retry Failed moves "a" to the end of the queue under its new source.
    const retried = applyJournalChanges(started, {
      revision: 4,
      jobs: [job("a", { origin: mix })],
      ids: ["b", "a"],
    });
    assert.deepEqual(groupsOf(retried), [
      ["Focus", "1 song left", []],
      ["Discover Mix 1", "1 song left", ["a"]],
    ]);
  });
});
