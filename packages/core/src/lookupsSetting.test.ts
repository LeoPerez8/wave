import assert from "node:assert/strict";
import { test } from "node:test";

import {
  FIND_LYRICS_AND_GENRE_SETTING,
  readFindLyricsAndGenre,
  writeFindLyricsAndGenre,
} from "./index.ts";

test("looking lyrics and genre up is on when nothing is stored", () => {
  assert.equal(readFindLyricsAndGenre(null), true);
  assert.equal(readFindLyricsAndGenre(undefined), true);
});

test("the owner's choice survives being stored, and on is stored as the default", () => {
  assert.equal(readFindLyricsAndGenre(writeFindLyricsAndGenre(false)), false);
  assert.equal(readFindLyricsAndGenre(writeFindLyricsAndGenre(true)), true);
  assert.equal(writeFindLyricsAndGenre(true), null);
});

test("a value this Wave doesn't know keeps the lookups on", () => {
  assert.equal(readFindLyricsAndGenre("later"), true);
});

test("the phone and the computer keep the switch under one synced key", () => {
  assert.equal(FIND_LYRICS_AND_GENRE_SETTING, "settings.findLyricsAndGenre");
});
