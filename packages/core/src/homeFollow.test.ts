import { test } from "node:test";
import assert from "node:assert/strict";
import {
  homeFollowCards,
  parseHomeFollowSnapshot,
  storedHomeFollowSnapshot,
  type HomeFollowSnapshot,
} from "./index.ts";

const known: HomeFollowSnapshot = {
  follows: [
    { key: "a", name: "A", level: "shows", followedAt: 0, deezerId: null, ytBrowseId: null },
  ],
  releases: [
    {
      key: "r",
      artistKey: "a",
      title: "Release",
      type: "album",
      releaseDate: "2026-10-01",
      artworkUrl: null,
      explicit: false,
      browseId: null,
      videoIds: [],
      recordingKeys: [],
    },
  ],
  shows: [
    {
      id: "s",
      artistKey: "a",
      country: "BR",
      startsAt: "2026-11-01",
      city: "City",
      venue: "Venue",
      ticketUrl: "https://example.com",
    },
  ],
  country: "BR",
};
const now = Date.parse("2026-10-29");
test("Home opens with the last known releases and shows, or no space when nothing is known", () => {
  assert.deepEqual(
    homeFollowCards(known, { now }).releaseCards.map((r) => r.key),
    ["r"],
  );
  assert.deepEqual(
    homeFollowCards(known, { now }).showCards.map((s) => s.id),
    ["s"],
  );
  assert.deepEqual(homeFollowCards(undefined, { now }), { releaseCards: [], showCards: [] });
});
test("new cards wait while Home is visible, then appear on the next opening", () => {
  const latest = {
    ...known,
    releases: [...known.releases, { ...known.releases[0]!, key: "new" }],
    shows: [...known.shows, { ...known.shows[0]!, id: "new-show" }],
  };
  const visible = homeFollowCards(latest, { now, admitted: known });
  assert.deepEqual(
    visible.releaseCards.map((r) => r.key),
    ["r"],
  );
  assert.deepEqual(
    visible.showCards.map((s) => s.id),
    ["s"],
  );
  assert.equal(homeFollowCards(latest, { now }).releaseCards.length, 2);
  assert.equal(homeFollowCards(latest, { now }).showCards.length, 2);
  assert.deepEqual(
    homeFollowCards(latest, { now, admitted: { ...known, releases: [], shows: [] } }),
    { releaseCards: [], showCards: [] },
  );
});

test("cached cards survive restart and malformed storage is ignored", () => {
  assert.deepEqual(parseHomeFollowSnapshot(storedHomeFollowSnapshot(known)), known);
  for (const value of [null, "bad json", "{}", '{"follows":[null]}'])
    assert.equal(parseHomeFollowSnapshot(value), undefined);
});
test("removals, explicit blocking, country changes and past shows apply without admitting new cards", () => {
  assert.deepEqual(
    homeFollowCards({ ...known, releases: [], shows: [] }, { now, admitted: known }),
    { releaseCards: [], showCards: [] },
  );
  assert.deepEqual(homeFollowCards(known, { now, enabled: false }), {
    releaseCards: [],
    showCards: [],
  });
  assert.equal(homeFollowCards(known, { now, country: "US" }).showCards.length, 0);
  assert.equal(homeFollowCards(known, { now: Date.parse("2026-11-02") }).showCards.length, 0);
  assert.equal(
    homeFollowCards(
      { ...known, releases: [{ ...known.releases[0]!, explicit: true }] },
      { now, blockExplicit: true },
    ).releaseCards.length,
    0,
  );
});

test("the phone cache bounds each shelf and keeps only the artists needed to draw it", () => {
  const saved = parseHomeFollowSnapshot(
    storedHomeFollowSnapshot({
      ...known,
      follows: [...known.follows, { ...known.follows[0]!, key: "unused" }],
      releases: Array.from({ length: 201 }, (_, i) => ({ ...known.releases[0]!, key: `r${i}` })),
      shows: Array.from({ length: 201 }, (_, i) => ({ ...known.shows[0]!, id: `s${i}` })),
    }),
  )!;
  assert.equal(saved.releases.length, 200);
  assert.equal(saved.shows.length, 200);
  assert.deepEqual(
    saved.follows.map((f) => f.key),
    ["a"],
  );
});

test("following and unfollowing keep the opening cards until the next Home visit", () => {
  const unfollowed = { ...known, follows: [] };
  const visible = homeFollowCards(unfollowed, { now, admitted: known });
  assert.deepEqual(
    visible.releaseCards.map((r) => r.key),
    ["r"],
  );
  assert.deepEqual(
    visible.showCards.map((s) => s.id),
    ["s"],
  );
  assert.deepEqual(homeFollowCards(unfollowed, { now }), { releaseCards: [], showCards: [] });
});

test("an unfollowed visit still removes hidden releases, counted plays and expired shows", () => {
  const source = { ...known, follows: [], releases: [{ ...known.releases[0]!, videoIds: ["v"] }] };
  assert.equal(
    homeFollowCards(source, { now, admitted: known, hidden: ["r"] }).releaseCards.length,
    0,
  );
  assert.equal(
    homeFollowCards(source, { now, admitted: known, countedPlays: ["v"] }).releaseCards.length,
    0,
  );
  assert.equal(
    homeFollowCards(source, { now: Date.parse("2026-11-02"), admitted: known }).showCards.length,
    0,
  );
});
