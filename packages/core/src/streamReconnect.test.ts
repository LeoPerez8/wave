import assert from "node:assert/strict";
import { test } from "node:test";
import { streamReconnect } from "./index.ts";

test("a stream cut off offline resumes the same entry and position when online", () => {
  const stopped = streamReconnect(
    null,
    {
      type: "failure",
      key: "entry-a",
      positionMs: 42_000,
      streamed: true,
      code: "ytOffline",
      playWhenReady: true,
    },
    1_000,
  );
  assert.deepEqual(stopped, {
    waiting: { key: "entry-a", positionMs: 42_000, expiresAtMs: 601_000 },
    resume: null,
    gaveUp: false,
  });
  assert.deepEqual(
    streamReconnect(
      stopped.waiting,
      {
        type: "connection",
        online: true,
        otherAudio: false,
        key: "entry-a",
      },
      60_000,
    ),
    { waiting: null, resume: stopped.waiting, gaveUp: false },
  );
});

test("owner commands and a changed entry cancel the wait without a later resume", () => {
  const waiting = { key: "a", positionMs: 42_000, expiresAtMs: 600_000 };
  const cancelled = streamReconnect(waiting, { type: "cancel" }, 1_000);
  assert.deepEqual(cancelled, { waiting: null, resume: null, gaveUp: false });
  for (const key of ["b", null]) {
    assert.deepEqual(
      streamReconnect(waiting, { type: "connection", key, online: true, otherAudio: false }, 1_000),
      cancelled,
    );
  }
  assert.deepEqual(
    streamReconnect(cancelled.waiting, { type: "connection", key: "a", online: true, otherAudio: false }, 2_000),
    cancelled,
  );
});

test("a retry that fails before playing keeps the first pause's deadline", () => {
  const waiting = { key: "a", positionMs: 42_000, expiresAtMs: 600_000 };
  const failure = {
    type: "failure",
    key: "a",
    positionMs: 42_000,
    streamed: true,
    code: "ytOffline",
    playWhenReady: true,
  } as const;
  assert.deepEqual(streamReconnect(waiting, failure, 500_000), {
    waiting,
    resume: null,
    gaveUp: false,
  });
  assert.deepEqual(streamReconnect(waiting, failure, 600_000), {
    waiting: null,
    resume: null,
    gaveUp: true,
  });
});

test("a disconnected network holds the wait; ten minutes ends it even without a callback", () => {
  const waiting = { key: "a", positionMs: 0, expiresAtMs: 600_000 };
  assert.deepEqual(
    streamReconnect(waiting, { type: "connection", key: "a", online: false, otherAudio: false }, 30_000),
    { waiting, resume: null, gaveUp: false },
  );
  assert.deepEqual(streamReconnect(waiting, { type: "timeout" }, 599_999), {
    waiting,
    resume: null,
    gaveUp: false,
  });
  for (const now of [600_000, 600_001, 900_000]) {
    assert.deepEqual(
      streamReconnect(waiting, { type: "connection", key: "a", online: true, otherAudio: false }, now),
      { waiting: null, resume: null, gaveUp: true },
    );
    assert.deepEqual(streamReconnect(waiting, { type: "timeout" }, now), {
      waiting: null,
      resume: null,
      gaveUp: true,
    });
  }
});

test("only an offline stream that was meant to play waits, including one that never started", () => {
  const failure = {
    type: "failure",
    key: "a",
    positionMs: 0,
    streamed: true,
    code: "ytOffline",
    playWhenReady: true,
  } as const;
  assert.equal(streamReconnect(null, failure, 0).waiting?.positionMs, 0);
  for (const change of [
    { streamed: false },
    { playWhenReady: false },
    { key: null },
    { code: "ytDisabled" },
    { code: "ytUnavailable" },
    { code: "ytFailed" },
    { code: null },
  ]) {
    assert.deepEqual(streamReconnect(null, { ...failure, ...change }, 0), {
      waiting: null,
      resume: null,
      gaveUp: false,
    });
  }
});

test("another app's audio when the network returns ends the wait without playing over it", () => {
  const waiting = { key: "a", positionMs: 42_000, expiresAtMs: 600_000 };
  assert.deepEqual(
    streamReconnect(
      waiting,
      { type: "connection", key: "a", online: true, otherAudio: true },
      30_000,
    ),
    { waiting: null, resume: null, gaveUp: true },
  );
  // Still offline, the other audio may be over by the time the network returns.
  assert.deepEqual(
    streamReconnect(
      waiting,
      { type: "connection", key: "a", online: false, otherAudio: true },
      30_000,
    ),
    { waiting, resume: null, gaveUp: false },
  );
});

test("losing the audio output during the wait ends it, so nothing plays from the speaker", () => {
  const waiting = { key: "a", positionMs: 42_000, expiresAtMs: 600_000 };
  const lost = streamReconnect(waiting, { type: "outputLost" }, 30_000);
  assert.deepEqual(lost, { waiting: null, resume: null, gaveUp: true });
  assert.deepEqual(
    streamReconnect(
      lost.waiting,
      { type: "connection", key: "a", online: true, otherAudio: false },
      31_000,
    ),
    { waiting: null, resume: null, gaveUp: false },
  );
  assert.equal(streamReconnect(null, { type: "outputLost" }, 30_000).gaveUp, false);
});

test("a wait gives up when nobody ended it: the owner's commands and a new song do not", () => {
  const waiting = { key: "a", positionMs: 0, expiresAtMs: 600_000 };
  assert.equal(streamReconnect(waiting, { type: "timeout" }, 600_000).gaveUp, true);
  assert.equal(streamReconnect(waiting, { type: "cancel" }, 600_000).gaveUp, false);
  assert.equal(
    streamReconnect(
      waiting,
      { type: "connection", key: "b", online: true, otherAudio: false },
      1_000,
    ).gaveUp,
    false,
  );
  // The retry's song turns out not to be served: the wait is over with nobody there.
  const failure = {
    type: "failure",
    key: "a",
    positionMs: 0,
    streamed: true,
    code: "ytUnavailable",
    playWhenReady: true,
  } as const;
  assert.deepEqual(streamReconnect(waiting, failure, 1_000), {
    waiting: null,
    resume: null,
    gaveUp: true,
  });
  assert.equal(streamReconnect(waiting, { ...failure, key: "b" }, 1_000).gaveUp, false);
  // An error that isn't a stream failure ends the retry the same way.
  assert.equal(streamReconnect(waiting, { ...failure, code: null }, 1_000).gaveUp, true);
});
