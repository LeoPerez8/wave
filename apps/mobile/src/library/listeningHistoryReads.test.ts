import assert from "node:assert/strict";
import { test } from "node:test";

import type {
  ListeningHistoryCursor,
  ListeningHistoryPage,
  ListeningHistoryRow,
} from "./db/listeningHistory.ts";
import { listeningHistoryReads } from "./listeningHistoryReads.ts";

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
    readonly before: ListeningHistoryCursor | undefined;
    readonly resolve: (page: ListeningHistoryPage) => void;
  }[] = [];
  return {
    asked,
    readPage: (before: ListeningHistoryCursor | undefined) =>
      new Promise<ListeningHistoryPage>((resolve) => asked.push({ before, resolve })),
  };
};

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

test("a page asked for while a head read is going on is read once it ends", async () => {
  const { asked, readPage } = heldReads();
  const shown: ListeningHistoryPage[] = [];
  const reads = listeningHistoryReads({
    initial: { rows: [], next: null },
    readPage,
    onPage: (page) => shown.push(page),
    onLoading: () => {},
    onError: () => {},
  });
  const cursor = { startedAt: 2000, id: 2 };
  reads.request("refresh");
  asked[0]!.resolve({ rows: [row(3), row(2)], next: cursor });
  await settle();
  reads.request("head");
  reads.request("more");
  assert.equal(asked.length, 2);
  asked[1]!.resolve({ rows: [row(3), row(2)], next: cursor });
  await settle();
  assert.equal(asked.length, 3);
  assert.deepEqual(asked[2]!.before, cursor);
  asked[2]!.resolve({ rows: [row(1)], next: null });
  await settle();
  assert.deepEqual(
    shown.at(-1)?.rows.map(({ id }) => id),
    [3, 2, 1],
  );
  reads.stop();
});
