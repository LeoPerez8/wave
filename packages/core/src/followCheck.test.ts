import { test } from "node:test";
import assert from "node:assert/strict";
import { dueShowChecks, followCheckDue, showChecksLeftToday } from "./index.ts";

const HOUR = 3_600_000;
const now = Date.parse("2026-11-01T12:00:00Z");
const follow = (key: string, level: "releases" | "shows" = "releases") => ({
  key,
  name: key,
  level,
  followedAt: 0,
  deezerId: null,
  ytBrowseId: null,
});
const base = {
  enabled: true,
  follows: [follow("abba")],
  releaseChecks: [{ key: "abba", checkedAt: now - 13 * HOUR }],
  showChecks: [],
  country: "BR",
  now,
};

test("the daily task waits 24 hours after any check, Home opening 12", () => {
  assert.equal(followCheckDue({ ...base, context: "background" }), false);
  assert.equal(followCheckDue({ ...base, context: "home" }), true);
  const day = { ...base, releaseChecks: [{ key: "abba", checkedAt: now - 24 * HOUR }] };
  assert.equal(followCheckDue({ ...day, context: "background" }), true);
});

test("a switched-off or empty Follows list never checks", () => {
  const due = { ...base, releaseChecks: [] };
  assert.equal(followCheckDue({ ...due, context: "background" }), true);
  assert.equal(followCheckDue({ ...due, enabled: false, context: "background" }), false);
  assert.equal(followCheckDue({ ...due, enabled: false, context: "home" }), false);
  assert.equal(followCheckDue({ ...due, follows: [], context: "background" }), false);
});

test("an unchecked follow is due at once in both contexts", () => {
  const added = { ...base, follows: [follow("abba"), follow("aurora")] };
  assert.equal(followCheckDue({ ...added, context: "background" }), true);
  assert.equal(followCheckDue({ ...added, context: "home" }), true);
});

test("shows-level follows are also due on their shows check and a changed country", () => {
  const shows = {
    ...base,
    follows: [follow("abba", "shows")],
    releaseChecks: [{ key: "abba", checkedAt: now - HOUR }],
    showChecks: [{ key: "abba", country: "BR", checkedAt: now - HOUR }],
    context: "background" as const,
  };
  assert.equal(followCheckDue(shows), false);
  assert.equal(followCheckDue({ ...shows, showChecks: [] }), true);
  assert.equal(followCheckDue({ ...shows, country: "PT" }), true);
  assert.equal(
    followCheckDue({ ...shows, showChecks: [{ key: "abba", country: "BR", checkedAt: 0 }] }),
    true,
  );
  // Without a country (or a Ticketmaster key) shows can't be checked, so they make nothing due.
  assert.equal(followCheckDue({ ...shows, showChecks: [], country: "" }), false);
  // A releases-level follow never waits on shows.
  assert.equal(followCheckDue({ ...shows, follows: [follow("abba")], showChecks: [] }), false);
});

test("a show check asks never-checked artists first, then the oldest check first", () => {
  const due = dueShowChecks({
    follows: [
      follow("abba", "shows"),
      follow("aurora", "shows"),
      follow("bjork"),
      follow("cher", "shows"),
      follow("dido", "shows"),
      follow("enya", "shows"),
      follow("fka", "shows"),
    ],
    showChecks: [
      { key: "abba", country: "BR", checkedAt: now - 30 * HOUR },
      { key: "aurora", country: "BR", checkedAt: now - 48 * HOUR },
      { key: "dido", country: "BR", checkedAt: 0 },
      { key: "enya", country: "PT", checkedAt: now - HOUR },
      { key: "fka", country: "BR", checkedAt: now - HOUR },
    ],
    country: "BR",
    now,
    context: "background",
  });
  // cher was never checked, dido only had its attraction kept, enya was checked in another
  // country; fka was checked an hour ago, so it isn't due.
  assert.deepEqual(
    due.map((f) => f.key),
    ["cher", "dido", "enya", "aurora", "abba"],
  );
});

test("a show check asks 200 artists a UTC day at most, the service's limit", () => {
  const day = Math.floor(now / (24 * HOUR));
  assert.equal(showChecksLeftToday(null, now), 200);
  assert.equal(showChecksLeftToday({ day, count: 150 }, now), 50);
  assert.equal(showChecksLeftToday({ day, count: 200 }, now), 0);
  assert.equal(showChecksLeftToday({ day, count: 250 }, now), 0);
  // Yesterday's count is spent: a new UTC day starts at 200.
  assert.equal(showChecksLeftToday({ day: day - 1, count: 200 }, now), 200);
});
