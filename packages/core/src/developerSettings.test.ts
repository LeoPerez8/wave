import assert from "node:assert/strict";
import { test } from "node:test";

import { createDeveloperTitleTaps } from "./index.ts";

test("the first four Settings title taps do nothing; the fifth reveals Developer", () => {
  const title = createDeveloperTitleTaps();
  for (const at of [0, 200, 400, 600]) assert.equal(title.tap(false, at), null);
  assert.equal(title.tap(false, 800), true);
});

test("a gap longer than 1.5 seconds starts a new five-tap sequence", () => {
  const title = createDeveloperTitleTaps();
  for (const at of [0, 200, 400, 600, 2101, 2301, 2501, 2701]) {
    assert.equal(title.tap(false, at), null);
  }
  assert.equal(title.tap(false, 2901), true);
});

test("five more activations hide Developer, with no feedback for the first four", () => {
  const title = createDeveloperTitleTaps();
  for (const at of [0, 100, 200, 300]) title.tap(false, at);
  assert.equal(title.tap(false, 400), true);
  for (const at of [500, 600, 700, 800]) assert.equal(title.tap(true, at), null);
  assert.equal(title.tap(true, 900), false);
});

test("the window is between taps, including gaps of exactly 1.5 seconds", () => {
  const title = createDeveloperTitleTaps();
  for (const at of [0, 1500, 3000, 4500]) assert.equal(title.tap(false, at), null);
  assert.equal(title.tap(false, 6000), true);
});

test("ordinary slow activations never reveal Developer", () => {
  const title = createDeveloperTitleTaps();
  for (const at of [0, 1501, 3002, 4503, 6004, 7505]) {
    assert.equal(title.tap(false, at), null);
  }
});

test("leaving Settings discards the unfinished sequence", () => {
  const title = createDeveloperTitleTaps();
  for (const at of [0, 100, 200, 300]) title.tap(false, at);
  title.reset();
  for (const at of [400, 500, 600, 700]) assert.equal(title.tap(false, at), null);
  assert.equal(title.tap(false, 800), true);
});
