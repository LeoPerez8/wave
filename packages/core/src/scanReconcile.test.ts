import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  SCAN_SAVE_SLICE,
  SCAN_SLICE_BUDGET_MS,
  SCAN_ANNOUNCE_MS,
  nextScanSaveSlice,
  reconcileScan,
  scanAnnounceDue,
  scanEnd,
  scanSaveSliceSteps,
  scanSaveSlices,
  scanTimingsLogLine,
  type IndexedFile,
} from "./index.ts";

const MUSIC = "/storage/emulated/0/Music";

const song = (path: string, overrides: Partial<IndexedFile> = {}): IndexedFile => ({
  path: `${MUSIC}/${path}`,
  sizeBytes: 4_812_345,
  durationMs: 215_000,
  title: "Teardrop",
  artist: "Massive Attack",
  ...overrides,
});

const paths = (files: readonly { readonly path: string }[]): string[] => files.map((f) => f.path);

describe("reconcileScan", () => {
  test("a renamed file is a move from its old path, so it keeps its history", () => {
    const changes = reconcileScan({
      missing: [song("Mezzanine/01.mp3")],
      read: [song("Mezzanine/01 Teardrop.mp3")],
      isIndexed: () => false,
    });
    assert.deepEqual(
      changes.moved.map((move) => [move.from, move.to.path]),
      [[`${MUSIC}/Mezzanine/01.mp3`, `${MUSIC}/Mezzanine/01 Teardrop.mp3`]],
    );
    assert.deepEqual(changes.added, []);
    assert.deepEqual(changes.unmatched, []);
  });

  test("a new file is added and a deleted one stays unmatched until the scan completes", () => {
    const changes = reconcileScan({
      missing: [song("Old/gone.mp3", { title: "Gone" })],
      read: [song("New/fresh.mp3", { title: "Fresh" })],
      isIndexed: () => false,
    });
    assert.deepEqual(paths(changes.added), [`${MUSIC}/New/fresh.mp3`]);
    assert.deepEqual(changes.moved, []);
    assert.deepEqual(paths(changes.unmatched), [`${MUSIC}/Old/gone.mp3`]);
  });

  test("a file changed in place is an update, even when it looks like a missing file", () => {
    const changes = reconcileScan({
      missing: [song("Copy A/01.mp3")],
      read: [song("Copy B/01.mp3")],
      isIndexed: (path) => path === `${MUSIC}/Copy B/01.mp3`,
    });
    assert.deepEqual(paths(changes.updated), [`${MUSIC}/Copy B/01.mp3`]);
    assert.deepEqual(changes.moved, []);
    assert.deepEqual(paths(changes.unmatched), [`${MUSIC}/Copy A/01.mp3`]);
  });

  test("a file of another size or length is a different song", () => {
    const changes = reconcileScan({
      missing: [song("a.mp3"), song("b.mp3")],
      read: [song("c.mp3", { sizeBytes: 4_812_346 }), song("d.mp3", { durationMs: 215_001 })],
      isIndexed: () => false,
    });
    assert.deepEqual(changes.moved, []);
    assert.equal(changes.added.length, 2);
  });

  test("a file retagged with another title or artist is a different song", () => {
    const changes = reconcileScan({
      missing: [song("a.mp3"), song("b.mp3")],
      read: [song("c.mp3", { title: "Angel" }), song("d.mp3", { artist: "Portishead" })],
      isIndexed: () => false,
    });
    assert.deepEqual(changes.moved, []);
  });

  test("title and artist match ignoring case, as the library groups artists", () => {
    const changes = reconcileScan({
      missing: [song("a.mp3", { title: "Déjà Vu", artist: "Beyoncé" })],
      read: [song("b.mp3", { title: "déjà vu", artist: "BEYONCÉ" })],
      isIndexed: () => false,
    });
    assert.deepEqual(
      changes.moved.map((move) => move.from),
      [`${MUSIC}/a.mp3`],
    );
  });

  test("each missing file is matched once when identical copies move", () => {
    const changes = reconcileScan({
      missing: [song("A/01.mp3"), song("B/01.mp3")],
      read: [song("C/01.mp3"), song("D/01.mp3"), song("E/01.mp3")],
      isIndexed: () => false,
    });
    assert.deepEqual(
      changes.moved.map((move) => [move.from, move.to.path]),
      [
        [`${MUSIC}/A/01.mp3`, `${MUSIC}/C/01.mp3`],
        [`${MUSIC}/B/01.mp3`, `${MUSIC}/D/01.mp3`],
      ],
    );
    assert.deepEqual(paths(changes.added), [`${MUSIC}/E/01.mp3`]);
    assert.deepEqual(changes.unmatched, []);
  });

  test("a later batch matches what earlier batches left unmatched", () => {
    const first = reconcileScan({
      missing: [song("Old/01.mp3"), song("Old/02.mp3", { title: "Angel" })],
      read: [song("New/01.mp3")],
      isIndexed: () => false,
    });
    const second = reconcileScan({
      missing: first.unmatched,
      read: [song("New/02.mp3", { title: "Angel" })],
      isIndexed: () => false,
    });
    assert.deepEqual(
      [...first.moved, ...second.moved].map((move) => move.from),
      [`${MUSIC}/Old/01.mp3`, `${MUSIC}/Old/02.mp3`],
    );
    assert.deepEqual(second.unmatched, []);
  });
});

