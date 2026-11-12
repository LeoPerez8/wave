import assert from "node:assert/strict";
import { test } from "node:test";
import {
  EMPTY_QUEUE,
  continueMagicQueue,
  completeMagicRadioBatch,
  magicArtistKey,
  magicPickDue,
  parseMagicSession,
  queueContinuation,
  queueContinuationWaitMs,
  rankRadioSongs,
  reduceQueue,
  startMagicQueue,
  streamBufferMs,
  type QueueState,
} from "./index.ts";

const MINUTE = 60_000;

/** An album of [lengths] (minutes per song, null while unknown), playing song [index]. */
const album = (lengths: readonly (number | null)[], index = 0) => {
  const trackIds = lengths.map((_, i) => String(i + 1));
  const state = reduceQueue(EMPTY_QUEUE, {
    type: "play",
    trackIds,
    startIndex: index,
    context: { kind: "album", id: "7" },
  }).state;
  const durationMs = (trackId: string): number | null => {
    const minutes = lengths[Number(trackId) - 1] ?? null;
    return minutes === null ? null : minutes * MINUTE;
  };
  return { state, durationMs };
};

const ahead = (
  minutes: 1 | 2 | 5 | 10 | 15 | 30,
  positionMs: number,
  durationMs: (trackId: string) => number | null,
) => ({ ahead: { bufferMs: streamBufferMs(minutes), positionMs, durationMs } });

const SEED = { kind: "album", id: "7" } as const;

test("with Buffer at 5 minutes and 3-minute songs, the queue continues while its second-to-last song plays", () => {
  const { state, durationMs } = album([3, 3, 3, 3], 1);
  // 9 minutes left as the second song starts, 6 as the third does: neither is under 5.
  assert.equal(queueContinuation(state, ahead(5, 0, durationMs)), null);
  const third = reduceQueue(state, { type: "next" }).state;
  assert.equal(queueContinuation(third, ahead(5, 0, durationMs)), null);
  // One minute into the third song, exactly 5 minutes are left: not shorter yet.
  assert.equal(queueContinuation(third, ahead(5, MINUTE, durationMs)), null);
  assert.deepEqual(queueContinuation(third, ahead(5, MINUTE + 1, durationMs)), SEED);
});

test("with Buffer at 2 minutes, a queue ending in a longer song continues when that song starts", () => {
  const { state, durationMs } = album([3, 4], 0);
  assert.equal(queueContinuation(state, ahead(2, 3 * MINUTE - 1, durationMs)), null);
  const last = reduceQueue(state, { type: "next" }).state;
  assert.deepEqual(queueContinuation(last, ahead(2, 0, durationMs)), SEED);
});

test("with Buffer at 30 minutes, a shorter queue continues as soon as it plays", () => {
  const { state, durationMs } = album([3, 3, 3, 3, 3], 0);
  assert.deepEqual(queueContinuation(state, ahead(30, 0, durationMs)), SEED);
});

test("the last song starting continues the queue whatever the lengths are", () => {
  const long = album([3, 45], 1);
  assert.deepEqual(queueContinuation(long.state, ahead(1, 0, long.durationMs)), SEED);
  const unknown = album([3, null, 3], 0);
  assert.equal(queueContinuation(unknown.state, ahead(30, 0, unknown.durationMs)), null);
  const last = reduceQueue(reduceQueue(unknown.state, { type: "next" }).state, {
    type: "next",
  }).state;
  assert.deepEqual(queueContinuation(last, ahead(30, 0, unknown.durationMs)), SEED);
});

test("a seek near the end of the queue continues it at once, and a larger Buffer does too", () => {
  const { state, durationMs } = album([3, 3, 3, 3], 2);
  // 6 minutes left as the third song starts, 4 once a seek lands 2 minutes into it.
  assert.equal(queueContinuation(state, ahead(5, 0, durationMs)), null);
  assert.deepEqual(queueContinuation(state, ahead(5, 2 * MINUTE, durationMs)), SEED);
  assert.deepEqual(queueContinuation(state, ahead(10, 0, durationMs)), SEED);
});

