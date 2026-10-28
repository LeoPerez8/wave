import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  addingProgress,
  clearImportProgress,
  importProgress,
  importProgressByPlaylist,
  importProgressFraction,
  importProgressLine,
  importRing,
  MATCHING_PROGRESS,
  NO_IMPORT_PROGRESS,
  NO_YT_LIBRARY_READS,
  planYtLibraryImport,
  queueYtLibraryReads,
  readingProgress,
  readYtLibraryBatch,
  setImportProgress,
  spotifyLibraryPicker,
  writeYtLibraryBatch,
  ytLibraryPicker,
  ytLibraryReadDone,
  ytLibraryReadFailed,
  type ImportProgress,
  type YtLibraryBatch,
  type YtLibraryRead,
} from "./index.ts";

/** Two playlists From YT Music queued: one the picker counted, one it didn't. */
const queued = queueYtLibraryReads(NO_YT_LIBRARY_READS, [
  {
    source: "PLroad",
    playlistId: 41,
    name: "Road trip",
    capped: true,
    favorites: false,
    expected: 1234,
  },
  { source: "spotify:playlist:abc", playlistId: 42, name: "Gym", capped: false, favorites: false },
]);

const keptAndRead = (batch: YtLibraryBatch): YtLibraryBatch =>
  readYtLibraryBatch(writeYtLibraryBatch(batch));

describe("the expected count kept with each queued playlist", () => {
  test("survives Wave starting again; a playlist with no count from its picker keeps none", () => {
    assert.deepEqual(
      keptAndRead(queued).reads.map((read) => [read.playlistId, read.expected]),
      [
        [41, 1234],
        [42, null],
      ],
    );
  });

  test("a playlist kept by a Wave from before the count has none", () => {
    const stored = JSON.stringify({
      version: 1,
      batch: [{ source: "PLold", playlistId: 7, name: "Old", capped: true, state: "waiting" }],
    });
    assert.equal(readYtLibraryBatch(stored).reads[0]?.expected, null);
  });
});

describe("the count a picker import queues", () => {
  test("each ticked playlist takes the count its picker row showed, none when it showed none", () => {
    const picker = ytLibraryPicker([
      { playlistId: "PLroad", title: "Road trip", artworkUrl: null, songCount: 1234, kind: "own" },
      { playlistId: "PLgym", title: "Gym", artworkUrl: null, songCount: null, kind: "saved" },
    ]);
    assert.deepEqual(
      planYtLibraryImport(picker, []).map((item) => [item.playlistId, item.expected]),
      [
        ["LM", null],
        ["PLroad", 1234],
        ["PLgym", null],
      ],
    );
  });

  test("From Spotify, only Liked Songs has a count", () => {
    const picker = spotifyLibraryPicker([
      { source: "spotify:collection", title: "Liked Songs", artworkUrl: null, songCount: 812 },
      { source: "spotify:playlist:abc", title: "Gym", artworkUrl: null, songCount: null },
    ]);
    assert.deepEqual(
      planYtLibraryImport(picker, []).map((item) => [item.playlistId, item.expected]),
      [
        ["spotify:collection", 812],
        ["spotify:playlist:abc", null],
      ],
    );
  });
});

const readOf = (batch: YtLibraryBatch, playlistId: number): YtLibraryRead => {
  const read = batch.reads.find((entry) => entry.playlistId === playlistId);
  assert.ok(read, `${playlistId} is in the batch`);
  return read;
};

/** [playlistId]'s line in [batch] with [board]'s live phases; null shows the live count. */
const lineOf = (batch: YtLibraryBatch, board = NO_IMPORT_PROGRESS, playlistId = 41) => {
  const progress = importProgress(batch, board, playlistId);
  return progress === null ? null : importProgressLine(progress);
};

/** [playlistId] read up to [done] songs, with [total] from its source. */
const reading = (playlistId: number, done: number, total: number | null = null) =>
  setImportProgress(
    NO_IMPORT_PROGRESS,
    playlistId,
    readingProgress(readOf(queued, playlistId), done, total),
  );

