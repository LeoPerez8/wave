import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { pickWeighted, playsWeight } from "./index.ts";

/** A random source answering [values] in turn. */
const scripted = (...values: number[]) => {
  let at = 0;
  return () => values[at++] ?? 0;
};

const WEIGHTS: Record<string, number> = { a: 1, b: 2, c: 1 };
const weightOf = (item: string) => WEIGHTS[item] ?? 0;

describe("A weighted pick", () => {
  test("lands on the item whose share of the total weight the random number falls in", () => {
    // Of a 1, b 2, c 1 (total 4), 0.3 × 4 = 1.2 falls in b's share (1 to 3);
    // of a 1, c 1 (total 2), 0.9 × 2 = 1.8 falls in c's (1 to 2).
    assert.deepEqual(pickWeighted(["a", "b", "c"], 2, weightOf, scripted(0.3, 0.9)), ["b", "c"]);
  });

  test("picks the first item for a random number of 0", () => {
    assert.deepEqual(pickWeighted(["a", "b", "c"], 1, weightOf, scripted(0)), ["a"]);
  });

  test("picks each item once, all of them when asked for more", () => {
    assert.deepEqual(pickWeighted(["a", "b", "c"], 5, weightOf, scripted(0, 0, 0)), [
      "a",
      "b",
      "c",
    ]);
  });

  test("picks nothing when asked for none or given none", () => {
    assert.deepEqual(pickWeighted(["a", "b"], 0, weightOf, scripted(0.5)), []);
    assert.deepEqual(pickWeighted([], 3, weightOf, scripted(0.5)), []);
  });

  test("takes the last item when rounding leaves the number past the end", () => {
    assert.deepEqual(
      pickWeighted(["a", "b", "c"], 1, weightOf, () => 1),
      ["c"],
    );
  });
});

describe("Plays' weight", () => {
  test("grows with the square root of plays plus one", () => {
    assert.deepEqual([0, 3, 8, 99].map(playsWeight), [1, 2, 3, 10]);
  });

  test("still gives no plays (or a bad count) a chance", () => {
    assert.equal(playsWeight(-4), 1);
  });
});
