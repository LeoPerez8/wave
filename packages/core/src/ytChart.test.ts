import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { parseYtChart, storedYtChart, withYtChartRead, ytChartReadDue } from "./index.ts";

const DAY = 24 * 60 * 60 * 1000;
const now = new Date(2026, 9, 28, 12).getTime();
const artist = (name: string) => ({ name, browseId: `UC-${name}` });
const TOP = [artist("Henrique & Juliano"), artist("MC Ryan SP"), artist("Marília Mendonça")];

describe("YouTube Music's chart", () => {
  test("is read when none is kept, then once a week", () => {
    assert.equal(ytChartReadDue(null, { now }), true);
    const kept = withYtChartRead(null, TOP, now);
    assert.equal(ytChartReadDue(kept, { now: now + 6 * DAY }), false);
    assert.equal(ytChartReadDue(kept, { now: now + 7 * DAY }), true);
  });

  test("is read again when the clock went back past the last read", () => {
    const kept = withYtChartRead(null, TOP, now);
    assert.equal(ytChartReadDue(kept, { now: now - DAY }), true);
  });

  test("after a failed read, waits ten minutes before asking again", () => {
    assert.equal(ytChartReadDue(null, { now, failedAt: now - 9 * 60 * 1000 }), false);
    assert.equal(ytChartReadDue(null, { now, failedAt: now - 10 * 60 * 1000 }), true);
  });

  test("keeps the read's top artists, in the chart's order", () => {
    assert.deepEqual(withYtChartRead(null, TOP, now), { readAt: now, artists: TOP });
  });

  test("a read with no artists leaves the last kept chart", () => {
    const kept = withYtChartRead(null, TOP, now);
    assert.equal(withYtChartRead(kept, [], now + 8 * DAY), kept);
    assert.equal(withYtChartRead(null, [], now), null);
  });

  test("keeps forty artists at most", () => {
    const many = Array.from({ length: 50 }, (_, at) => artist(`Artist ${at}`));
    assert.equal(withYtChartRead(null, many, now)?.artists.length, 40);
  });

  test("is saved on the phone and read back", () => {
    const kept = withYtChartRead(null, TOP, now);
    assert.deepEqual(parseYtChart(storedYtChart(kept)), kept);
    assert.equal(storedYtChart(null), null);
    assert.equal(parseYtChart(null), null);
    assert.equal(parseYtChart("not json"), null);
    assert.equal(parseYtChart(JSON.stringify({ readAt: "soon", artists: [] })), null);
    assert.deepEqual(
      parseYtChart(JSON.stringify({ readAt: now, artists: [["A", "UC-A"], ["broken"], 3] })),
      { readAt: now, artists: [{ name: "A", browseId: "UC-A" }] },
    );
  });
});
