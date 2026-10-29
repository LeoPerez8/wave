import { test } from "node:test";
import assert from "node:assert/strict";
import { followCheckDue } from "./index.ts";

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
