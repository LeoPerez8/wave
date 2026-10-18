/// <reference types="node" />
import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";

import { forgetSavedLyrics, keepSavedLyrics, selectSavedLyrics } from "./savedLyrics.ts";
import { openTestDatabase, type TestDatabase } from "./testDatabase.ts";

let db: TestDatabase;

beforeEach(async () => {
  db = await openTestDatabase();
});

describe("lyrics saved for non-D songs", () => {
  test("lyrics found for a video read back as they were saved", () => {
    const found = { kind: "found", lyrics: { synced: true, text: "[00:01.00]Hello" } } as const;
    keepSavedLyrics(db, "crush", found);
    assert.deepEqual(selectSavedLyrics(db, "crush"), found);
    assert.equal(selectSavedLyrics(db, "other"), null);
  });

  test("a miss reads back with when it was checked, and lyrics found later replace it", () => {
    keepSavedLyrics(db, "crush", { kind: "miss", checkedAt: 1_000 });
    assert.deepEqual(selectSavedLyrics(db, "crush"), { kind: "miss", checkedAt: 1_000 });
    const found = { kind: "found", lyrics: { synced: false, text: "Hello" } } as const;
    keepSavedLyrics(db, "crush", found);
    assert.deepEqual(selectSavedLyrics(db, "crush"), found);
  });

  test("forgetting videos drops what was saved for them only", () => {
    keepSavedLyrics(db, "crush", { kind: "miss", checkedAt: 1_000 });
    keepSavedLyrics(db, "harder", { kind: "found", lyrics: { synced: false, text: "Work it" } });
    forgetSavedLyrics(db, ["crush"]);
    assert.equal(selectSavedLyrics(db, "crush"), null);
    assert.notEqual(selectSavedLyrics(db, "harder"), null);
  });
});
