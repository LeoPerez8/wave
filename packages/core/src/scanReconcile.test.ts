import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { reconcileScan, scanEnd, scanSaveSlices, type IndexedFile } from "./index.ts";

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
  const quiet = { saved: 0, gone: 0, entriesChanged: false };

  test("a rescan that found nothing new and nothing gone links nothing and tells no screen", () => {
    assert.deepEqual(scanEnd(quiet), { linkEntries: false, announce: null });
  });

  test("saved files are linked to playlists' streamed entries and shown as additions", () => {
    assert.deepEqual(scanEnd({ ...quiet, saved: 3 }), { linkEntries: true, announce: "added" });
  });

  test("entries that came since the last link (a sync, an import) are linked with no file saved", () => {
    assert.deepEqual(scanEnd({ ...quiet, entriesChanged: true }), {
      linkEntries: true,
      announce: null,
    });
  });

  test("files gone are shown at once, everywhere", () => {
    assert.deepEqual(scanEnd({ ...quiet, gone: 2 }), { linkEntries: false, announce: "removed" });
    assert.deepEqual(scanEnd({ ...quiet, saved: 1, gone: 2 }), {
      linkEntries: true,
      announce: "removed",
    });
  });
});
