process.env.TZ = "America/Sao_Paulo";
import assert from "node:assert/strict";
import { test } from "node:test";
import { availableRecaps, createRecapAvailability, recapToAnnounce } from "./index.ts";

const hour = 3_600_000;
const at = (year: number, month: number, day: number, h = 0, m = 0) =>
  new Date(year, month - 1, day, h, m).getTime();

test("incremental availability preserves local thresholds, December/January order and opened rules", () => {
  const listening = [
    { startedAt: at(2026, 9, 30, 23, 45), listenedMs: 3 * hour },
    { startedAt: at(2026, 11, 1), listenedMs: 3 * hour - 1 },
    { startedAt: at(2026, 11, 30, 23, 45), listenedMs: 1 },
    { startedAt: at(2026, 12, 2), listenedMs: 14 * hour },
  ];
  for (const now of [at(2026, 10, 1), at(2026, 11, 30, 23, 59), at(2026, 12, 1), at(2027, 1, 1)]) {
    const build = createRecapAvailability();
    for (const entry of listening) build.add(entry);
    const steps = build.finish(now);
    let next = steps.next();
    while (!next.done) next = steps.next();
    assert.deepEqual(next.value, availableRecaps(listening, now));
    if (now === at(2026, 12, 1)) {
      assert.deepEqual(next.value, [
        { kind: "year", year: 2026 },
        { kind: "month", year: 2026, month: 11 },
        { kind: "month", year: 2026, month: 9 },
      ]);
      assert.deepEqual(recapToAnnounce(next.value, ["2026"]), {
        kind: "month",
        year: 2026,
        month: 11,
      });
      assert.equal(recapToAnnounce(next.value, ["2026", "2026-11"]), null);
    }
  }
});
