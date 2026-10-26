import assert from "node:assert/strict";
import { test } from "node:test";

import { listeningHistoryDays } from "./index.ts";

test("history groups local calendar days, newest first, with familiar day headers", () => {
  const at = (year: number, month: number, day: number, hour = 12) =>
    new Date(year, month - 1, day, hour).getTime();
  const plays = [
    { id: 1, startedAt: at(2025, 12, 31) },
    { id: 2, startedAt: at(2026, 10, 18) },
    { id: 3, startedAt: at(2026, 10, 19) },
    { id: 4, startedAt: at(2026, 10, 24) },
    { id: 5, startedAt: at(2026, 10, 25, 1) },
    { id: 6, startedAt: at(2026, 10, 25, 15) },
  ];
  const days = listeningHistoryDays(plays, at(2026, 10, 25, 16));
  assert.deepEqual(days.map(({ title, plays }) => [title, plays.map(({ id }) => id)]), [
    ["Today", [6, 5]],
    ["Yesterday", [4]],
    ["Monday", [3]],
    ["October 18", [2]],
    ["December 31, 2025", [1]],
  ]);
});
