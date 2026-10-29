import assert from "node:assert/strict";
import { test } from "node:test";

import { recognizeEntryAction } from "./index.ts";

test("a Recognize request opens its card when Wave reaches the foreground", () => {
  assert.equal(recognizeEntryAction({ pending: true, foreground: true, cardOpen: false }), "open");
});

test("a request waits while Wave is hidden or has no request to handle", () => {
  assert.equal(recognizeEntryAction({ pending: true, foreground: false, cardOpen: false }), "wait");
  assert.equal(recognizeEntryAction({ pending: false, foreground: true, cardOpen: false }), "wait");
});

test("another entry request keeps the existing card and session", () => {
  assert.equal(recognizeEntryAction({ pending: true, foreground: true, cardOpen: true }), "keep");
});
