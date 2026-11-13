import assert from "node:assert/strict";
import { test } from "node:test";

import { geniusLoadingNote } from "./index.ts";

test("Genius's loading note waits 300 ms and disappears as soon as loading ends", () => {
  assert.equal(geniusLoadingNote("loading", 0), false);
  assert.equal(geniusLoadingNote("loading", 299), false);
  assert.equal(geniusLoadingNote("loading", 300), true);
  assert.equal(geniusLoadingNote("settled", 300), false);
});
