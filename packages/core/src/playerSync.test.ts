import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { applyPlayerSync, planPlayerSync } from "./index.ts";
import type { PlayerList, SyncStep } from "./index.ts";

const list = (keys: string, currentKey: string | null = null): PlayerList => ({
  keys: keys === "" ? [] : keys.split(" "),
  currentKey,
});

const queue = (keys: string, index: number) => ({
  keys: keys === "" ? [] : keys.split(" "),
  index,
});

/** Applies the steps one by one, checking the playing item is never removed along the way. */
const run = (player: PlayerList, steps: readonly SyncStep[]): PlayerList => {
  let state = player;
  for (const step of steps) {
    const next = applyPlayerSync(state, [step]);
    if (step.type === "edit" && state.currentKey !== null) {
      assert.ok(next.keys.includes(state.currentKey), `edit removed ${state.currentKey}`);
    }
    state = next;
  }
  return state;
};

describe("planPlayerSync", () => {
  test("loads the whole list into an empty player", () => {
    const steps = planPlayerSync(list(""), queue("1 2 3", 1));
    assert.deepEqual(steps, [{ type: "replace", keys: ["1", "2", "3"], index: 1 }]);
    assert.deepEqual(run(list(""), steps), list("1 2 3", "2"));
  });

  test("replaces the list when the new current entry isn't loaded yet", () => {
    const steps = planPlayerSync(list("1 2 3", "2"), queue("4 5", 0));
    assert.deepEqual(steps, [{ type: "replace", keys: ["4", "5"], index: 0 }]);
  });

  test("clears the player when the queue is empty", () => {
    assert.deepEqual(planPlayerSync(list("1 2", "1"), queue("", -1)), [{ type: "clear" }]);
    assert.deepEqual(planPlayerSync(list(""), queue("", -1)), []);
  });

  test("does nothing when the player already matches", () => {
    assert.deepEqual(planPlayerSync(list("1 2 3", "2"), queue("1 2 3", 1)), []);
  });

  test("seeks when only the current entry changed", () => {
    assert.deepEqual(planPlayerSync(list("1 2 3", "1"), queue("1 2 3", 2)), [
      { type: "seek", key: "3" },
    ]);
  });

  test("inserts lined-up entries without touching the playing item", () => {
    const steps = planPlayerSync(list("1 2 3", "2"), queue("1 2 9 3", 1));
    assert.deepEqual(steps, [{ type: "edit", at: 2, removeCount: 0, insertKeys: ["9"] }]);
  });

  test("removes entries on both sides of the playing item", () => {
    const player = list("1 2 3 4 5", "3");
    const steps = planPlayerSync(player, queue("1 3 5", 1));
    assert.deepEqual(run(player, steps), list("1 3 5", "3"));
    assert.ok(steps.every((step) => step.type === "edit"));
  });

  test("reorders everything around the playing item for a shuffle toggle", () => {
    const player = list("1 2 3 4 5 6 7 8", "4");
    const target = queue("4 9 7 1 8 3 6 2 5", 0);
    const steps = planPlayerSync(player, target);
    assert.ok(steps.every((step) => step.type === "edit"));
    assert.deepEqual(run(player, steps), list("4 9 7 1 8 3 6 2 5", "4"));
  });

  test("follows a new current entry and edits the list in one plan", () => {
    const player = list("1 2 3 4", "1");
    const steps = planPlayerSync(player, queue("2 3 4 1", 2));
    assert.deepEqual(run(player, steps), list("2 3 4 1", "4"));
    assert.ok(!steps.some((step) => step.type === "replace"));
  });

  test("keeps edits small in a long list", () => {
    const keys = Array.from({ length: 10_000 }, (_, i) => String(i + 1));
    const player: PlayerList = { keys, currentKey: "5000" };
    const target = [...keys.slice(0, 5000), "10001", ...keys.slice(5000)];
    const steps = planPlayerSync(player, { keys: target, index: 4999 });
    assert.deepEqual(steps, [{ type: "edit", at: 5000, removeCount: 0, insertKeys: ["10001"] }]);
  });
});
