import assert from "node:assert/strict";
import { test } from "node:test";

import { createBackExitConfirmation } from "./index.ts";

test("root Back hints first and exits on a second press within two seconds", () => {
  const exit = createBackExitConfirmation();
  assert.equal(exit.press(0), false);
  assert.equal(exit.press(1_999), true);
  assert.equal(exit.press(2_000), false);
});

test("an expired attempt starts a new confirmation window", () => {
  const exit = createBackExitConfirmation();
  assert.equal(exit.press(100), false);
  assert.equal(exit.press(2_100), false);
  assert.equal(exit.press(4_101), false);
  assert.equal(exit.press(4_500), true);
});

test("leaving the root or foreground cancels the exit attempt", () => {
  const exit = createBackExitConfirmation();
  assert.equal(exit.press(100), false);
  exit.reset();
  assert.equal(exit.press(200), false);
  assert.equal(exit.press(300), true);
});

test("a clock moving backwards cannot confirm exit", () => {
  const exit = createBackExitConfirmation();
  assert.equal(exit.press(1_000), false);
  assert.equal(exit.press(500), false);
});
