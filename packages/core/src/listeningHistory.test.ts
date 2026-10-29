import assert from "node:assert/strict";
import { test } from "node:test";

import { listeningHistoryDays } from "./index.ts";

const at = (year: number, month: number, day: number, hour = 12) =>
  new Date(year, month - 1, day, hour).getTime();

test("history groups local calendar days, newest first, with familiar day headers", () => {
  const plays = [
    { id: 1, startedAt: at(2025, 12, 31) },
    { id: 2, startedAt: at(2026, 10, 18) },
    { id: 3, startedAt: at(2026, 10, 19) },
    { id: 4, startedAt: at(2026, 10, 24) },
    { id: 5, startedAt: at(2026, 10, 25, 1) },
    { id: 6, startedAt: at(2026, 10, 25, 15) },
  ];
  const days = listeningHistoryDays(plays, at(2026, 10, 25, 16));
  assert.deepEqual(
    days.map(({ title, plays: entries }) => [title, entries.map(({ id }) => id)]),
    [
      ["Today", [6, 5]],
      ["Yesterday", [4]],
      ["Monday", [3]],
      ["October 18", [2]],
      ["December 31, 2025", [1]],
    ],
  );
});

test("midnight and the year boundary use local dates, and adjacent pages share a day key", () => {
  const now = new Date(2026, 0, 1, 0, 5).getTime();
  const late = { startedAt: new Date(2025, 11, 31, 23, 59).getTime() };
  const early = { startedAt: new Date(2025, 11, 31, 0, 1).getTime() };
  assert.equal(listeningHistoryDays([late], now)[0]?.title, "Yesterday");
  assert.equal(
    listeningHistoryDays([late], now)[0]?.key,
    listeningHistoryDays([early], now)[0]?.key,
  );
  assert.equal(listeningHistoryDays([{ startedAt: now }], now)[0]?.title, "Today");
  assert.deepEqual(listeningHistoryDays([], now), []);
});

test("a yesterday with 25 hours and a spring day with 23 hours keep their calendar headers", () => {
  // Run this suite in America/New_York as well: these days straddle both DST changes.
  assert.equal(
    listeningHistoryDays([{ startedAt: at(2026, 11, 1, 0) }], at(2026, 11, 2, 0))[0]?.title,
    "Yesterday",
  );
  assert.equal(
    listeningHistoryDays([{ startedAt: at(2026, 3, 7, 23) }], at(2026, 3, 9, 0))[0]?.title,
    "Saturday",
  );
});

test("Portuguese history formats calendar headings without changing grouping", () => {
  const days = listeningHistoryDays(
    [
      { startedAt: at(2026, 10, 19) },
      { startedAt: at(2026, 10, 18) },
      { startedAt: at(2025, 12, 31) },
    ],
    at(2026, 10, 25),
    "pt-BR",
  );
  assert.deepEqual(
    days.map((day) => day.title),
    ["segunda-feira", "18 de outubro", "31 de dezembro de 2025"],
  );
});
