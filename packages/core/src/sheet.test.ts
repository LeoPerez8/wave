import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { settleSheet } from "./index.ts";

// Now Playing as tall as the S24+ window, in dp.
const height = 900;

describe("settleSheet", () => {
  test("dragging Now Playing down a quarter of the screen and letting go dismisses it", () => {
    assert.equal(settleSheet({ from: "open", offset: 240, velocity: 50, height }), "closed");
  });

  test("a short, slow drag down springs back open", () => {
    assert.equal(settleSheet({ from: "open", offset: 150, velocity: 50, height }), "open");
  });

  test("a quick flick down dismisses even when it is short", () => {
    assert.equal(settleSheet({ from: "open", offset: 60, velocity: 1200, height }), "closed");
  });

  test("flicking back up after dragging down keeps it open, even past the distance", () => {
    assert.equal(settleSheet({ from: "open", offset: 400, velocity: -1200, height }), "open");
  });

  test("a tremor with speed but almost no travel doesn't dismiss", () => {
    assert.equal(settleSheet({ from: "open", offset: 6, velocity: 1200, height }), "open");
  });

  test("swiping the mini player a quarter of the way up opens Now Playing", () => {
    assert.equal(settleSheet({ from: "closed", offset: 660, velocity: -50, height }), "open");
  });

  test("a short, slow swipe up from the mini player falls back closed", () => {
    assert.equal(settleSheet({ from: "closed", offset: 800, velocity: -50, height }), "closed");
  });

  test("a quick flick up from the mini player opens it", () => {
    assert.equal(settleSheet({ from: "closed", offset: 840, velocity: -1200, height }), "open");
  });

  test("pulling back down while opening closes it again", () => {
    assert.equal(settleSheet({ from: "closed", offset: 300, velocity: 1200, height }), "closed");
  });
});
