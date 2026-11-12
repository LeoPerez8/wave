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
  queueLengthsToRead,
  rankRadioSongs,
  reduceQueue,
  startMagicQueue,
  streamBufferMs,
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
  durationMs: (trackId: string) => number | null,
) => ({ ahead: { bufferMs: streamBufferMs(minutes), durationMs } });

const SEED = { kind: "album", id: "7" } as const;

test("with Buffer at 5 minutes and 3-minute songs, the queue continues as its second-to-last song starts", () => {
  const { state, durationMs } = album([3, 3, 3, 3], 1);
  // 6 minutes follow the second song: the time left stays over 5 for the whole of it.
  assert.equal(queueContinuation(state, ahead(5, durationMs)), null);
  // 3 minutes follow the third: the time left goes under 5 while it plays.
  const third = reduceQueue(state, { type: "next" }).state;
  assert.deepEqual(queueContinuation(third, ahead(5, durationMs)), SEED);
});

test("the song playing is not timed: only the songs after it are compared with the Buffer", () => {
  // Nothing asks where the song is, so a phone with its screen off decides the same at each song's start.
  const long = album([45, 4, 3], 0);
  assert.equal(queueContinuation(long.state, ahead(5, long.durationMs)), null);
  const short = album([45, 4], 0);
  assert.deepEqual(queueContinuation(short.state, ahead(5, short.durationMs)), SEED);
  // The playing song's own length may be unknown.
  const untimed = album([null, 4], 0);
  assert.deepEqual(queueContinuation(untimed.state, ahead(5, untimed.durationMs)), SEED);
  // Songs after it as long as the Buffer keep the time left from going under it.
  const exact = album([3, 2, 3], 0);
  assert.equal(queueContinuation(exact.state, ahead(5, exact.durationMs)), null);
});

test("with Buffer at 2 minutes, a queue ending in a longer song continues when that song starts", () => {
  const { state, durationMs } = album([3, 4], 0);
  assert.equal(queueContinuation(state, ahead(2, durationMs)), null);
  const last = reduceQueue(state, { type: "next" }).state;
  assert.deepEqual(queueContinuation(last, ahead(2, durationMs)), SEED);
});

test("with Buffer at 30 minutes, a shorter queue continues as soon as it plays", () => {
  const { state, durationMs } = album([3, 3, 3, 3, 3], 0);
  assert.deepEqual(queueContinuation(state, ahead(30, durationMs)), SEED);
});

test("the last song starting continues the queue whatever the lengths are", () => {
  const long = album([3, 45], 1);
  assert.deepEqual(queueContinuation(long.state, ahead(1, long.durationMs)), SEED);
  const unknown = album([3, null, 3], 0);
  assert.equal(queueContinuation(unknown.state, ahead(30, unknown.durationMs)), null);
  const last = reduceQueue(reduceQueue(unknown.state, { type: "next" }).state, {
    type: "next",
  }).state;
  assert.deepEqual(queueContinuation(last, ahead(30, unknown.durationMs)), SEED);
});

test("a larger Buffer continues the queue playing now", () => {
  const { state, durationMs } = album([3, 3, 3, 3], 1);
  assert.equal(queueContinuation(state, ahead(5, durationMs)), null);
  assert.deepEqual(queueContinuation(state, ahead(10, durationMs)), SEED);
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
      ahead(30, () => 3 * MINUTE),
    ),
    {
      kind: "track",
      id: "3",
    },
  );
});

test("repeat, a sleep timer, the switch and a Magic Queue under way hold a continuation ahead back too", () => {
  const { state, durationMs } = album([3, 3], 0);
  const early = ahead(30, durationMs);
  assert.deepEqual(queueContinuation(state, early), SEED);
  assert.equal(queueContinuation({ ...state, repeat: "all" }, early), null);
  assert.equal(queueContinuation(state, { ...early, enabled: false }), null);
  assert.equal(queueContinuation(state, { ...early, sleepTimer: { type: "endOfQueue" } }), null);
  assert.equal(
    queueContinuation({ ...state, context: { kind: "magic", id: "session" } }, early),
    null,
  );
});

test("a long queue is timed only as far as the Buffer reaches", () => {
  // Shuffle All on a big Library: 10,000 songs of 3 minutes, Buffer at 30 minutes.
  const { state } = album(
    Array.from({ length: 10_000 }, () => 3),
    0,
  );
  const asked: string[] = [];
  const durationMs = (trackId: string): number => {
    asked.push(trackId);
    return 3 * MINUTE;
  };
  assert.equal(queueContinuation(state, ahead(30, durationMs)), null);
  // The ten songs after the one playing make up the 30 minutes.
  assert.deepEqual(
    asked,
    Array.from({ length: 10 }, (_, i) => String(i + 2)),
  );
  // A length unknown past the Buffer's reach doesn't hold the decision either way.
  const far = album([3, 3, 3, null, 3], 0);
  assert.equal(queueContinuation(far.state, ahead(5, far.durationMs)), null);
  assert.deepEqual(queueLengthsToRead(far.state, ahead(5, far.durationMs).ahead), []);
});

test("the lengths to read start at the first unknown one the Buffer reaches, a few songs at a time", () => {
  const unread = album(
    Array.from({ length: 100 }, () => null),
    4,
  );
  const { ahead: time } = ahead(30, unread.durationMs);
  // The song playing is not timed; the songs after it are, 20 at a time.
  assert.deepEqual(
    queueLengthsToRead(unread.state, time),
    Array.from({ length: 20 }, (_, i) => String(i + 6)),
  );
  assert.deepEqual(queueLengthsToRead(unread.state, time, 3), ["6", "7", "8"]);
  // Known lengths short of the Buffer are passed over; the queue's end bounds the rest.
  const partly = album([3, 3, 3, null, null], 0);
  assert.deepEqual(queueLengthsToRead(partly.state, ahead(30, partly.durationMs).ahead), [
    "4",
    "5",
  ]);
  // Known lengths that fill the Buffer leave nothing to read, as does the last song playing.
  const known = album([3, 3, 3, null], 0);
  assert.deepEqual(queueLengthsToRead(known.state, ahead(5, known.durationMs).ahead), []);
  const last = album([3, null], 1);
  assert.deepEqual(queueLengthsToRead(last.state, ahead(30, last.durationMs).ahead), []);
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
  const early = ahead(30, () => 3 * MINUTE);
  for (let i = 0; i < 3; i++) {
    assert.equal(magicPickDue(batch.session, null, queue), false);
    assert.equal(queueContinuation(queue, early), null);
    queue = reduceQueue(queue, { type: "next" }).state;
  }
});
