/// <reference types="node" />
import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";

import { forgetFileDeletions, pendingFileDeletions, recordFileDeletions } from "./fileDeletions.ts";
import { openTestDatabase, type TestDatabase } from "./testDatabase.ts";

let db: TestDatabase;

beforeEach(async () => {
  db = await openTestDatabase();
});

describe("files recorded for deletion", () => {
  test("each file once, oldest first, until its deletion is done", () => {
    recordFileDeletions(db, ["/Music/b.mp3"], 2);
    recordFileDeletions(db, ["/Music/a.mp3", "/Music/b.mp3", "/Music/a.mp3"], 3);
    assert.deepEqual(pendingFileDeletions(db), ["/Music/b.mp3", "/Music/a.mp3"]);
    forgetFileDeletions(db, ["/Music/b.mp3"]);
    assert.deepEqual(pendingFileDeletions(db), ["/Music/a.mp3"]);
  });
});
