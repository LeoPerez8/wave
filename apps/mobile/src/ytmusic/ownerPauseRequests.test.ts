import assert from "node:assert/strict";
import { test } from "node:test";

import { createOwnerPauseRequests, type OwnerPauseNative } from "./ownerPauseRequests.ts";

/** A native side that records its calls and answers each one when the test says so. */
const fakeNative = () => {
  const calls: string[] = [];
  const answers: (() => void)[] = [];
  const call = (name: string) => (): Promise<void> => {
    calls.push(name);
    return new Promise((resolve) => answers.push(resolve));
  };
  const native: OwnerPauseNative = {
    pauseAll: call("pauseAll"),
    resumeAll: call("resumeAll"),
    pauseGroup: (key) => call(`pauseGroup ${key}`)(),
    resumeGroup: (key) => call(`resumeGroup ${key}`)(),
  };
  /** Answers every call made so far, and lets what follows run. */
  const answer = async (): Promise<void> => {
    for (let round = 0; round < 10; round += 1) {
      while (answers.length > 0) answers.shift()?.();
      await new Promise((resolve) => setImmediate(resolve));
    }
  };
  return { native, calls, answer };
};

/** The shared request chain, held by a request queued earlier until [release]. */
const heldQueue = () => {
  let release = (): void => undefined;
  let chain: Promise<void> = new Promise((resolve) => (release = resolve));
  const queue = (work: () => Promise<void>): void => {
    chain = chain.then(work).catch(() => undefined);
  };
  return { queue, release: () => release() };
};

const setUp = () => {
  const native = fakeNative();
  const held = heldQueue();
  let landed = 0;
  const pauses = createOwnerPauseRequests({
    native: native.native,
    queue: held.queue,
    landed: async () => {
      landed += 1;
    },
  });
  return { ...native, ...held, pauses, landed: () => landed };
};

test("Pause reaches the journal at once, whatever the request chain still waits on", async () => {
  const { pauses, calls, answer } = setUp();
  pauses.pauseAll();
  await answer();
  assert.deepEqual(calls, ["pauseAll"]);
});

test("the rows keep the owner's value until the journal took it, then read it again", async () => {
  const { pauses, answer, landed } = setUp();
  pauses.pauseGroup("playlist:12");
  assert.equal(pauses.pending(), true);
  await answer();
  assert.equal(pauses.pending(), false);
  assert.equal(landed(), 1);
});

test("Pause again holds the songs asked for before it that reached the journal after it", async () => {
  const { pauses, calls, answer, release } = setUp();
  pauses.pauseAll();
  await answer();
  release();
  await answer();
  assert.deepEqual(calls, ["pauseAll", "pauseAll"]);
});

test("a Resume before the chain got there stops the earlier Pause from coming back", async () => {
  const { pauses, calls, answer, release } = setUp();
  pauses.pauseAll();
  pauses.resumeAll();
  await answer();
  release();
  await answer();
  assert.deepEqual(calls, ["pauseAll", "resumeAll"]);
});

test("Pause and Resume reach the journal in the order the owner pressed them", async () => {
  const { pauses, calls, answer } = setUp();
  pauses.pauseAll();
  pauses.resumeAll();
  pauses.pauseGroup("songs");
  await new Promise((resolve) => setImmediate(resolve));
  // The second call waits for the first one's answer.
  assert.deepEqual(calls, ["pauseAll"]);
  await answer();
  assert.deepEqual(calls, ["pauseAll", "resumeAll", "pauseGroup songs"]);
  assert.equal(pauses.pending(), false);
});

test("a group's Resume, or Resume, stops only that group's Pause from coming back", async () => {
  const { pauses, calls, answer, release } = setUp();
  pauses.pauseGroup("playlist:1");
  pauses.pauseGroup("album:2");
  pauses.resumeGroup("playlist:1");
  await answer();
  release();
  await answer();
  assert.deepEqual(calls, [
    "pauseGroup playlist:1",
    "pauseGroup album:2",
    "resumeGroup playlist:1",
    "pauseGroup album:2",
  ]);

  const again = setUp();
  again.pauses.pauseGroup("album:2");
  again.pauses.resumeAll();
  await again.answer();
  again.release();
  await again.answer();
  assert.deepEqual(again.calls, ["pauseGroup album:2", "resumeAll"]);
});

test("a failed call still lets the next one through and reads the journal again", async () => {
  const { queue } = heldQueue();
  const calls: string[] = [];
  let landed = 0;
  const pauses = createOwnerPauseRequests({
    native: {
      pauseAll: async () => {
        calls.push("pauseAll");
        throw new Error("journal unavailable");
      },
      resumeAll: async () => {
        calls.push("resumeAll");
      },
      pauseGroup: async () => undefined,
      resumeGroup: async () => undefined,
    },
    queue,
    landed: async () => {
      landed += 1;
    },
  });
  pauses.pauseAll();
  pauses.resumeAll();
  for (let round = 0; round < 5; round += 1) await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls, ["pauseAll", "resumeAll"]);
  assert.equal(landed, 2);
  assert.equal(pauses.pending(), false);
});
