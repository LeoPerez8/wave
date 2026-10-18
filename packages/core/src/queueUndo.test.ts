import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { EMPTY_QUEUE, queueUndo, reduceQueue, undoneQueue } from "./index.ts";
import type { QueueCommand, QueueState } from "./index.ts";

const album = { kind: "album", id: "7" } as const;
const songs = { kind: "songs", id: null } as const;

const playAlbum: QueueCommand = { type: "play", trackIds: ["x", "y"], context: album };

/** The Songs list playing "b" of "a b c", with "q" added to the queue. */
const playing: QueueState = [
  { type: "play", trackIds: ["a", "b", "c"], startIndex: 1, context: songs },
  { type: "addToQueue", trackIds: ["q"] },
].reduce<QueueState>(
  (state, command) => reduceQueue(state, command as QueueCommand).state,
  EMPTY_QUEUE,
);

describe("queueUndo", () => {
  test("a play over a queue with a song current offers going back to it, where its song was", () => {
    assert.deepEqual(queueUndo(playing, playAlbum, 73_000), { state: playing, positionMs: 73_000 });
  });

  test("the first play offers nothing: there's no queue to go back to", () => {
    assert.equal(queueUndo(EMPTY_QUEUE, playAlbum, 0), null);
  });

  test("a play of nothing offers nothing: no new queue plays", () => {
    assert.equal(queueUndo(playing, { type: "play", trackIds: [], context: album }, 0), null);
  });

  test("only a play offers it, not changes to the same queue", () => {
    assert.equal(queueUndo(playing, { type: "next" }, 0), null);
    assert.equal(queueUndo(playing, { type: "playNext", trackIds: ["x"] }, 0), null);
  });
});

describe("undoneQueue", () => {
  test("goes back to the replaced queue as it was: its entries, keys, song and modes", () => {
    const replaced = { ...playing, shuffle: true, repeat: "all" } satisfies QueueState;
    const now = reduceQueue(replaced, playAlbum).state;
    const back = undoneQueue({ state: replaced, positionMs: 73_000 }, now);
    assert.deepEqual({ ...back, nextKey: 0 }, { ...replaced, nextKey: 0 });
  });

  test("keeps counting keys past the new queue's, so no entry added later reuses one", () => {
    // "a b c" took keys 1-3, "q" 4, the album's "x y" 5-6.
    const now = reduceQueue(playing, playAlbum).state;
    const back = undoneQueue({ state: playing, positionMs: 0 }, now);
    assert.equal(back.nextKey, 7);
    const added = reduceQueue(back, { type: "addToQueue", trackIds: ["z"] }).state;
    assert.equal(added.entries.find((entry) => entry.trackId === "z")?.key, "7");
  });
});
