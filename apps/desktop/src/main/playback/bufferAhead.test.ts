import assert from "node:assert/strict";
import { test } from "node:test";
import { EMPTY_QUEUE, reduceQueue, ytTrackId } from "@wave/core";
import { streamedWithinBuffer } from "./bufferAhead.ts";

const THREE_MINUTES = 180_000;

const playing = (trackIds: readonly string[]) =>
  reduceQueue(EMPTY_QUEUE, {
    type: "play",
    trackIds: [...trackIds],
    startIndex: 0,
    context: { kind: "search", id: null },
  }).state;

const yt = (n: number) => ytTrackId(`video${String(n).padStart(6, "0")}`);
const videoId = (n: number) => `video${String(n).padStart(6, "0")}`;

test("the Buffer names the YT Music songs it reaches after the current one", () => {
  const state = playing(Array.from({ length: 14 }, (_, n) => yt(n)));
  const length = () => THREE_MINUTES;
  assert.deepEqual(streamedWithinBuffer(state, 2, length), [videoId(1)]);
  assert.deepEqual(streamedWithinBuffer(state, 5, length), [videoId(1), videoId(2)]);
  assert.equal(streamedWithinBuffer(state, 30, length).length, 10);
});

test("library files count for their time and aren't fetched", () => {
  const state = playing([yt(0), "7", yt(1), "8", yt(2), yt(3)]);
  assert.deepEqual(
    streamedWithinBuffer(state, 10, () => THREE_MINUTES),
    [videoId(1), videoId(2)],
  );
  assert.deepEqual(
    streamedWithinBuffer(playing(["7", "8"]), 30, () => THREE_MINUTES),
    [],
  );
});

test("a song twice within the Buffer is named once, and one of unknown length ends it", () => {
  const twice = playing([yt(0), yt(1), yt(1), yt(2)]);
  assert.deepEqual(
    streamedWithinBuffer(twice, 30, () => THREE_MINUTES),
    [videoId(1), videoId(2)],
  );
  const unknown = playing([yt(0), yt(1), yt(2), yt(3)]);
  assert.deepEqual(
    streamedWithinBuffer(unknown, 30, (trackId) => (trackId === yt(2) ? null : THREE_MINUTES)),
    [videoId(1), videoId(2)],
  );
});
