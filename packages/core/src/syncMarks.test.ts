import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { mergeRows, settleMarks } from "./index.ts";
import type { SyncDislike, SyncFavorite } from "./index.ts";

const KEY = "abbey road\u001fthe beatles\u001fsomething\u001f1.2";

const star = (changedAt: number, phoneId: string): SyncFavorite => ({
  id: KEY,
  changedAt,
  phoneId,
  deleted: false,
  addedAt: changedAt,
});

const dislike = (changedAt: number, phoneId: string): SyncDislike => ({
  id: KEY,
  changedAt,
  phoneId,
  deleted: false,
  title: "Something",
  artists: '["The Beatles"]',
  durationMs: 182_000,
  dislikedAt: changedAt,
});

/** A device's marks of one song, as its two synced tables hold them. */
interface Device {
  favorites: readonly SyncFavorite[];
  dislikes: readonly SyncDislike[];
}

/** [device] after it pulls [incoming] and settles a song left with both marks. */
const pulled = (device: Device, incoming: Device): Device => {
  let favorites = mergeRows(device.favorites, incoming.favorites).rows;
  let dislikes = mergeRows(device.dislikes, incoming.dislikes).rows;
  const [favorite] = favorites;
  const [disliked] = dislikes;
  if (favorite !== undefined && disliked !== undefined && !favorite.deleted && !disliked.deleted) {
    const settled = settleMarks(favorite, disliked);
    const removal = { id: KEY, ...settled.removal, deleted: true as const };
    if (settled.removed === "favorite") favorites = mergeRows(favorites, [removal]).rows;
    else dislikes = mergeRows(dislikes, [removal]).rows;
  }
  return { favorites, dislikes };
};

const live = (device: Device): string[] => [
  ...device.favorites.flatMap((row) => (row.deleted ? [] : ["favorite"])),
  ...device.dislikes.flatMap((row) => (row.deleted ? [] : ["dislike"])),
];

describe("settleMarks", () => {
  test("a dislike set after the star on another device removes the star", () => {
    assert.deepEqual(
      settleMarks({ changedAt: 10, phoneId: "a" }, { changedAt: 20, phoneId: "b" }),
      { removed: "favorite", removal: { changedAt: 20, phoneId: "b" } },
    );
  });

  test("a star set after the dislike on another device removes the dislike", () => {
    assert.deepEqual(
      settleMarks({ changedAt: 30, phoneId: "a" }, { changedAt: 20, phoneId: "b" }),
      { removed: "dislike", removal: { changedAt: 30, phoneId: "a" } },
    );
  });

  test("made at the same time, the greater phone id's mark stays, as rows merge", () => {
    assert.equal(
      settleMarks({ changedAt: 20, phoneId: "b" }, { changedAt: 20, phoneId: "a" }).removed,
      "dislike",
    );
    assert.equal(
      settleMarks({ changedAt: 20, phoneId: "a" }, { changedAt: 20, phoneId: "b" }).removed,
      "favorite",
    );
  });

  test("two devices that marked one song differently end with the later mark only", () => {
    for (const [starredAt, dislikedAt, kept] of [
      [10, 20, "dislike"],
      [20, 10, "favorite"],
      [20, 20, "dislike"],
    ] as const) {
      const a: Device = { favorites: [star(starredAt, "a")], dislikes: [] };
      const b: Device = { favorites: [], dislikes: [dislike(dislikedAt, "b")] };
      const aAfter = pulled(a, b);
      const bAfter = pulled(b, a);

      assert.deepEqual(live(aAfter), [kept]);
      assert.deepEqual(aAfter, bAfter);
      // What each device then pushes changes nothing on the other.
      assert.deepEqual(pulled(aAfter, bAfter), aAfter);
      assert.deepEqual(pulled(bAfter, aAfter), bAfter);
    }
  });

  test("the removal doesn't hold back the same mark set again later", () => {
    const settled = settleMarks({ changedAt: 10, phoneId: "a" }, { changedAt: 20, phoneId: "b" });
    const removal = { id: KEY, ...settled.removal, deleted: true as const };

    assert.deepEqual(mergeRows([removal], [star(21, "a")]).accepted, [star(21, "a")]);
  });
});
