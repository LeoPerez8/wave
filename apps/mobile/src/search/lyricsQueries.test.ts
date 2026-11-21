import assert from "node:assert/strict";
import { test } from "node:test";

import { LYRICS_TYPING_PAUSE_MS, lyricsQueries } from "./lyricsQueries.ts";

const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

const harness = () => {
  const reads: string[] = [];
  const pending = new Map<string, (answer: string) => void>();
  const answers: { query: string; answer: string }[] = [];
  const queries = lyricsQueries<string>({
    read: (query) => {
      reads.push(query);
      return new Promise((resolve) => pending.set(query, resolve));
    },
    answer: (query, answer) => answers.push({ query, answer }),
  });
  return { queries, reads, pending, answers };
};

test("typing reads no lyrics until it pauses, then reads once for the last query", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { queries, reads } = harness();
  for (const query of ["l", "lo", "lov", "love"]) {
    queries.type(query);
    t.mock.timers.tick(LYRICS_TYPING_PAUSE_MS - 1);
  }
  assert.deepEqual(reads, [], "no read while keys keep coming");
  t.mock.timers.tick(1);
  assert.deepEqual(reads, ["love"]);
  queries.dispose();
});

test("submitting reads at once, and the pause doesn't read it again", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { queries, reads } = harness();
  queries.type("love you");
  queries.submit("love you");
  assert.deepEqual(reads, ["love you"]);
  t.mock.timers.tick(LYRICS_TYPING_PAUSE_MS * 2);
  assert.deepEqual(reads, ["love you"]);
  queries.dispose();
});

test("an older query's answer arriving late is dropped", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { queries, reads, pending, answers } = harness();
  queries.submit("love");
  queries.submit("love you");
  assert.deepEqual(reads, ["love", "love you"]);
  pending.get("love you")?.("new");
  await settle();
  pending.get("love")?.("old");
  await settle();
  assert.deepEqual(answers, [{ query: "love you", answer: "new" }]);
  queries.dispose();
});

test("a query typed after a read starts drops that read's answer", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { queries, pending, answers } = harness();
  queries.submit("love");
  queries.type("love y");
  pending.get("love")?.("old");
  await settle();
  assert.deepEqual(answers, []);
  t.mock.timers.tick(LYRICS_TYPING_PAUSE_MS);
  pending.get("love y")?.("new");
  await settle();
  assert.deepEqual(answers, [{ query: "love y", answer: "new" }]);
  queries.dispose();
});

test("an empty query cancels a waiting read, clears the answer and reads nothing", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let cleared = 0;
  const reads: string[] = [];
  const queries = lyricsQueries<string>({
    read: (query) => {
      reads.push(query);
      return new Promise(() => {});
    },
    answer: () => {},
    clear: () => cleared++,
  });
  queries.type("love");
  queries.type("  ");
  t.mock.timers.tick(LYRICS_TYPING_PAUSE_MS);
  assert.deepEqual(reads, []);
  assert.equal(cleared, 1);
  queries.submit("");
  assert.deepEqual(reads, []);
  queries.dispose();
});

test("the index changing reads the settled query again, not one still being typed", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { queries, reads } = harness();
  queries.refresh();
  assert.deepEqual(reads, [], "nothing settled yet");
  queries.submit("love");
  queries.refresh();
  assert.deepEqual(reads, ["love", "love"]);
  queries.type("love y");
  queries.refresh();
  assert.deepEqual(reads, ["love", "love"], "a query still being typed waits for its pause");
  queries.dispose();
});

test("a failed read answers nothing for its query", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const failures: string[] = [];
  const queries = lyricsQueries<string>({
    read: () => Promise.reject(new Error("no")),
    answer: () => assert.fail("no answer expected"),
    fail: (query) => failures.push(query),
  });
  queries.submit("love");
  await settle();
  assert.deepEqual(failures, ["love"]);
  queries.dispose();
});

test("nothing answers after dispose", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { queries, pending, answers, reads } = harness();
  queries.submit("love");
  queries.type("love you");
  queries.dispose();
  pending.get("love")?.("old");
  t.mock.timers.tick(LYRICS_TYPING_PAUSE_MS);
  await settle();
  assert.deepEqual(answers, []);
  assert.deepEqual(reads, ["love"]);
});

