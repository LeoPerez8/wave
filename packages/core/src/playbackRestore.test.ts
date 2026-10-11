import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { EMPTY_QUEUE, reduceQueue, restorePlayback, type QueueState } from "./index.ts";

const album = { kind: "album", id: "12" } as const;

/** Track ids in play order, the current one wrapped in brackets. */
const show = (state: QueueState): string =>
  state.entries
    .map((entry, i) => (i === state.index ? `[${entry.trackId}]` : entry.trackId))
    .join(" ");

const playing = (trackIds: string, startIndex: number): QueueState =>
  reduceQueue(EMPTY_QUEUE, {
    type: "play",
    trackIds: trackIds.split(" "),
    startIndex,
    context: album,
  }).state;

const all = (): boolean => true;
const except =
  (...gone: string[]) =>
  (trackId: string): boolean =>
    !gone.includes(trackId);

describe("restorePlayback", () => {
  test("picks the queue back up where it was, with shuffle and repeat", () => {
    const saved = reduceQueue(playing("a b c d", 1), { type: "setRepeat", mode: "all" }).state;
    const restored = restorePlayback(saved, 83_500, all);
    assert.equal(restored?.state, saved);
    assert.equal(restored?.positionMs, 83_500);
  });

  test("leaves out songs that left the library and keeps the place in the current one", () => {
    const restored = restorePlayback(playing("a b c d", 1), 83_500, except("a", "d"));
    assert.equal(restored === null ? null : show(restored.state), "[b] c");
    assert.equal(restored?.positionMs, 83_500);
  });

  test("starts the next song from the top when the current one left the library", () => {
    const restored = restorePlayback(playing("a b c d", 1), 83_500, except("b"));
    assert.equal(restored === null ? null : show(restored.state), "a [c] d");
    assert.equal(restored?.positionMs, 0);
  });

  test("falls back to the song before when nothing after the current one is left", () => {
    const restored = restorePlayback(playing("a b c d", 3), 83_500, except("c", "d"));
    assert.equal(restored === null ? null : show(restored.state), "a [b]");
    assert.equal(restored?.positionMs, 0);
  });

  test("keeps entry keys so new entries never reuse one", () => {
    const saved = playing("a b c", 0);
    const restored = restorePlayback(saved, 0, except("b"));
    assert.deepEqual(
      restored?.state.entries.map((entry) => entry.key),
      [saved.entries[0]!.key, saved.entries[2]!.key],
    );
    assert.equal(restored?.state.nextKey, saved.nextKey);
  });

  test("restores nothing when no song is left, or nothing was playing", () => {
    assert.equal(restorePlayback(playing("a b", 0), 1_000, except("a", "b")), null);
    assert.equal(restorePlayback(EMPTY_QUEUE, 0, all), null);
  });
});
