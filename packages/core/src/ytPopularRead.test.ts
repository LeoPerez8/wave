import assert from "node:assert/strict";
import { test } from "node:test";
import { NO_SEARCHES, SEARCH_ALLOWANCE, SEARCH_WINDOW_MS, ytPopularReadDue } from "./index.ts";

const context = {
  name: "Justice",
  enabled: true,
  onlineSelected: true,
  online: true,
  settled: true,
  contentReady: true,
  saved: null,
  asked: new Set<string>(),
  allowance: NO_SEARCHES,
  now: 1000,
};

test("Popular needs Online, usable connectivity, settled content and room in the shared allowance", () => {
  assert.equal(ytPopularReadDue(context), true);
  for (const blocked of [
    { enabled: false },
    { onlineSelected: false },
    { online: false },
    { settled: false },
    { contentReady: false },
    { name: "Various Artists" },
    { name: "Unknown Artist" },
    { name: "!!!" },
    { allowance: { ...NO_SEARCHES, searchesAt: Array(SEARCH_ALLOWANCE).fill(1000) } },
  ])
    assert.equal(ytPopularReadDue({ ...context, ...blocked }), false);
});

test("a full saved list needs no Popular read, even expired or empty; partial pages are due", () => {
  const page = { name: "Justice", songs: [], albums: [], singles: [] };
  const partial = { outcome: "found" as const, checkedAt: 0, browseId: "artist", page };
  assert.equal(ytPopularReadDue({ ...context, saved: partial }), true);
  assert.equal(
    ytPopularReadDue({ ...context, saved: { ...partial, page: { ...page, allSongs: [] } } }),
    false,
  );
  assert.equal(
    ytPopularReadDue({ ...context, saved: { outcome: "unmatched", checkedAt: 0 } }),
    false,
  );
});

test("attempts are per normalized artist per opening; an expired allowance stops blocking", () => {
  const asked = new Set(["justice"]);
  assert.equal(ytPopularReadDue({ ...context, name: " JUSTICE ", asked }), false);
  assert.equal(ytPopularReadDue({ ...context, name: "Portishead", asked }), true);
  assert.equal(ytPopularReadDue(context), true, "another opening has its own attempts");
  const allowance = { ...NO_SEARCHES, searchesAt: Array(SEARCH_ALLOWANCE).fill(1000) };
  assert.equal(
    ytPopularReadDue({ ...context, allowance, now: 1000 + SEARCH_WINDOW_MS - 1 }),
    false,
  );
  assert.equal(ytPopularReadDue({ ...context, allowance, now: 1000 + SEARCH_WINDOW_MS }), true);
});
