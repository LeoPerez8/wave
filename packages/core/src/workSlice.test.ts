import assert from "node:assert/strict";
import test from "node:test";
import { advanceWork } from "./index.ts";

test("a cooperative slice returns to its caller within its clock budget and resumes without repeats", () => {
  let time = 0;
  const visited: number[] = [];
  function* job() {
    for (let i = 0; i < 100; i++) {
      visited.push(i);
      time++;
      yield;
    }
    return "ready";
  }
  const work = job();
  assert.deepEqual(
    advanceWork(work, () => time, 6),
    { done: false, value: undefined },
  );
  assert.equal(time, 6);
  let result = advanceWork(work, () => time, 6);
  while (!result.done) result = advanceWork(work, () => time, 6);
  assert.equal(result.value, "ready");
  assert.deepEqual(
    visited,
    Array.from({ length: 100 }, (_, i) => i),
  );
});
