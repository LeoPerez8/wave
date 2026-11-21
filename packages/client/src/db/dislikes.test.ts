/// <reference types="node" />
import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";

import { removeDislikes, selectDislikes, setDislikes } from "./dislikes.ts";
import { openTestDatabase, type TestDatabase } from "./testDatabase.ts";

let db: TestDatabase;

beforeEach(async () => {
  db = await openTestDatabase();
});

const song = (key: string, title: string) => ({
  key,
  title,
  artists: ["Daft Punk", "Pharrell Williams"],
  durationMs: 240_000,
});

describe("dislikes", () => {
  test("a disliked song is kept with how it was listed and when, the newest first", () => {
    setDislikes(db, [song("7", "Get Lucky")], 1_000);
    setDislikes(db, [song("yt:abc", "Contact")], 2_000);
    assert.deepEqual(selectDislikes(db), [
      { ...song("yt:abc", "Contact"), dislikedAt: 2_000 },
      { ...song("7", "Get Lucky"), dislikedAt: 1_000 },
    ]);
  });

  test("disliking a song again keeps when it was first disliked", () => {
    setDislikes(db, [song("7", "Get Lucky")], 1_000);
    setDislikes(db, [song("7", "Get Lucky (Radio Edit)")], 5_000);
    assert.deepEqual(selectDislikes(db), [
      { ...song("7", "Get Lucky (Radio Edit)"), dislikedAt: 1_000 },
    ]);
  });

  test("a removed dislike is gone, the others stay", () => {
    setDislikes(db, [song("7", "Get Lucky"), song("yt:abc", "Contact")], 1_000);
    removeDislikes(db, ["7", "7", "unknown"], 2_000);
    assert.deepEqual(
      selectDislikes(db).map((dislike) => dislike.key),
      ["yt:abc"],
    );
  });

  test("a song disliked again after its dislike was removed is disliked since then", () => {
    setDislikes(db, [song("7", "Get Lucky")], 1_000);
    removeDislikes(db, ["7"], 2_000);
    setDislikes(db, [song("7", "Get Lucky")], 3_000);
    assert.deepEqual(selectDislikes(db), [{ ...song("7", "Get Lucky"), dislikedAt: 3_000 }]);
  });
});
