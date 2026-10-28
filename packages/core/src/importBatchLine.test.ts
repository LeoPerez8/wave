import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  addingProgress,
  endYtLibraryRun,
  importBatchLine,
  MATCHING_PROGRESS,
  NO_IMPORT_PROGRESS,
  NO_YT_LIBRARY_READS,
  pruneYtLibraryBatch,
  queueYtLibraryReads,
  readingProgress,
  readYtLibraryBatch,
  setImportProgress,
  writeYtLibraryBatch,
  ytLibraryReadDone,
  ytLibraryReadFailed,
  type ImportProgressBoard,
  type YtLibraryBatch,
  type YtLibraryRead,
} from "./index.ts";

/** A playlist From YT Music, queued as [playlistId]. */
const toQueue = (playlistId: number, download = false) => ({
  source: `PL${playlistId}`,
  playlistId,
  name: `Playlist ${playlistId}`,
  capped: true,
  favorites: false,
  download,
  expected: 100,
});

/** An Import of the playlists [ids], on [batch]. */
const imported = (batch: YtLibraryBatch, ids: readonly number[]): YtLibraryBatch =>
  queueYtLibraryReads(
    batch,
    ids.map((id) => toQueue(id)),
  );

const readOf = (batch: YtLibraryBatch, playlistId: number): YtLibraryRead => {
  const read = batch.reads.find((queued) => queued.playlistId === playlistId);
  if (read === undefined) throw new Error(`${playlistId} isn't in the batch`);
  return read;
};

/** [batch] once [playlistId]'s read is done: it leaves the batch, its songs being added. */
const readDone = (batch: YtLibraryBatch, playlistId: number): YtLibraryBatch =>
  ytLibraryReadDone(batch, readOf(batch, playlistId));

/** [batch] once [playlistId]'s read failed for [reason]. */
const readFailed = (batch: YtLibraryBatch, playlistId: number, reason = "refused") =>
  ytLibraryReadFailed(batch, readOf(batch, playlistId), reason).batch;

const board = (...entries: [number, Parameters<typeof setImportProgress>[2]][]) =>
  entries.reduce<ImportProgressBoard>(
    (current, [id, progress]) => setImportProgress(current, id, progress),
    NO_IMPORT_PROGRESS,
  );

const lineText = (
  batch: YtLibraryBatch,
  live = NO_IMPORT_PROGRESS,
  pausedBy: string | null = null,
) => importBatchLine(batch, live, pausedBy)?.text ?? null;

const eighty = Array.from({ length: 80 }, (_, index) => index + 1);

describe("the line at the top of Playlists while a batch imports", () => {
  test("counts the batch's playlists done of all it has, with a spinner", () => {
    const batch = imported(NO_YT_LIBRARY_READS, eighty);
    assert.deepEqual(importBatchLine(batch, NO_IMPORT_PROGRESS, null), {
      text: "Importing playlists · 0 of 80",
      done: 0,
      total: 80,
      paused: false,
    });
  });

  test("a playlist read and filled counts as done", () => {
    let batch = imported(NO_YT_LIBRARY_READS, eighty);
    for (const id of eighty.slice(0, 12)) batch = readDone(batch, id);
    assert.equal(lineText(batch), "Importing playlists · 12 of 80");
  });

  test("a playlist still being read, matched or added isn't done yet", () => {
    let batch = imported(NO_YT_LIBRARY_READS, [1, 2, 3, 4]);
    batch = readDone(batch, 1);
    batch = readDone(batch, 2);
    const live = board(
      [2, addingProgress(340, 10000)],
      [3, readingProgress(readOf(batch, 3), 50, null)],
    );
    assert.equal(lineText(batch, live), "Importing playlists · 1 of 4");
    assert.equal(lineText(batch, board([2, MATCHING_PROGRESS])), "Importing playlists · 1 of 4");
  });

  test("a playlist whose read failed counts as done: its own page has Try Again", () => {
    let batch = imported(NO_YT_LIBRARY_READS, [1, 2, 3]);
    batch = readFailed(batch, 1);
    assert.equal(lineText(batch), "Importing playlists · 1 of 3");
  });

  test("a failed playlist read again by Try Again still counts as done", () => {
    let batch = imported(NO_YT_LIBRARY_READS, [1, 2, 3]);
    batch = readFailed(batch, 1);
    const live = board([1, readingProgress(readOf(batch, 1), 10, null)]);
    assert.equal(lineText(batch, live), "Importing playlists · 1 of 3");
  });

  test("an Import & Download playlist filled, its downloads still to queue, counts as done", () => {
    let batch = queueYtLibraryReads(NO_YT_LIBRARY_READS, [toQueue(1, true), toQueue(2, true)]);
    batch = readDone(batch, 1);
    assert.equal(lineText(batch), "Importing playlists · 1 of 2");
  });

  test("counts in thousands as the other lines do", () => {
    const ids = Array.from({ length: 1200 }, (_, index) => index + 1);
    assert.equal(lineText(imported(NO_YT_LIBRARY_READS, ids)), "Importing playlists · 0 of 1,200");
  });
});

