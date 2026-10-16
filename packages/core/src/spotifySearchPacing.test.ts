import assert from "node:assert/strict";
import { test } from "node:test";

import { nextSpotifySearch } from "./index.ts";

test("spaces Spotify import searches at least half a second apart", () => {
  const first = nextSpotifySearch({ searchesAt: [] }, 1000);
  assert.equal(first.kind, "search");
  if (first.kind !== "search") return;
  assert.deepEqual(nextSpotifySearch(first.pacing, 1499), { kind: "wait", untilMs: 1500 });
  assert.equal(nextSpotifySearch(first.pacing, 1500).kind, "search");
});

test("allows at most 1,200 searches in any fifteen minute window, including retries", () => {
  let pacing = { searchesAt: [] as readonly number[] };
  for (let index = 0; index < 1200; index += 1) {
    const next = nextSpotifySearch(pacing, index * 500);
    assert.equal(next.kind, "search");
    if (next.kind === "search") pacing = next.pacing;
  }
  assert.deepEqual(nextSpotifySearch(pacing, 600_000), { kind: "wait", untilMs: 900_000 });
  const resumed = nextSpotifySearch(pacing, 900_000);
  assert.equal(resumed.kind, "search");
  if (resumed.kind !== "search") return;
  assert.deepEqual(nextSpotifySearch(resumed.pacing, 900_499), { kind: "wait", untilMs: 900_500 });
  assert.equal(nextSpotifySearch(resumed.pacing, 900_500).kind, "search");
});
