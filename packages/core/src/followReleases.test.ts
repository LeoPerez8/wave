import { test } from "node:test";
import assert from "node:assert/strict";
import {
  followAlbumOpening,
  followFeed,
  followReleaseOpening,
  followReleaseQuery,
  followReleasesToSearch,
  type FollowRelease,
  unmatchFollowRelease,
} from "./index.ts";
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
    { ...release("boundary", 30), browseId: "MPREb_boundary" },
    { ...release("new", 1), browseId: "MPREb_new" },
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
  const r = { ...release("shared", 0), browseId: "MPREb_shared" };
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

test("only a release the owner can play shows: in the Library, or matched on YT Music while it's on", () => {
  const releases = [
    { ...release("matched", 1), browseId: "MPREb_matched" },
    release("unmatched", 2),
    { ...release("owned", 3), libraryAlbumId: 4 },
  ];
  const input = { follows: [follow], releases, hidden: [], countedPlays: [], now };
  assert.deepEqual(
    followFeed({ ...input, ytMusic: true }).releaseCards.map((card) => card.key),
    ["matched", "owned"],
  );
  assert.deepEqual(
    followFeed({ ...input, ytMusic: false }).releaseCards.map((card) => card.key),
    ["owned"],
  );
});

test("a check searches each eligible release without a match or Library album, newest first", () => {
  const other = { ...follow, key: "other", name: "Other" };
  const releases = [
    release("older", 5),
    { ...release("matched", 1), browseId: "MPREb_matched" },
    { ...release("owned", 2), libraryAlbumId: 4 },
    release("hidden", 2),
    release("outside window", 40),
    { ...release("played", 3), videoIds: ["video"] },
    release("newest", 0),
    { ...release("by other", 4), artistKey: "other" },
    { ...release("newest", 0), artistKey: "other" },
    { ...release("unfollowed", 1), artistKey: "nobody" },
  ];
  assert.deepEqual(
    followReleasesToSearch({
      follows: [follow, other],
      releases,
      hidden: ["hidden"],
      countedPlays: ["video"],
      now,
    }).map((r) => r.key),
    ["newest", "by other", "older"],
  );
});

test("a release's search asks for its artist and title", () => {
  assert.equal(followReleaseQuery(release("Voyage", 1), "ABBA"), "ABBA Voyage");
});

test("a matched release is gone only when YT Music answers without its album or songs; otherwise it opens", () => {
  const open = { kind: "open", browseId: "MPREb_v" };
  assert.deepEqual(followAlbumOpening("MPREb_v", { videoIds: ["a"] }), open);
  // No answer (offline, a passing error) opens the page, which says why itself; the match stays.
  assert.deepEqual(followAlbumOpening("MPREb_v", "noAnswer"), open);
  assert.deepEqual(followAlbumOpening("MPREb_v", "missing"), { kind: "gone" });
  assert.deepEqual(followAlbumOpening("MPREb_v", { videoIds: [] }), { kind: "gone" });
});

test("a release whose album is gone loses its match and songs, and hides until a search finds it", () => {
  const gone = { ...release("Voyage", 1), browseId: "MPREb_v", videoIds: ["a"] };
  const kept = { ...release("Other", 2), browseId: "MPREb_o", videoIds: ["b"] };
  const releases = unmatchFollowRelease([gone, kept], "Voyage");
  assert.deepEqual(
    releases.map((r) => [r.key, r.browseId, r.videoIds]),
    [
      ["Voyage", null, []],
      ["Other", "MPREb_o", ["b"]],
    ],
  );
  const input = { follows: [follow], releases, hidden: [], countedPlays: [], now };
  assert.deepEqual(
    followFeed(input).releaseCards.map((r) => r.key),
    ["Other"],
  );
  assert.deepEqual(
    followReleasesToSearch(input).map((r) => r.key),
    ["Voyage"],
  );
});
