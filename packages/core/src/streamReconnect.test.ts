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
  });
  assert.deepEqual(
    streamReconnect(
      stopped.waiting,
      {
        type: "connection",
        online: true,
        key: "entry-a",
      },
      60_000,
    ),
    { waiting: null, resume: stopped.waiting },
  );
});

test("owner commands and a changed entry cancel the wait without a later resume", () => {
  const waiting = { key: "a", positionMs: 42_000, expiresAtMs: 600_000 };
  const cancelled = streamReconnect(waiting, { type: "cancel" }, 1_000);
  assert.deepEqual(cancelled, { waiting: null, resume: null });
  for (const key of ["b", null]) {
    assert.deepEqual(
      streamReconnect(waiting, { type: "connection", key, online: true }, 1_000),
      cancelled,
    );
  }
  assert.deepEqual(
    streamReconnect(cancelled.waiting, { type: "connection", key: "a", online: true }, 2_000),
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
  assert.deepEqual(streamReconnect(waiting, failure, 500_000), { waiting, resume: null });
  assert.deepEqual(streamReconnect(waiting, failure, 600_000), { waiting: null, resume: null });
});

test("a disconnected network holds the wait; ten minutes ends it even without a callback", () => {
  const waiting = { key: "a", positionMs: 0, expiresAtMs: 600_000 };
  assert.deepEqual(
    streamReconnect(waiting, { type: "connection", key: "a", online: false }, 30_000),
    { waiting, resume: null },
  );
  assert.deepEqual(streamReconnect(waiting, { type: "timeout" }, 599_999), {
    waiting,
    resume: null,
  });
  for (const now of [600_000, 600_001, 900_000]) {
    assert.deepEqual(
      streamReconnect(waiting, { type: "connection", key: "a", online: true }, now),
      { waiting: null, resume: null },
    );
    assert.deepEqual(streamReconnect(waiting, { type: "timeout" }, now), {
      waiting: null,
      resume: null,
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
    });
  }
});