describe("saving a scan batch in slices", () => {
  const changes = reconcileScan({
    missing: [song("Old/a.mp3", { title: "Moved A" }), song("Old/b.mp3", { title: "Moved B" })],
    read: [
      song("New/1.mp3", { title: "One" }),
      song("Kept/2.mp3", { title: "Two" }),
      song("New/a.mp3", { title: "Moved A" }),
      song("New/3.mp3", { title: "Three" }),
      song("New/b.mp3", { title: "Moved B" }),
    ],
    isIndexed: (path) => path.startsWith(`${MUSIC}/Kept/`),
  });

  test("each slice holds at most the size, and every file the batch saves, once", () => {
    const slices = scanSaveSlices(changes, 2);
    assert.deepEqual(
      slices.map((slice) => slice.tracks.map((track) => track.title)),
      [["One", "Three"], ["Two", "Moved A"], ["Moved B"]],
    );
  });

  test("a move goes in the slice that saves the file it moved to, in the batch's order", () => {
    const slices = scanSaveSlices(changes, 2);
    assert.deepEqual(
      slices.map((slice) => slice.moves),
      [
        [],
        [{ from: `${MUSIC}/Old/a.mp3`, to: `${MUSIC}/New/a.mp3` }],
        [{ from: `${MUSIC}/Old/b.mp3`, to: `${MUSIC}/New/b.mp3` }],
      ],
    );
  });

  test("a batch with nothing to save has no slices", () => {
    const none = reconcileScan({ missing: [], read: [], isIndexed: () => false });
    assert.deepEqual(scanSaveSlices(none, 100), []);
  });
});

describe("what a scan does once it ends", () => {
  // Playlists' entries are at revision 7, and the last link left them there.
  const quiet = {
    saved: 0,
    gone: 0,
    entriesRevision: 7,
    linkedRevision: 7,
    firstScan: false,
  };

  test("a rescan that found nothing new and nothing gone links nothing and tells no screen", () => {
    assert.deepEqual(scanEnd(quiet), { linkEntries: false, announce: null });
  });

  test("saved files are linked to playlists' streamed entries and shown as additions", () => {
    assert.deepEqual(scanEnd({ ...quiet, saved: 3 }), { linkEntries: true, announce: "added" });
  });

  test("entries that came since the last link (a sync, an import) are linked with no file saved", () => {
    assert.deepEqual(scanEnd({ ...quiet, entriesRevision: 9 }), {
      linkEntries: true,
      announce: null,
    });
  });

  test("entries no link has seen yet (none ran on this Library) are linked", () => {
    assert.deepEqual(scanEnd({ ...quiet, linkedRevision: null }), {
      linkEntries: true,
      announce: null,
    });
  });

  test("a folder's first scan that found nothing still tells the folder list it was scanned", () => {
    assert.deepEqual(scanEnd({ ...quiet, firstScan: true }), {
      linkEntries: false,
      announce: "scanned",
    });
  });

  test("a folder's first scan that saved songs is shown as additions, which the folder list follows", () => {
    assert.deepEqual(scanEnd({ ...quiet, saved: 2, firstScan: true }), {
      linkEntries: true,
      announce: "added",
    });
  });

  test("files gone are linked again and shown at once, everywhere", () => {
    assert.deepEqual(scanEnd({ ...quiet, gone: 2 }), { linkEntries: true, announce: "removed" });
    assert.deepEqual(scanEnd({ ...quiet, saved: 1, gone: 2 }), {
      linkEntries: true,
      announce: "removed",
    });
  });
});

describe("nextScanSaveSlice", () => {
  test("a slice that took four times the budget is followed by one a quarter its size", () => {
    assert.equal(nextScanSaveSlice({ files: 40, ms: SCAN_SLICE_BUDGET_MS * 4 }), 10);
  });
});

