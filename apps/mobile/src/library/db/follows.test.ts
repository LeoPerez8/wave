import { test } from "node:test";
import assert from "node:assert/strict";
import { openTestDatabase, reopenTestDatabase, closeTestDatabase } from "./testDatabase.ts";
import { saveFollow, selectFollow, selectFollows, countFollows, removeFollow } from "./follows.ts";

test("a follow survives re-reading and merges online ids without changing its start date", async () => {
  const db = await openTestDatabase();
  saveFollow(db, { name: "The Beyoncé" }, "releases", 100);
  saveFollow(db, { name: "BEYONCE", ytBrowseId: "UC123", deezerId: 42 }, "releases", 200);
  assert.equal(countFollows(db), 1);
  assert.deepEqual(selectFollow(db, "Beyoncé"), {
    key: "beyonce",
    name: "The Beyoncé",
    level: "releases",
    followedAt: 100,
    deezerId: 42,
    ytBrowseId: "UC123",
  });
  saveFollow(db, { name: "ABBA" }, "releases", 300);
  assert.deepEqual(
    selectFollows(db).map((f) => f.name),
    ["ABBA", "The Beyoncé"],
  );
  removeFollow(db, "the beyoncé");
  assert.equal(selectFollow(db, "BEYONCE"), null);
  assert.equal(countFollows(db), 1);
  const reopened = await reopenTestDatabase(db);
  assert.equal(selectFollow(reopened, "ABBA")?.followedAt, 300);
  closeTestDatabase(reopened);
});
