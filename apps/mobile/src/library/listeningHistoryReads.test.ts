import assert from "node:assert/strict";
import { test } from "node:test";

import type { ListeningHistoryPage, ListeningHistoryRow } from "./db/listeningHistory.ts";
import { listeningHistoryReads, type ListeningHistoryFrom } from "./listeningHistoryReads.ts";

const row = (id: number): ListeningHistoryRow => ({
  id,
  startedAt: id * 1000,
  snapshot: { title: `Song ${id}`, artist: "", album: null, artworkPath: null, thumbPath: null },
  videoId: null,
  recordingKey: null,
  streamedSong: null,
  song: null,
});

/** Reads that resolve when the test says so, in the order asked. */
const heldReads = () => {
  const asked: {
    readonly from: ListeningHistoryFrom;
    readonly resolve: (page: ListeningHistoryPage) => void;
  }[] = [];
  return {
    asked,
    readPage: (from: ListeningHistoryFrom) =>
      new Promise<ListeningHistoryPage>((resolve) => asked.push({ from, resolve })),
  };
};

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

test("a page asked for while a head read is going on is read once it ends", async () => {
  const { asked, readPage } = heldReads();
  const shown: ListeningHistoryPage[] = [];
  const reads = listeningHistoryReads({
    initial: { rows: [], next: null, newer: null },
    readPage,
    onPage: (page) => shown.push(page),
    onLoading: () => {},
    onError: () => {},
  });
  const cursor = { startedAt: 2000, id: 2 };
  reads.request("refresh");
  asked[0]!.resolve({ rows: [row(3), row(2)], next: cursor, newer: null });
  await settle();
  reads.request("head");
  reads.request("more");
  assert.equal(asked.length, 2);
  asked[1]!.resolve({ rows: [row(3), row(2)], next: cursor, newer: null });
  await settle();
  assert.equal(asked.length, 3);
  assert.deepEqual(asked[2]!.from, { before: cursor });
  asked[2]!.resolve({ rows: [row(1)], next: null, newer: null });
  await settle();
  assert.deepEqual(
    shown.at(-1)?.rows.map(({ id }) => id),
    [3, 2, 1],
  );
  reads.stop();
});

test("a moment opens around its play and reads newer pages above it as far as the newest", async () => {
  const { asked, readPage } = heldReads();
  const shown: ListeningHistoryPage[] = [];
  const reads = listeningHistoryReads({
    initial: { rows: [], next: null, newer: null },
    around: 5,
    readPage,
    onPage: (page) => shown.push(page),
    onLoading: () => {},
    onError: () => {},
  });
  const older = { startedAt: 4000, id: 4 };
  reads.request("refresh");
  assert.deepEqual(asked[0]!.from, { around: 5 });
  asked[0]!.resolve({ rows: [row(6), row(5), row(4)], next: older, newer: row(6) });
  await settle();
  // A new play doesn't join the top while plays between it and the moment aren't read.
  reads.request("head");
  await settle();
  assert.equal(asked.length, 1);
  reads.request("newer");
  assert.deepEqual(asked[1]!.from, { after: row(6) });
  asked[1]!.resolve({ rows: [row(8), row(7)], next: { startedAt: 6000, id: 7 }, newer: row(8) });
  await settle();
  assert.deepEqual(
    shown.at(-1)?.rows.map(({ id }) => id),
    [8, 7, 6, 5, 4],
  );
  assert.deepEqual(shown.at(-1)?.next, older);
  // A Library edit reads the same rows again, from the top one shown.
  reads.request("refresh");
  assert.deepEqual(asked[2]!.from, { before: { startedAt: 8000, id: 9 } });
  asked[2]!.resolve({ rows: [row(8), row(7), row(6)], next: row(6), newer: null });
  // The refresh yields a turn between pages.
  await settle();
  await settle();
  assert.deepEqual(asked[3]!.from, { before: row(6) });
  asked[3]!.resolve({ rows: [row(5), row(4)], next: older, newer: null });
  await settle();
  assert.deepEqual(shown.at(-1), {
    rows: [row(8), row(7), row(6), row(5), row(4)],
    next: older,
    newer: row(8),
  });
  reads.request("newer");
  asked[4]!.resolve({ rows: [row(9)], next: { startedAt: 8000, id: 9 }, newer: null });
  await settle();
  assert.equal(shown.at(-1)?.newer, null);
  // At the newest play, new plays join the top again.
  reads.request("head");
  assert.deepEqual(asked[5]!.from, { before: undefined });
  reads.stop();
});

test("newer pages asked for during another read are read once it ends, and not past the newest", async () => {
  const { asked, readPage } = heldReads();
  const reads = listeningHistoryReads({
    initial: { rows: [row(5)], next: null, newer: row(5) },
    around: 5,
    readPage,
    onPage: () => {},
    onLoading: () => {},
    onError: () => {},
  });
  reads.request("refresh");
  reads.request("newer");
  assert.equal(asked.length, 1);
  asked[0]!.resolve({ rows: [row(5)], next: null, newer: null });
  await settle();
  // The refresh kept the window's top, so the newer page asked meanwhile still reads.
  assert.deepEqual(asked[1]!.from, { after: row(5) });
  asked[1]!.resolve({ rows: [row(6)], next: row(5), newer: null });
  await settle();
  reads.request("newer");
  await settle();
  assert.equal(asked.length, 2);
  reads.stop();
});
