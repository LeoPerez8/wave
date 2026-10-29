import { test } from "node:test";
import assert from "node:assert/strict";
import { sql } from "drizzle-orm";
import {
  openTestDatabase,
  reopenTestDatabase,
  closeTestDatabase,
  migrateTestDatabase,
} from "./testDatabase.ts";
import { selectPhoneId } from "./sync.ts";
import { hideFollowRelease } from "./followReleases.ts";
import { selectUnpushed } from "./syncRows.ts";
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
  removeFollow(db, "the beyoncé", 400);
  assert.equal(selectFollow(db, "BEYONCE"), null);
  assert.equal(countFollows(db), 1);
  assert.deepEqual(
    selectFollows(db).map((f) => f.name),
    ["ABBA"],
  );
  // Following again after an unfollow starts anew.
  saveFollow(db, { name: "Beyoncé" }, "shows", 500);
  assert.deepEqual(
    [selectFollow(db, "beyonce")?.name, selectFollow(db, "beyonce")?.followedAt],
    ["Beyoncé", 500],
  );
  const reopened = await reopenTestDatabase(db);
  assert.equal(selectFollow(reopened, "ABBA")?.followedAt, 300);
  closeTestDatabase(reopened);
});

test("follows, hidden releases and notified shows from before syncing go up at the next sync", async () => {
  const db = await openTestDatabase({ through: "0047_follow_shows" });
  db.run(
    sql`INSERT INTO follows (key, name, level, followed_at) VALUES ('abba', 'ABBA', 'shows', 100)`,
  );
  db.run(sql`INSERT INTO hidden_follow_releases (key) VALUES ('deezer:12')`);
  db.run(sql`INSERT INTO notified_follow_shows (id) VALUES ('show-1')`);
  await migrateTestDatabase(db);

  const { rows } = selectUnpushed(db, 100, () => null);
  assert.deepEqual(rows.follows, [
    {
      id: "abba",
      changedAt: 100,
      phoneId: selectPhoneId(db),
      deleted: false,
      name: "ABBA",
      level: "shows",
      followedAt: 100,
      deezerId: null,
      ytBrowseId: null,
    },
  ]);
  assert.deepEqual(
    [...rows.hiddenReleases, ...rows.notifiedShows].map((row) => [row.id, row.deleted]),
    [
      ["deezer:12", false],
      ["show-1", false],
    ],
  );
  // Hiding it again isn't a change: its stamp stays.
  const stamp = rows.hiddenReleases[0]?.changedAt;
  hideFollowRelease(db, "deezer:12", (stamp ?? 0) + 1_000);
  assert.equal(selectUnpushed(db, 100, () => null).rows.hiddenReleases[0]?.changedAt, stamp);
});
