/// <reference types="node" />
import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";

import {
  forgetSavedLyrics,
  indexSavedLyrics,
  keepSavedLyrics,
  selectSavedLyrics,
  selectSavedLyricsCandidates,
  selectSavedLyricsSearchIndexPage,
} from "./savedLyrics.ts";
import * as schema from "./schema.ts";
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

  test("saved lyrics are searchable by normalized phrase and leave no stale candidates", () => {
    keepSavedLyrics(db, "crush", {
      kind: "found",
      lyrics: { synced: true, text: "[00:01.00]Trem-Balá!\nOutra linha" },
    });
    keepSavedLyrics(db, "miss", { kind: "miss", checkedAt: 1_000 });

    assert.deepEqual(selectSavedLyricsCandidates(db, "trem bala"), [
      { videoId: "crush", lyrics: "[00:01.00]Trem-Balá!\nOutra linha" },
    ]);
    assert.deepEqual(selectSavedLyricsCandidates(db, "outra trem"), []);

    keepSavedLyrics(db, "crush", { kind: "found", lyrics: { synced: false, text: "new words" } });
    assert.deepEqual(selectSavedLyricsCandidates(db, "trem bala"), []);
    assert.deepEqual(selectSavedLyricsCandidates(db, "new words"), [
      { videoId: "crush", lyrics: "new words" },
    ]);

    forgetSavedLyrics(db, ["crush"]);
    assert.deepEqual(selectSavedLyricsCandidates(db, "new words"), []);
  });

  test("the background index page backfills saved lyrics from before the migration", () => {
    db.insert(schema.savedLyrics)
      .values({
        videoId: "old-video",
        lyrics: "old saved phrase",
        synced: false,
        checkedAt: 1_000,
      })
      .run();

    const page = selectSavedLyricsSearchIndexPage(db, "", 10);
    assert.deepEqual(page, [{ videoId: "old-video", lyrics: "old saved phrase" }]);
    indexSavedLyrics(db, page[0]!);
    assert.deepEqual(selectSavedLyricsCandidates(db, "saved phrase"), [
      { videoId: "old-video", lyrics: "old saved phrase" },
    ]);
    assert.deepEqual(selectSavedLyricsSearchIndexPage(db, "", 10), []);
  });
});
