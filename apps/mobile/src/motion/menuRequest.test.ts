import assert from "node:assert/strict";
import { test } from "node:test";

import {
  armAnchoredMenu,
  listenForAnchoredMenu,
  openArmedAnchoredMenu,
  requestAnchoredMenu,
} from "./menuRequest.ts";

test("an anchored menu request waits for its screen and opens once", () => {
  let opened = 0;
  requestAnchoredMenu("home");
  const stop = listenForAnchoredMenu("home", () => opened++);
  assert.equal(opened, 1);
  stop();
  const stopAgain = listenForAnchoredMenu("home", () => opened++);
  assert.equal(opened, 1);
  stopAgain();
});

test("a request opens the currently mounted matching screen", () => {
  let opened = 0;
  const stop = listenForAnchoredMenu("library", () => opened++);
  requestAnchoredMenu("library");
  assert.equal(opened, 1);
  stop();
});

test("navigation opens only the armed destination's editor", () => {
  let opened = 0;
  const stop = listenForAnchoredMenu("tab-bar", () => opened++);
  armAnchoredMenu("tab-bar");
  openArmedAnchoredMenu("home");
  assert.equal(opened, 0);
  openArmedAnchoredMenu("tab-bar");
  openArmedAnchoredMenu("tab-bar");
  assert.equal(opened, 1);
  stop();
});
