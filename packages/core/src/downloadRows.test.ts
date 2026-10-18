import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { downloadGroupDrop, downloadingList, downloadListRows } from "./index.ts";
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

/** Each row as a short line: what it is, and its place among what it moves with. */
const rowsOf = (jobs: readonly YtDownloadJournalJob[]) =>
  downloadListRows(downloadingList(jobs)).map((row) => {
    if (row.kind === "downloading") return `downloading ${row.queued.id}`;
    if (row.kind === "header") return `header ${row.group.name} ${row.index}/${row.count}`;
    return `waiting ${row.queued.id} in ${row.groupKey} ${row.index}/${row.count}`;
  });

describe("Settings › Downloads › Downloading as one virtualized list's rows", () => {
  test("the songs downloading come first, then each group's header followed by its waiting songs", () => {
    const jobs = [
      job("now", { phase: "transferring", origin: roadTrip }),
      job("a", { origin: roadTrip }),
      job("b", { origin: roadTrip }),
      job("c", { origin: focus }),
    ];
    assert.deepEqual(rowsOf(jobs), [
      "downloading now",
      "header Road Trip 0/2",
      "waiting a in playlist:7 0/2",
      "waiting b in playlist:7 1/2",
      "header Focus 1/2",
      "waiting c in playlist:9 0/1",
    ]);
  });

  test("a group whose songs have all started has a header with no place to move, and no songs under it", () => {
    const jobs = [
      job("now", { phase: "transferring", origin: focus }),
      job("a", { origin: roadTrip }),
    ];
    assert.deepEqual(rowsOf(jobs), [
      "downloading now",
      "header Focus -1/0",
      "header Road Trip 0/1",
      "waiting a in playlist:7 0/1",
    ]);
  });

  test("every row's key is unique, and a song keeps its key while it waits", () => {
    const jobs = [job("a", { origin: roadTrip }), job("b", { origin: focus })];
    const keys = downloadListRows(downloadingList(jobs)).map((row) => row.key);
    assert.equal(new Set(keys).size, keys.length);
    const moved = downloadListRows(downloadingList([jobs[1]!, jobs[0]!])).map((row) => row.key);
    assert.deepEqual(moved.toSorted(), keys.toSorted());
  });
});

describe("Settings › Downloads: where a dragged group lands", () => {
  // Three groups 100, 300 and 50 dp tall: their edges sit at 0, 100, 400 and 450.
  const heights = [100, 300, 50];

  test("held near its own place, the first group stays first, its line at its own edge", () => {
    assert.deepEqual(downloadGroupDrop({ from: 0, at: 40, heights }), { to: 0, edge: 0 });
    assert.deepEqual(downloadGroupDrop({ from: 0, at: 130, heights }), { to: 0, edge: 100 });
  });

  test("carried past the middle of the next group, it lands after it", () => {
    assert.deepEqual(downloadGroupDrop({ from: 0, at: 300, heights }), { to: 1, edge: 400 });
    assert.deepEqual(downloadGroupDrop({ from: 0, at: 440, heights }), { to: 2, edge: 450 });
  });

  test("carried up from the last place, it lands before the group whose top edge is nearest", () => {
    assert.deepEqual(downloadGroupDrop({ from: 2, at: 10, heights }), { to: 0, edge: 0 });
    assert.deepEqual(downloadGroupDrop({ from: 2, at: 200, heights }), { to: 1, edge: 100 });
  });

  test("carried past either end of the list, it lands first or last", () => {
    assert.deepEqual(downloadGroupDrop({ from: 1, at: -500, heights }), { to: 0, edge: 0 });
    assert.deepEqual(downloadGroupDrop({ from: 1, at: 9000, heights }), { to: 2, edge: 450 });
  });
});
