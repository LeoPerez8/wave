import assert from "node:assert/strict";
import { test } from "node:test";

import { createLongPressIntent } from "./index.ts";

test("scrolling taking a press while its anchor is measured prevents the pending menu opening", () => {
  const intent = createLongPressIntent();
  intent.begin();
  const request = intent.request();
  assert.notEqual(request, null);
  intent.leave();
  assert.equal(intent.open(request!), false);
});

test("a cancelled long press cannot open a menu after a later song or network read", () => {
  const intent = createLongPressIntent();
  intent.begin();
  const request = intent.request()!;
  assert.equal(intent.open(request), true);
  const readCompleted = () => intent.allows(request);
  intent.cancel();
  assert.equal(readCompleted(), false);
});

test("an ordinary long press may slide out of its row and lift while its menu finishes loading", () => {
  const intent = createLongPressIntent();
  intent.begin();
  const request = intent.request()!;
  assert.equal(intent.open(request), true);
  assert.equal(intent.leave(), false);
  intent.release();
  assert.equal(intent.allows(request), true);
  assert.equal(intent.open(request), false);
});

test("scrolling before the threshold suppresses a late long-press timer", () => {
  const intent = createLongPressIntent();
  intent.begin();
  intent.leave();
  assert.equal(intent.request(), null);
});

test("lifting before the anchor measurement completes suppresses that pending menu", () => {
  const intent = createLongPressIntent();
  intent.begin();
  const request = intent.request()!;
  intent.release();
  assert.equal(intent.open(request), false);
});

test("an old measurement or cancellation cannot disturb a newer held menu", () => {
  const intent = createLongPressIntent();
  intent.begin();
  const old = intent.request()!;
  intent.begin();
  const current = intent.request()!;
  assert.equal(intent.open(old), false);
  assert.equal(intent.cancel(old), false);
  assert.equal(intent.open(current), true);
  assert.equal(intent.allows(current), true);
});