test("loose songs continued ahead are seeded from the queue's last song", () => {
  const state = reduceQueue(EMPTY_QUEUE, {
    type: "play",
    trackIds: ["1", "2", "3"],
    context: { kind: "songs", id: null },
  }).state;
  assert.deepEqual(
    queueContinuation(
      state,
      ahead(30, 0, () => 3 * MINUTE),
    ),
    {
      kind: "track",
      id: "3",
    },
  );
});

test("repeat, a sleep timer, the switch and a Magic Queue under way hold a continuation ahead back too", () => {
  const { state, durationMs } = album([3, 3], 0);
  const early = ahead(30, 0, durationMs);
  assert.deepEqual(queueContinuation(state, early), SEED);
  assert.equal(queueContinuation({ ...state, repeat: "all" }, early), null);
  assert.equal(queueContinuation(state, { ...early, enabled: false }), null);
  assert.equal(queueContinuation(state, { ...early, sleepTimer: { type: "endOfQueue" } }), null);
  assert.equal(
    queueContinuation({ ...state, context: { kind: "magic", id: "session" } }, early),
    null,
  );
});

test("the wait until a queue continues is the time left beyond the Buffer", () => {
  const { state, durationMs } = album([3, 3, 3, 3], 0);
  const wait = (queue: QueueState, minutes: 2 | 5 | 30, positionMs: number) =>
    queueContinuationWaitMs(queue, ahead(minutes, positionMs, durationMs).ahead);
  // 12 minutes left: 7 until 5 are, 10 until 2 are.
  assert.equal(wait(state, 5, 0), 7 * MINUTE);
  assert.equal(wait(state, 2, 0), 10 * MINUTE);
  assert.equal(wait(state, 5, 90_000), 7 * MINUTE - 90_000);
  // Already under the Buffer: nothing to wait for.
  assert.equal(wait(state, 30, 0), 0);
  // The last song starting is handled by its own start, and an unknown length can't be timed.
  const last = reduceQueue(state, { type: "jumpTo", key: state.entries[3]!.key }).state;
  assert.equal(wait(last, 2, 0), null);
  const unknown = album([3, null], 0);
  assert.equal(queueContinuationWaitMs(unknown.state, ahead(2, 0, unknown.durationMs).ahead), null);
  assert.equal(wait({ ...state, repeat: "one" }, 5, 0), null);
});

test("a queue continued ahead gets its batch once, after the songs still to play", () => {
  const { state } = album([3, 3, 3, 3], 1);
  const song = (trackId: string) => ({
    trackId,
    artists: [magicArtistKey("Artist")],
    genre: null,
    style: null,
  });
  const started = startMagicQueue(
    { kind: "album", id: "7", title: "Album" },
    ["1", "2", "3", "4"].map(song),
    { id: "session", random: () => 0 },
  )!;
  const session = parseMagicSession(
    JSON.parse(JSON.stringify(continueMagicQueue(started.session, state))),
  )!;
  const continued = reduceQueue(state, {
    type: "continueMagicQueue",
    sessionId: session.id,
    from: state,
  }).state;
  // Two of the album's songs are still to play: the first batch doesn't wait for them.
  assert.equal(magicPickDue(session, null, continued), true);
  const candidates = rankRadioSongs(
    { artists: ["Artist"] },
    { pages: [], library: Array.from({ length: 30 }, (_, i) => song(String(i + 1))) },
  );
  const batch = completeMagicRadioBatch(session, candidates, []);
  assert.equal(batch.trackIds.length, 10);
  assert.equal(
    batch.trackIds.some((id) => Number(id) <= 4),
    false,
  );
  let queue = reduceQueue(continued, { type: "append", trackIds: batch.trackIds }).state;
  assert.deepEqual(
    queue.entries.map((entry) => entry.trackId),
    ["1", "2", "3", "4", ...batch.trackIds],
  );
  assert.equal(queue.index, 1);
  // Its batch in Up Next, the session waits like any other, through the album's last songs too.
  const early = ahead(30, 0, () => 3 * MINUTE);
  for (let i = 0; i < 3; i++) {
    assert.equal(magicPickDue(batch.session, null, queue), false);
    assert.equal(queueContinuation(queue, early), null);
    assert.equal(queueContinuationWaitMs(queue, early.ahead), null);
    queue = reduceQueue(queue, { type: "next" }).state;
  }
});
