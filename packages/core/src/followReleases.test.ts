import { test } from "node:test";
import assert from "node:assert/strict";
import { followFeed, followReleaseOpening, type FollowRelease } from "./index.ts";
const now = Date.UTC(2026, 9, 29);
const follow = {
  key: "abba",
  name: "ABBA",
  level: "releases" as const,
  followedAt: now,
  deezerId: 1,
  ytBrowseId: null,
};
const release = (key: string, days: number): FollowRelease => ({
  key,
  artistKey: "abba",
  title: key,
  type: "album",
  releaseDate: new Date(now - days * 86400000).toISOString().slice(0, 10),
  artworkUrl: null,
  explicit: false,
  browseId: null,
  videoIds: [],
  recordingKeys: [],
});
test("new releases start at the follow window and stay until played or hidden, newest first", () => {
  const releases = [
    release("old", 31),
    release("boundary", 30),
    release("new", 1),
    release("hidden", 2),
    { ...release("played", 3), videoIds: ["video"] },
  ];
  assert.deepEqual(
    followFeed({
      follows: [follow],
      releases,
      hidden: ["hidden"],
      countedPlays: ["video"],
      now,
    }).releaseCards.map((card) => card.key),
    ["new", "boundary"],
  );
});

test("Library counted recordings, disabled follows and explicit filtering clear cards", () => {
  const r = { ...release("owned", 0), recordingKeys: ["recording"], explicit: true };
  const input = { follows: [follow], releases: [r], hidden: [], countedPlays: [], now };
  assert.equal(followFeed({ ...input, countedPlays: ["recording"] }).releaseCards.length, 0);
  assert.equal(followFeed({ ...input, enabled: false }).releaseCards.length, 0);
  assert.equal(followFeed({ ...input, blockExplicit: true }).releaseCards.length, 0);
});

test("a collaboration release followed through both artists has one cover", () => {
  const r = release("shared", 0);
  const other = { ...follow, key: "other", name: "Other" };
  assert.deepEqual(
    followFeed({
      follows: [follow, other],
      releases: [r, { ...r, artistKey: "other" }],
      hidden: [],
      countedPlays: [],
      now,
    }).releaseCards.map((card) => card.key),
    ["shared"],
  );
});

test("opening a release the Library lacks says why it can't, never 'not on YouTube Music' by default", () => {
  const unmatched = release("Voyage", 1);
  const matched = { ...unmatched, browseId: "MPREb_voyage" };
  const albums = [
    { title: "Voyage", releaseType: "album" as const, browseId: "MPREb_found", artists: ["ABBA"] },
  ];
  // YT Music off: even a matched release says so, before any search.
  assert.deepEqual(followReleaseOpening(matched, { ytMusic: false }), { kind: "ytMusicOff" });
  assert.deepEqual(followReleaseOpening(unmatched, { ytMusic: false }), { kind: "ytMusicOff" });
  assert.deepEqual(followReleaseOpening(matched, { ytMusic: true }), {
    kind: "open",
    browseId: "MPREb_voyage",
  });
  assert.deepEqual(followReleaseOpening(unmatched, { ytMusic: true }), { kind: "search" });
  // Offline or a failed search is no answer; only a real miss is "not on YouTube Music yet".
  assert.deepEqual(followReleaseOpening(unmatched, { ytMusic: true, found: null }), {
    kind: "noAnswer",
  });
  assert.deepEqual(followReleaseOpening(unmatched, { ytMusic: true, found: albums }), {
    kind: "open",
    browseId: "MPREb_found",
  });
  assert.deepEqual(
    followReleaseOpening(unmatched, {
      ytMusic: true,
      found: [{ ...albums[0]!, artists: ["Someone Else"] }],
    }),
    { kind: "notFound" },
  );
  assert.deepEqual(followReleaseOpening(unmatched, { ytMusic: true, found: [] }), {
    kind: "notFound",
  });
  // Switched off while the search ran.
  assert.deepEqual(followReleaseOpening(unmatched, { ytMusic: false, found: null }), {
    kind: "ytMusicOff",
  });
});
