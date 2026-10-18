import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { dropDownload, downloadingList, downloadListRows, movableGroups } from "./index.ts";
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
    if (row.kind === "startedHeader") return `started ${row.group.name}`;
    if (row.kind === "header") return `header ${row.group.name} ${row.index}/${row.count}`;
    return `waiting ${row.queued.id} in ${row.groupKey} (group ${row.groupIndex}) ${row.index}/${row.count}`;
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
      "waiting a in playlist:7 (group 0) 0/2",
      "waiting b in playlist:7 (group 0) 1/2",
      "header Focus 1/2",
      "waiting c in playlist:9 (group 1) 0/1",
    ]);
  });

  test("a group whose songs have all started has a header of its own kind, with no songs under it", () => {
    const jobs = [
      job("now", { phase: "transferring", origin: focus }),
      job("a", { origin: roadTrip }),
    ];
    assert.deepEqual(rowsOf(jobs), [
      "downloading now",
      "started Focus",
      "header Road Trip 0/1",
      "waiting a in playlist:7 (group 0) 0/1",
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

describe("Settings › Downloads: what a drag or a Move up / Move down drops", () => {
  const jobs = [
    job("now", { phase: "transferring", origin: focus }),
    job("a", { origin: roadTrip }),
    job("b", { origin: roadTrip }),
    job("c", { origin: roadTrip }),
    job("d"),
  ];
  const list = downloadingList(jobs);

  test("only the groups with waiting songs move, among themselves", () => {
    assert.deepEqual(
      movableGroups(list).map((group) => group.key),
      ["playlist:7", "songs"],
    );
  });

  test("a song dropped on another of its group's songs takes its place there", () => {
    assert.deepEqual(
      dropDownload(list, { kind: "song", groupKey: "playlist:7", from: "a", to: "c" }),
      ["b", "c", "a"],
    );
  });

  test("a group dropped on another moving group takes its place", () => {
    assert.deepEqual(dropDownload(list, { kind: "group", from: "songs", to: "playlist:7" }), [
      "d",
      "a",
      "b",
      "c",
    ]);
  });

  test("nothing moves when it's dropped where it was, or what it names left the list meanwhile", () => {
    const song = (groupKey: string, from: string, to: string) =>
      dropDownload(list, { kind: "song", groupKey, from, to });
    assert.equal(song("playlist:7", "b", "b"), null);
    // "now" started: it's no waiting song any more.
    assert.equal(song("playlist:7", "now", "a"), null);
    assert.equal(song("playlist:9", "a", "b"), null);
    // Focus's songs have all started: it doesn't move.
    assert.equal(dropDownload(list, { kind: "group", from: "playlist:9", to: "songs" }), null);
  });
});
