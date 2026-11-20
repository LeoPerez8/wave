import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  artistPlayTotals,
  IN_YOUR_ORBIT_ARTISTS,
  inYourOrbit,
  inYourOrbitWindow,
  isRecent,
  RECENT_WINDOW_DAYS,
  type CreditedPlayTotals,
  type EntityPlayTotals,
} from "./index.ts";

const DAY_MS = 86_400_000;
const NOW = Date.UTC(2026, 10, 20, 12);

const artist = (
  id: number | string,
  countedPlays: number,
  more: Partial<EntityPlayTotals> = {},
): EntityPlayTotals => ({
  id,
  sortKey: String(id),
  countedPlays,
  listenedMs: countedPlays * 180_000,
  latestPlayAt: NOW,
  ...more,
});

const credit = (artistId: number, more: Partial<CreditedPlayTotals> = {}): CreditedPlayTotals => ({
  albumId: 1,
  albumSort: "album",
  artistId,
  artistSort: `artist ${artistId}`,
  primary: true,
  countedPlays: 1,
  listenedMs: 180_000,
  latestPlayAt: NOW,
  ...more,
});

describe("In your orbit", () => {
  test("reads the plays of the last 14 days, up to now", () => {
    assert.deepEqual(inYourOrbitWindow(NOW), { from: NOW - RECENT_WINDOW_DAYS * DAY_MS, to: NOW });
  });

  test("a play at the window's first instant is read, one a millisecond older is not", () => {
    const { from, to } = inYourOrbitWindow(NOW);
    assert.ok(from !== null);
    const inside = (at: number) => at >= from && at <= to;
    for (const at of [from - 1, from, NOW, NOW + 1]) assert.equal(inside(at), isRecent(at, NOW));
    assert.equal(inside(from), true);
    assert.equal(inside(from - 1), false);
  });

  test("ranks artists by counted plays in the window, Library and online ones together", () => {
    assert.deepEqual(
      inYourOrbit([artist(1, 2), artist("online:b", 5), artist(3, 3)]).map(({ id }) => id),
      ["online:b", 3, 1],
    );
  });

  test("ties go to the most listened time, then the latest play", () => {
    assert.deepEqual(
      inYourOrbit([
        artist(1, 2, { latestPlayAt: NOW - 2 }),
        artist(2, 2, { latestPlayAt: NOW - 1 }),
        artist(3, 2, { listenedMs: 900_000 }),
      ]).map(({ id }) => id),
      [3, 2, 1],
    );
  });

  test("an artist without a counted play in the window is left out", () => {
    assert.deepEqual(inYourOrbit([artist(1, 0), artist(2, 1)]), [artist(2, 1)]);
    assert.deepEqual(inYourOrbit([artist(1, 0)]), []);
  });

  test("a collaboration counts for each artist it credits", () => {
    const solo = credit(1, { countedPlays: 2 });
    const collaboration = [
      credit(2, { albumId: 2, countedPlays: 3 }),
      credit(1, { albumId: 2, countedPlays: 3, primary: false }),
    ];
    assert.deepEqual(
      inYourOrbit(artistPlayTotals([solo, ...collaboration])).map(({ id, countedPlays }) => [
        id,
        countedPlays,
      ]),
      [
        [1, 5],
        [2, 3],
      ],
    );
  });

  test("shows at most a row's worth of artists", () => {
    const many = Array.from({ length: IN_YOUR_ORBIT_ARTISTS + 5 }, (_, index) =>
      artist(index + 1, index + 1),
    );
    const shown = inYourOrbit(many);
    assert.equal(shown.length, IN_YOUR_ORBIT_ARTISTS);
    assert.equal(shown[0]!.id, IN_YOUR_ORBIT_ARTISTS + 5);
  });
});