describe("nextScanSaveSlice when the phone is fast", () => {
  test("a quick slice is followed by one at most twice its size", () => {
    assert.equal(nextScanSaveSlice({ files: 10, ms: 1 }), 20);
  });

  test("a slice never grows past the fixed slice size", () => {
    assert.equal(nextScanSaveSlice({ files: 80, ms: 1 }), SCAN_SAVE_SLICE);
  });

  test("a slice that took no measurable time grows like a quick one", () => {
    assert.equal(nextScanSaveSlice({ files: 10, ms: 0 }), 20);
  });
});

describe("nextScanSaveSlice when each save costs the same however few files it holds", () => {
  test("a slice under the budget is followed by a bigger one, though halving it wouldn't halve its time", () => {
    // 17 ms of a transaction's own cost and 0.5 ms a file: one file's 17.5 ms fits the budget.
    assert.equal(nextScanSaveSlice({ files: 1, ms: 17.5 }), 2);
  });

  test("slices grow file by file to the budget, then keep within a file of it", () => {
    const fixedCost = (files: number) => 17 + files * 3;
    const sizes: number[] = [];
    let files = 1;
    for (let slice = 0; slice < 40; slice++) {
      files = nextScanSaveSlice({ files, ms: fixedCost(files) });
      sizes.push(files);
    }
    // 4 files take 29 ms, 5 take 32: no slice goes over the budget by more than a file's cost.
    assert.deepEqual(sizes.slice(0, 4), [2, 3, 4, 5]);
    assert.deepEqual([...new Set(sizes.slice(3))].sort(), [4, 5]);
  });
});

test("however slow one file is to save, the next slice still saves one", () => {
  assert.equal(nextScanSaveSlice({ files: 1, ms: 400 }), 1);
});

test("each slice's size is asked for once the slice before it was taken, so its timing can set it", () => {
  const changes = reconcileScan({
    missing: [],
    read: ["1", "2", "3", "4", "5", "6"].map((n) => song(`New/${n}.mp3`, { title: n })),
    isIndexed: () => false,
  });
  const sizes = [1, 3, 2];
  const taken: string[][] = [];
  for (const slice of scanSaveSliceSteps(changes, () => sizes[taken.length]!))
    taken.push(slice.tracks.map((track) => track.title));
  assert.deepEqual(taken, [["1"], ["2", "3", "4"], ["5", "6"]]);
});

describe("scanTimingsLogLine", () => {
  test("says how long the scan took and where its time went, without a path or a title", () => {
    assert.equal(
      scanTimingsLogLine({
        kind: "incremental",
        found: 3000,
        read: 200,
        saved: 200,
        batches: 2,
        ms: 41_250,
        savingMs: 1_830,
        longestSaveMs: 46,
        announcingMs: 420,
        longestAnnounceMs: 230,
        slice: 12,
      }),
      "Scan done (incremental): 3000 found, 200 read, 200 saved in 2 batches, 41.3 s; " +
        "saves 1.8 s (longest 46 ms, slice now 12), Library changes 0.4 s (longest 230 ms), " +
        "waiting 39.0 s",
    );
  });

  test("a scan that saved nothing says so", () => {
    assert.equal(
      scanTimingsLogLine({
        kind: "full",
        found: 0,
        read: 0,
        saved: 0,
        batches: 0,
        ms: 300,
        savingMs: 0,
        longestSaveMs: 0,
        announcingMs: 0,
        longestAnnounceMs: 0,
        slice: 25,
      }),
      "Scan done (full): 0 found, 0 read, 0 saved in 0 batches, 0.3 s; " +
        "saves 0.0 s (longest 0 ms, slice now 25), Library changes 0.0 s (longest 0 ms), " +
        "waiting 0.3 s",
    );
  });
});

describe("scanAnnounceDue", () => {
  test("a scan's first saved batch is announced at once", () => {
    assert.equal(scanAnnounceDue({ lastAt: undefined, now: 5 }), true);
  });

  test("a batch saved soon after an announcement waits for the next one", () => {
    assert.equal(scanAnnounceDue({ lastAt: 1000, now: 1000 + SCAN_ANNOUNCE_MS - 1 }), false);
  });

  test("a batch saved once the pause is over is announced, with the ones that waited", () => {
    assert.equal(scanAnnounceDue({ lastAt: 1000, now: 1000 + SCAN_ANNOUNCE_MS }), true);
  });
});
