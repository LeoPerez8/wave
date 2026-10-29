import assert from "node:assert/strict";
import { test } from "node:test";

import { makeExternalStore } from "./externalStore.ts";
import { holdable } from "./holdable.ts";

test("unheld, it shows the source's value as it changes", () => {
  const source = makeExternalStore(1);
  const shown = holdable(source);
  source.set(2);
  assert.equal(shown.get(), 2);
});

test("held, it keeps the value it had when the hold began; released, it shows the latest", () => {
  const source = makeExternalStore(1);
  const shown = holdable(source);
  const release = shown.hold();
  source.set(2);
  source.set(3);
  assert.equal(shown.get(), 1);
  release();
  assert.equal(shown.get(), 3);
});

test("a listener hears the release that changes what's shown", () => {
  const source = makeExternalStore("a");
  const shown = holdable(source);
  const heard: string[] = [];
  shown.subscribe(() => heard.push(shown.get()));
  const release = shown.hold();
  source.set("b");
  release();
  assert.equal(heard.at(-1), "b");
});

test("releasing twice, or one of two holds, keeps the rest of the hold", () => {
  const source = makeExternalStore(1);
  const shown = holdable(source);
  const first = shown.hold();
  const second = shown.hold();
  source.set(2);
  first();
  first();
  assert.equal(shown.get(), 1);
  second();
  assert.equal(shown.get(), 2);
});

test("a stopped listener hears nothing more", () => {
  const source = makeExternalStore(1);
  const shown = holdable(source);
  let heard = 0;
  const stop = shown.subscribe(() => heard++);
  stop();
  source.set(2);
  shown.hold()();
  assert.equal(heard, 0);
});