describe("an importing playlist's line", () => {
  test("waiting, it says so with the count its source gives", () => {
    assert.equal(lineOf(queued), "Waiting · 1,234 songs");
  });

  test("waiting with no count (a Spotify playlist), it says only Waiting", () => {
    assert.equal(lineOf(queued, NO_IMPORT_PROGRESS, 42), "Waiting");
  });

  test("a batch kept from before Wave started again shows the same Waiting line", () => {
    assert.equal(lineOf(keptAndRead(queued)), "Waiting · 1,234 songs");
  });

  test("reading, it counts the songs read against the expected count", () => {
    assert.equal(lineOf(queued, reading(41, 300)), "Reading 300 of 1,234");
  });

  test("reading, the source's own total wins over the picker's count", () => {
    assert.equal(lineOf(queued, reading(42, 500, 10_000), 42), "Reading 500 of 10,000");
  });

  test("reading with no total anywhere, it counts the songs read alone", () => {
    assert.equal(lineOf(queued, reading(42, 500), 42), "Reading 500");
  });

  test("a capped read counts up to the cap, not the source's whole count", () => {
    const capped = queueYtLibraryReads(NO_YT_LIBRARY_READS, [
      {
        source: "PLbig",
        playlistId: 9,
        name: "Big",
        capped: true,
        favorites: false,
        expected: 8000,
      },
    ]);
    assert.equal(
      importProgressLine(readingProgress(readOf(capped, 9), 100, null)),
      "Reading 100 of 5,000",
    );
  });

  test("a count gone stale never reads past itself", () => {
    assert.equal(
      importProgressLine(readingProgress(readOf(queued, 41), 1300, null)),
      "Reading 1,300 of 1,300",
    );
  });

  test("matching against the Library has no count", () => {
    const board = setImportProgress(NO_IMPORT_PROGRESS, 41, MATCHING_PROGRESS);
    assert.equal(lineOf(queued, board), "Matching with Library…");
  });

  test("adding, it counts the songs landed in the playlist", () => {
    const read = ytLibraryReadDone(queued, readOf(queued, 41));
    const board = setImportProgress(NO_IMPORT_PROGRESS, 41, addingProgress(340, 10_000));
    assert.equal(lineOf(read, board), "Adding 340 of 10,000");
  });

  test("Import & Download's playlist, filled and still in the batch, shows its adding line", () => {
    const downloading = queueYtLibraryReads(NO_YT_LIBRARY_READS, [
      { source: "PLx", playlistId: 5, name: "X", capped: true, favorites: false, download: true },
    ]);
    const filled = ytLibraryReadDone(downloading, readOf(downloading, 5));
    const board = setImportProgress(NO_IMPORT_PROGRESS, 5, addingProgress(100, 200));
    assert.equal(lineOf(filled, board, 5), "Adding 100 of 200");
    assert.equal(lineOf(filled, NO_IMPORT_PROGRESS, 5), null);
  });

  test("a link import, never in the batch, shows its adding line", () => {
    const board = setImportProgress(NO_IMPORT_PROGRESS, 77, addingProgress(100, 2451));
    assert.equal(lineOf(NO_YT_LIBRARY_READS, board, 77), "Adding 100 of 2,451");
  });

  test("done, there's no line: the live count is back", () => {
    const read = ytLibraryReadDone(queued, readOf(queued, 41));
    const board = setImportProgress(NO_IMPORT_PROGRESS, 41, addingProgress(1234, 1234));
    assert.equal(lineOf(read, clearImportProgress(board, 41)), null);
  });

  test("a failed read shows no progress: its page has Couldn't read it online", () => {
    const failed = ytLibraryReadFailed(queued, readOf(queued, 41), "failed").batch;
    assert.equal(lineOf(failed, reading(41, 300)), null);
  });

  test("a paused batch keeps the line it paused on", () => {
    const paused = ytLibraryReadFailed(queued, readOf(queued, 41), "offline").batch;
    assert.equal(lineOf(paused, reading(41, 300)), "Reading 300 of 1,234");
  });

  test("a refreshed playlist starts from Waiting", () => {
    const refreshed = queueYtLibraryReads(queued, [
      {
        source: "PLroad",
        playlistId: 41,
        name: "Road trip",
        capped: true,
        favorites: false,
        expected: 1240,
      },
    ]);
    assert.equal(
      lineOf(refreshed, clearImportProgress(reading(41, 300), 41)),
      "Waiting · 1,240 songs",
    );
  });

  test("one song is a song", () => {
    const one = queueYtLibraryReads(NO_YT_LIBRARY_READS, [
      { source: "PL1", playlistId: 1, name: "One", capped: true, favorites: false, expected: 1 },
    ]);
    assert.equal(lineOf(one, NO_IMPORT_PROGRESS, 1), "Waiting · 1 song");
  });
});

