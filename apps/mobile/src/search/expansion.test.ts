/// <reference types="node" />
import assert from "node:assert/strict";
import { test } from "node:test";

import { expansionAfterTyping, NO_EXPANSION, showAllLyricsOf, showAllOf } from "./expansion.ts";

test("clearing the field collapses every Show all, Lyrics included", () => {
  const opened = showAllLyricsOf(showAllOf(NO_EXPANSION, "song"));
  assert.deepEqual([...opened.kinds], ["song"]);
  assert.equal(opened.lyrics, true);

  const cleared = expansionAfterTyping(opened, "  ");
  assert.deepEqual([...cleared.kinds], []);
  assert.equal(cleared.lyrics, false);
});

test("refining a query keeps what Show all opened", () => {
  const opened = showAllLyricsOf(showAllOf(NO_EXPANSION, "album"));
  assert.equal(expansionAfterTyping(opened, "teardrop mass"), opened);
});