describe("the line going away", () => {
  test("isn't shown with nothing imported", () => {
    assert.equal(importBatchLine(NO_YT_LIBRARY_READS, NO_IMPORT_PROGRESS, null), null);
  });

  test("goes once every playlist is done", () => {
    let batch = imported(NO_YT_LIBRARY_READS, [1, 2]);
    batch = readDone(batch, 1);
    batch = readDone(batch, 2);
    assert.equal(
      lineText(batch, board([2, addingProgress(10, 100)])),
      "Importing playlists · 1 of 2",
    );
    assert.equal(lineText(batch), null);
  });

  test("goes when the playlists left all failed", () => {
    let batch = imported(NO_YT_LIBRARY_READS, [1, 2]);
    batch = readDone(batch, 1);
    batch = readFailed(batch, 2);
    assert.equal(lineText(batch), null);
  });

  test("isn't shown for a From a Link import, which never joins the batch", () => {
    assert.equal(lineText(NO_YT_LIBRARY_READS, board([9, addingProgress(0, 300)])), null);
  });

  test("once the batch's run ends, Try Again on a failed playlist doesn't bring it back", () => {
    let batch = imported(NO_YT_LIBRARY_READS, [1, 2]);
    batch = readFailed(batch, 1);
    batch = readDone(batch, 2);
    batch = endYtLibraryRun(batch);
    // Try Again's read answered: the playlist leaves the batch and its songs are added.
    batch = readDone(batch, 1);
    assert.equal(lineText(batch, board([1, addingProgress(0, 100)])), null);
  });
});

describe("a batch's run", () => {
  test("a later Import while playlists still wait adds its playlists to the same count", () => {
    let batch = imported(NO_YT_LIBRARY_READS, [1, 2, 3]);
    batch = readDone(batch, 1);
    batch = imported(batch, [4, 5]);
    assert.equal(lineText(batch), "Importing playlists · 1 of 5");
  });

  test("an Import once the last one was done starts a new count", () => {
    let batch = imported(NO_YT_LIBRARY_READS, [1, 2]);
    batch = readDone(batch, 1);
    batch = readDone(batch, 2);
    batch = imported(batch, [3, 4, 5]);
    assert.equal(lineText(batch), "Importing playlists · 0 of 3");
  });

  test("a playlist refreshed while it still waits counts once", () => {
    let batch = imported(NO_YT_LIBRARY_READS, [1, 2, 3]);
    batch = imported(batch, [2]);
    assert.equal(lineText(batch), "Importing playlists · 0 of 3");
  });

  test("a playlist refreshed after it was done is to do again", () => {
    let batch = imported(NO_YT_LIBRARY_READS, [1, 2, 3]);
    batch = readDone(batch, 1);
    batch = imported(batch, [1]);
    assert.equal(lineText(batch), "Importing playlists · 0 of 3");
  });

  test("a playlist deleted meanwhile counts as done", () => {
    let batch = imported(NO_YT_LIBRARY_READS, [1, 2, 3]);
    batch = pruneYtLibraryBatch(batch, [1, 3]);
    assert.equal(lineText(batch), "Importing playlists · 1 of 3");
  });

  test("ending it while playlists still wait changes nothing", () => {
    const batch = imported(NO_YT_LIBRARY_READS, [1, 2]);
    assert.equal(endYtLibraryRun(batch), batch);
  });

  test("ending it with nothing waiting forgets the count; ending it again gives the same batch", () => {
    let batch = imported(NO_YT_LIBRARY_READS, [1, 2]);
    batch = readFailed(batch, 1);
    batch = readDone(batch, 2);
    const ended = endYtLibraryRun(batch);
    assert.deepEqual(ended.run, []);
    assert.deepEqual(ended.reads, batch.reads);
    assert.equal(endYtLibraryRun(ended), ended);
  });

  test("survives Wave starting again", () => {
    let batch = imported(NO_YT_LIBRARY_READS, [1, 2, 3]);
    batch = readDone(batch, 1);
    const kept = readYtLibraryBatch(writeYtLibraryBatch(batch));
    assert.equal(lineText(kept), "Importing playlists · 1 of 3");
  });

  test("a batch kept by a Wave from before the count counts the playlists it kept", () => {
    const stored = JSON.stringify({
      version: 1,
      batch: [
        { source: "PL1", playlistId: 1, name: "One", capped: true, state: "waiting" },
        { source: "PL2", playlistId: 2, name: "Two", capped: true, state: "failed" },
      ],
    });
    assert.equal(lineText(readYtLibraryBatch(stored)), "Importing playlists · 1 of 2");
  });
});

describe("a paused batch", () => {
  const waiting = readDone(imported(NO_YT_LIBRARY_READS, [1, 2, 3]), 1);

  test("says it's paused and why, without a spinner", () => {
    assert.deepEqual(importBatchLine(waiting, NO_IMPORT_PROGRESS, "offline"), {
      text: "Import paused · offline",
      done: 1,
      total: 3,
      paused: true,
    });
  });

  test("names YT Music turned off, and Spotify signed out", () => {
    assert.equal(lineText(waiting, NO_IMPORT_PROGRESS, "disabled"), "Import paused · YT Music off");
    assert.equal(
      lineText(waiting, NO_IMPORT_PROGRESS, "signedOut"),
      "Import paused · signed out of Spotify",
    );
  });

  test("counts again once it goes on", () => {
    assert.equal(lineText(waiting, NO_IMPORT_PROGRESS, null), "Importing playlists · 1 of 3");
  });

  test("a pause with nothing left waiting doesn't show", () => {
    let batch = imported(NO_YT_LIBRARY_READS, [1]);
    batch = readDone(batch, 1);
    assert.equal(lineText(batch, NO_IMPORT_PROGRESS, "offline"), null);
  });
});
