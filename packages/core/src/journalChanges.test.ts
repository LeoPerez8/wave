import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { applyJournalChanges } from "./index.ts";

interface Job {
  readonly id: string;
  readonly phase: string;
}

const a: Job = { id: "a", phase: "queued" };
const b: Job = { id: "b", phase: "queued" };
const c: Job = { id: "c", phase: "queued" };

describe("Following the download journal by its changes", () => {
  test("the first answer is the whole journal, in its order", () => {
    assert.deepEqual(
      applyJournalChanges([], { revision: 3, jobs: [a, b, c], ids: ["a", "b", "c"] }),
      [a, b, c],
    );
  });

  test("an answer with nothing new keeps the same list, so nothing downstream redoes its work", () => {
    const jobs = [a, b, c];
    assert.equal(applyJournalChanges(jobs, { revision: 3, jobs: [], ids: null }), jobs);
  });

  test("a changed job replaces its old self in place; the others stay the very same objects", () => {
    const started = { id: "b", phase: "preparing" };
    const next = applyJournalChanges([a, b, c], { revision: 4, jobs: [started], ids: null });
    assert.deepEqual(next, [a, started, c]);
    assert.equal(next[0], a);
    assert.equal(next[2], c);
  });

  test("a new order adds, moves and drops jobs as the journal lists them", () => {
    const retried = { id: "a", phase: "queued" };
    const d = { id: "d", phase: "queued" };
    assert.deepEqual(
      applyJournalChanges([a, b, c], { revision: 5, jobs: [retried, d], ids: ["b", "a", "d"] }),
      [b, retried, d],
    );
  });

  test("a job in the order that the reader never saw is left out rather than made up", () => {
    assert.deepEqual(applyJournalChanges([a], { revision: 6, jobs: [], ids: ["a", "z"] }), [a]);
  });
});
