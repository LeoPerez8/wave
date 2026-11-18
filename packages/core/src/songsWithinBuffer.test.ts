import assert from "node:assert/strict";
import { test } from "node:test";
import { EMPTY_QUEUE, reduceQueue, songsWithinBuffer, streamBufferMs } from "./index.ts";

const MINUTE = 60_000;

/** A queue of [lengths] (minutes per song, null while unknown), playing song [index]. */
const queue = (lengths: readonly (number | null)[], index = 0) => {
  const state = reduceQueue(EMPTY_QUEUE, {
    type: "play",
    trackIds: lengths.map((_, i) => String(i + 1)),
    startIndex: index,
    context: { kind: "album", id: "7" },
  }).state;
  const asked: string[] = [];
  const durationMs = (trackId: string): number | null => {
    asked.push(trackId);
    const minutes = lengths[Number(trackId) - 1] ?? null;
    return minutes === null ? null : minutes * MINUTE;
  };
  return { state, durationMs, asked };
};

const within = (
  minutes: 1 | 2 | 5 | 10 | 15 | 30,
  { state, durationMs }: ReturnType<typeof queue>,
) => songsWithinBuffer(state, { bufferMs: streamBufferMs(minutes), durationMs });

test("the Buffer reaches the songs after the current one until they play for as long as it", () => {
  // 3-minute songs: 2 minutes end inside the next one, 5 inside the second, 30 take ten.
  const songs = queue(
    Array.from({ length: 14 }, () => 3),
    1,
  );
  assert.deepEqual(within(2, songs), ["3"]);
  assert.deepEqual(within(5, songs), ["3", "4"]);
  assert.deepEqual(within(30, songs), ["3", "4", "5", "6", "7", "8", "9", "10", "11", "12"]);
});

test("a song that ends exactly at the Buffer is the last one it reaches", () => {
  assert.deepEqual(within(5, queue([3, 2, 3, 3])), ["2", "3"]);
  assert.deepEqual(within(2, queue([3, 2, 3, 3])), ["2"]);
});

test("the song playing isn't timed, and nothing follows the last song", () => {
  assert.deepEqual(within(2, queue([45, 3, 3])), ["2"]);
  assert.deepEqual(within(2, queue([null, 3, 3])), ["2"]);
  assert.deepEqual(within(30, queue([3, 3, 3], 2)), []);
  assert.deepEqual(
    songsWithinBuffer(EMPTY_QUEUE, { bufferMs: MINUTE, durationMs: () => MINUTE }),
    [],
  );
});

test("a queue shorter than the Buffer is reached whole", () => {
  assert.deepEqual(within(30, queue([3, 3, 3])), ["2", "3"]);
});

test("a song of unknown length is reached, and ends the reach", () => {
  // Nothing says how long it plays, so the songs after it wait until it is the next one.
  assert.deepEqual(within(30, queue([3, 3, null, 3, 3])), ["2", "3"]);
  assert.deepEqual(within(30, queue([3, 0, 3])), ["2"]);
});

test("a long queue is read only as far as the Buffer reaches", () => {
  const songs = queue(Array.from({ length: 5000 }, () => 3));
  assert.equal(within(5, songs).length, 2);
  assert.deepEqual(songs.asked, ["2", "3"]);
});
