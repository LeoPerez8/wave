import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { STATS_RANKINGS, statsSeeAll } from "./index.ts";

describe("STATS_RANKINGS", () => {
  test("lists Top Songs, Top Albums and Top Artists, in screen order", () => {
    assert.deepEqual(
      STATS_RANKINGS.map((ranking) => [ranking.id, ranking.title]),
      [
        ["songs", "Top songs"],
        ["albums", "Top albums"],
        ["artists", "Top artists"],
      ],
    );
  });
});

describe("statsSeeAll", () => {
  test("reads a See all route's ranking and period", () => {
    assert.deepEqual(statsSeeAll("songs", "week"), { ranking: "songs", period: "week" });
    assert.deepEqual(statsSeeAll("albums", "all"), { ranking: "albums", period: "all" });
    assert.deepEqual(statsSeeAll("artists", "year"), { ranking: "artists", period: "year" });
  });

  test("takes the first value of a repeated param", () => {
    assert.deepEqual(statsSeeAll(["artists", "songs"], ["month", "week"]), {
      ranking: "artists",
      period: "month",
    });
  });

  test("rejects an unknown ranking or period", () => {
    assert.equal(statsSeeAll("genres", "week"), undefined);
    assert.equal(statsSeeAll("songs", "decade"), undefined);
    assert.equal(statsSeeAll(undefined, "week"), undefined);
    assert.equal(statsSeeAll("songs", undefined), undefined);
    assert.equal(statsSeeAll("toString", "week"), undefined);
  });
});
