import assert from "node:assert/strict";
import test from "node:test";
import { magicBatchLine } from "./index.ts";

test("an empty pick says the seed's genre was unknown and how many songs each source let through", () => {
  assert.equal(
    magicBatchLine({
      first: true,
      ms: 10648,
      outcome: {
        kind: "empty",
        seedGenre: false,
        step: "Balanced",
        library: { weighed: 2481, admitted: 0 },
        yt: { ranked: 0, eligible: 0 },
        refill: null,
      },
    }),
    "Magic Queue first batch: 10648ms (no songs: the seed's genre is unknown; Library 0 of 2,481 songs pass Balanced; YouTube Music 0 of 0 candidates pass; no refill)",
  );
});

test("a pick that lands, one dropped, one that failed and a refill each read as they happened", () => {
  const line = (outcome: Parameters<typeof magicBatchLine>[0]["outcome"]) =>
    magicBatchLine({ first: false, ms: 1829, outcome });
  assert.equal(
    line({ kind: "appended", songs: 10 }),
    "Magic Queue next batch: 1829ms (10 songs appended)",
  );
  assert.equal(
    line({ kind: "appended", songs: 1 }),
    "Magic Queue next batch: 1829ms (1 song appended)",
  );
  assert.equal(line({ kind: "dropped" }), "Magic Queue next batch: 1829ms (no longer wanted)");
  assert.equal(
    line({ kind: "failed", reason: "TimeoutError" }),
    "Magic Queue next batch: 1829ms (failed: TimeoutError)",
  );
  assert.equal(
    line({
      kind: "empty",
      seedGenre: true,
      step: "Same genres",
      library: { weighed: 2481, admitted: 0 },
      yt: { ranked: 1204, eligible: 0 },
      refill: 1,
    }),
    "Magic Queue next batch: 1829ms (no songs: the seed's genre is known; Library 0 of 2,481 songs pass Same genres; YouTube Music 0 of 1,204 candidates pass; the refill brought 1 song)",
  );
});
