import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { compareSongReadOrder, createSearchIndexFollower, type SearchIndexJob } from "./index.ts";

type Source = "songs" | "albums" | "playlists";

const follower = () =>
  createSearchIndexFollower<Source>({
    sources: {
      songs: { tracks: true },
      albums: { tracks: true },
      playlists: { playlists: true, tracks: true },
    },
    patchable: "songs",
    throttleMs: 1500,
  });

/** Runs every job due at [now], each settling at once; returns them. */
const drain = (
  follow: ReturnType<typeof follower>,
  now: number,
  ok = true,
): (SearchIndexJob<Source> | { wait: number })[] => {
  const jobs: (SearchIndexJob<Source> | { wait: number })[] = [];
  for (;;) {
    const next = follow.next(now);
    if (next === null) return jobs;
    jobs.push(next);
    if ("wait" in next) return jobs;
    follow.done(next, now, ok);
  }
};

/** The job [next] gave, failing the test when it gave none or a wait. */
const jobOf = (
  next: SearchIndexJob<Source> | { readonly wait: number } | null,
): SearchIndexJob<Source> => {
  assert.ok(next !== null && !("wait" in next), "a job is due");
  return next;
};

const built = () => {
  const follow = follower();
  drain(follow, 0);
  return follow;
};

describe("search index follower", () => {
  test("first reads every source, one at a time, in the order given", () => {
    const follow = follower();
    const first = follow.next(0);
    assert.deepEqual(first, { kind: "read", source: "songs" });
    assert.equal(follow.next(0), null, "one job at a time");
    follow.done(first!, 0, true);
    assert.deepEqual(drain(follow, 0), [
      { kind: "read", source: "albums" },
      { kind: "read", source: "playlists" },
    ]);
    assert.equal(follow.next(0), null);
  });

  test("an edit re-reads the sources it reaches at once, and only those", () => {
    const follow = built();
    follow.change({ kind: "playlists", ids: [3] }, 10);
    assert.deepEqual(drain(follow, 10), [{ kind: "read", source: "playlists" }]);
    follow.change({ kind: "tracks", ids: [7] }, 20);
    assert.deepEqual(drain(follow, 20), [
      { kind: "read", source: "songs" },
      { kind: "read", source: "albums" },
      { kind: "read", source: "playlists" },
    ]);
  });

  test("a change no source reads (a favorite, a play) asks nothing", () => {
    const follow = built();
    follow.change({ kind: "favorites", ids: [7] }, 10);
    follow.change({ kind: "plays", ids: [7], burst: true }, 10);
    assert.deepEqual(drain(follow, 10), []);
  });

  test("a scan batch or a download patches its songs in; the other sources follow at most once per throttle", () => {
    const follow = built();
    follow.change({ kind: "tracks", ids: [7, 8], burst: true }, 100);
    assert.deepEqual(drain(follow, 100), [
      { kind: "patch", source: "songs", ids: [7, 8] },
      { kind: "read", source: "albums" },
      { kind: "read", source: "playlists" },
    ]);
    follow.change({ kind: "tracks", ids: [9], burst: true }, 600);
    assert.deepEqual(drain(follow, 600), [
      { kind: "patch", source: "songs", ids: [9] },
      { wait: 1000 },
    ]);
    assert.deepEqual(drain(follow, 1600), [
      { kind: "read", source: "albums" },
      { kind: "read", source: "playlists" },
    ]);
  });

  test("a burst naming no songs reads the songs again, throttled like the others", () => {
    const follow = built();
    follow.change({ kind: "tracks", burst: true }, 100);
    assert.deepEqual(
      drain(follow, 100).map((job) => ("wait" in job ? "wait" : `${job.kind} ${job.source}`)),
      ["read songs", "read albums", "read playlists"],
    );
  });

  test("songs landing while the songs are read are patched in after that read", () => {
    const follow = follower();
    const read = jobOf(follow.next(0));
    follow.change({ kind: "tracks", ids: [5], burst: true }, 1);
    follow.done(read, 2, true);
    assert.deepEqual(drain(follow, 2), [
      { kind: "read", source: "albums" },
      { kind: "read", source: "playlists" },
      { kind: "patch", source: "songs", ids: [5] },
    ]);
  });

  test("songs landing before the first read starts are left to it", () => {
    const follow = follower();
    follow.change({ kind: "tracks", ids: [5], burst: true }, 0);
    const jobs = drain(follow, 0);
    assert.deepEqual(jobs[0], { kind: "read", source: "songs" });
    assert.ok(!jobs.some((job) => "kind" in job && job.kind === "patch"));
  });

  test("an edit while its source is read reads it again after, its result being out of date", () => {
    const follow = built();
    follow.change({ kind: "playlists" }, 10);
    const read = jobOf(follow.next(10));
    follow.change({ kind: "playlists" }, 11);
    follow.done(read, 12, true);
    assert.deepEqual(drain(follow, 12), [{ kind: "read", source: "playlists" }]);
  });

  test("a failed read is tried again after the throttle; a failed patch reads the songs again", () => {
    const follow = follower();
    const read = jobOf(follow.next(0));
    follow.done(read, 0, false);
    drain(follow, 0);
    assert.deepEqual(follow.next(0), { wait: 1500 });
    assert.deepEqual(follow.next(1500), { kind: "read", source: "songs" });

    const later = built();
    later.change({ kind: "tracks", ids: [1], burst: true }, 10);
    const patch = jobOf(later.next(10));
    later.done(patch, 10, false);
    assert.deepEqual(later.next(10), { kind: "read", source: "songs" });
  });

  test("ready says whether every source has been read once", () => {
    const follow = follower();
    assert.equal(follow.ready(), false);
    drain(follow, 0);
    assert.equal(follow.ready(), true);
  });
});

test("songs are ordered as the songs list reads them: title, artist, then path, a missing file first", () => {
  const song = (titleSort: string, artistSort: string, path: string | null) => ({
    titleSort,
    artistSort,
    path,
  });
  const songs = [
    song("intro", "bjork", "/b.mp3"),
    song("intro", "beyonce", "/z.mp3"),
    song("halo", "beyonce", "/h.mp3"),
    song("intro", "bjork", null),
    song("Intro", "abba", "/a.mp3"),
  ];
  // oxlint-disable-next-line unicorn/no-array-sort -- sorts a fresh array
  assert.deepEqual([...songs].sort(compareSongReadOrder), [
    song("Intro", "abba", "/a.mp3"),
    song("halo", "beyonce", "/h.mp3"),
    song("intro", "beyonce", "/z.mp3"),
    song("intro", "bjork", null),
    song("intro", "bjork", "/b.mp3"),
  ]);
});