/** [progress]'s whole-import fraction. */
const fraction = (progress: ImportProgress | null): number => {
  assert.ok(progress);
  return importProgressFraction(progress);
};

describe("the whole import's fraction", () => {
  const read = readOf(queued, 41);

  test("waiting is empty", () => {
    assert.equal(fraction(importProgress(queued, NO_IMPORT_PROGRESS, 41)), 0);
  });

  test("reading fills the first half", () => {
    assert.equal(fraction(readingProgress(read, 617, null)), 0.25);
    assert.equal(fraction(readingProgress(read, 1234, null)), 0.5);
  });

  test("reading with no total stays empty", () => {
    assert.equal(fraction(readingProgress(readOf(queued, 42), 500, null)), 0);
  });

  test("matching holds at half", () => {
    assert.equal(fraction(MATCHING_PROGRESS), 0.5);
  });

  test("adding fills the second half", () => {
    assert.equal(fraction(addingProgress(0, 400)), 0.5);
    assert.equal(fraction(addingProgress(100, 400)), 0.625);
    assert.equal(fraction(addingProgress(400, 400)), 1);
  });

  test("adding nothing is whole", () => {
    assert.equal(fraction(addingProgress(0, 0)), 1);
  });
});

describe("every importing playlist's progress at once", () => {
  test("lists each playlist waiting or live, and none failed or done", () => {
    const failed = ytLibraryReadFailed(queued, readOf(queued, 42), "failed").batch;
    const board = setImportProgress(reading(41, 300), 77, addingProgress(1, 2));
    const all = importProgressByPlaylist(failed, board);
    assert.deepEqual(
      [...all].map(([id, progress]) => [id, importProgressLine(progress)]),
      [
        [41, "Reading 300 of 1,234"],
        [77, "Adding 1 of 2"],
      ],
    );
  });

  test("a playlist whose progress didn't change keeps the same entry", () => {
    const before = importProgressByPlaylist(queued, NO_IMPORT_PROGRESS);
    const after = importProgressByPlaylist(queued, reading(42, 500), before);
    assert.equal(after.get(41), before.get(41));
    assert.notEqual(after.get(42), before.get(42));
  });
});

describe("live progress never runs backwards", () => {
  test("a read started again after a pause keeps the furthest line until it passes it", () => {
    const read = readOf(queued, 41);
    const again = setImportProgress(reading(41, 600), 41, readingProgress(read, 100, null));
    assert.equal(lineOf(queued, again), "Reading 600 of 1,234");
    const past = setImportProgress(again, 41, readingProgress(read, 700, null));
    assert.equal(lineOf(queued, past), "Reading 700 of 1,234");
  });

  test("a step that changes nothing gives the same board", () => {
    const board = setImportProgress(NO_IMPORT_PROGRESS, 41, MATCHING_PROGRESS);
    assert.equal(setImportProgress(board, 41, MATCHING_PROGRESS), board);
    assert.equal(clearImportProgress(NO_IMPORT_PROGRESS, 41), NO_IMPORT_PROGRESS);
  });
});

describe("the cover's ring", () => {
  test("a playlist that isn't importing has none", () => {
    assert.equal(importRing(null), null);
    assert.equal(importRing(importProgress(queued, NO_IMPORT_PROGRESS, 99)), null);
  });

  test("waiting shows it empty and still", () => {
    assert.deepEqual(importRing(importProgress(queued, NO_IMPORT_PROGRESS, 41)), {
      fraction: 0,
      pulses: false,
    });
  });

  test("reading fills it, and a read paused offline holds it still where it stopped", () => {
    const paused = importProgress(queued, reading(41, 617), 41);
    assert.deepEqual(importRing(paused), { fraction: 0.25, pulses: false });
  });

  test("matching holds it at half and pulses", () => {
    assert.deepEqual(importRing(MATCHING_PROGRESS), { fraction: 0.5, pulses: true });
  });

  test("adding fills the rest", () => {
    assert.deepEqual(importRing(addingProgress(300, 400)), { fraction: 0.875, pulses: false });
    assert.deepEqual(importRing(addingProgress(400, 400)), { fraction: 1, pulses: false });
  });
});
