import assert from "node:assert/strict";
import { test } from "node:test";

import { recognizeEntryAction } from "./index.ts";

test("a Recognize request opens its card when Wave reaches the foreground", () => {
  assert.equal(
    recognizeEntryAction({ opening: "capture", pending: true, foreground: true, cardOpen: false }),
    "open",
  );
});

test("a request waits while Wave is hidden or has no request to handle", () => {
  assert.equal(
    recognizeEntryAction({ opening: "capture", pending: true, foreground: false, cardOpen: false }),
    "wait",
  );
  assert.equal(
    recognizeEntryAction({ opening: "capture", pending: false, foreground: true, cardOpen: false }),
    "wait",
  );
});

test("another entry request keeps the existing card and session", () => {
  assert.equal(
    recognizeEntryAction({ opening: "capture", pending: true, foreground: true, cardOpen: true }),
    "keep",
  );
});

test("a notification match replaces an open card once Wave is foreground", () => {
  assert.equal(
    recognizeEntryAction({
      pending: true,
      foreground: true,
      cardOpen: true,
      opening: "match",
    }),
    "open",
  );
  assert.equal(
    recognizeEntryAction({
      pending: true,
      foreground: false,
      cardOpen: true,
      opening: "match",
    }),
    "wait",
  );
});
