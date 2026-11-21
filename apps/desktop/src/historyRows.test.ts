import assert from "node:assert/strict";
import { test } from "node:test";
import { historyItems, historyWindow } from "./renderer/src/historyRows.ts";

const at = (day: number, hour: number) => new Date(2026, 10, day, hour).getTime();
const now = at(20, 18);

test("history rows sit under day headers, each at its own offset", () => {
  const plays = [
    { id: 4, startedAt: at(20, 9) },
    { id: 3, startedAt: at(20, 8) },
    { id: 2, startedAt: at(19, 22) },
    { id: 1, startedAt: at(12, 10) },
  ];
  const { items, height } = historyItems(plays, now, "en");
  assert.deepEqual(
    items.map((item) => [item.kind === "day" ? item.title : item.play.id, item.top]),
    [
      ["Today", 0],
      [4, 44],
      [3, 84],
      ["Yesterday", 124],
      [2, 168],
      ["November 12", 208],
      [1, 252],
    ],
  );
  assert.equal(height, 292);
});

test("only the rows in view, and a few around them, are drawn", () => {
  const plays = Array.from({ length: 5000 }, (_, i) => ({ id: 5000 - i, startedAt: now - i }));
  const { items } = historyItems(plays, now, "en");
  // One header, then 40px rows: the row at 44 + 40 * 1000 leads a 400px viewport.
  const { start, end } = historyWindow(items, 44 + 40 * 1000, 400);
  assert.equal(items[start + 5]?.top, 44 + 40 * 1000);
  assert.equal(end - start, 20);
  assert.deepEqual(historyWindow(items, 0, 400), { start: 0, end: 15 });
  assert.deepEqual(historyWindow([], 0, 400), { start: 0, end: 0 });
});
