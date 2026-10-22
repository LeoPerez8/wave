import assert from "node:assert/strict";
import { test } from "node:test";
import { ytArtistOpening, type YtArtistSection } from "./index.ts";

const context = {
  name: "Justice",
  enabled: true,
  now: 1000,
  integrated: true,
  settled: false,
  contentReady: true,
};
const empty: YtArtistSection = { status: "ready", saved: null, failure: null };

test("an integrated opening waits for the local content and settlement before asking", () => {
  assert.deepEqual(ytArtistOpening(empty, context), { ask: false, finder: false });
  assert.deepEqual(ytArtistOpening(empty, { ...context, settled: true, contentReady: false }), {
    ask: false,
    finder: false,
  });
  assert.deepEqual(ytArtistOpening(empty, { ...context, settled: true }), {
    ask: true,
    finder: false,
  });
});

const found: YtArtistSection = {
  status: "ready",
  failure: null,
  saved: {
    outcome: "found",
    checkedAt: 1000,
    browseId: "artist",
    page: {
      name: "Justice",
      songs: [],
      allSongs: [],
      albums: [],
      singles: [],
    },
  },
};

test("the finder belongs to shown online additions after settlement, including a saved answer", () => {
  assert.deepEqual(ytArtistOpening(found, context), { ask: false, finder: false });
  assert.deepEqual(ytArtistOpening(found, { ...context, settled: true }), {
    ask: false,
    finder: true,
  });
  for (const override of [
    { pick: "library" as const },
    { enabled: false },
    { contentReady: false },
    { name: "Various Artists" },
    { now: 1000 + 8 * 86400000 },
  ]) {
    assert.equal(ytArtistOpening(found, { ...context, settled: true, ...override }).finder, false);
  }
});

test("ordinary Library opening starts no section work; Online and Always wait for settlement", () => {
  const local = { ...context, integrated: false, settled: true };
  assert.deepEqual(ytArtistOpening(empty, local), { ask: false, finder: false });
  for (const override of [{ pick: "online" as const }, { always: true }]) {
    assert.equal(ytArtistOpening(empty, { ...local, ...override }).ask, true);
    assert.deepEqual(ytArtistOpening(empty, { ...local, ...override, settled: false }), {
      ask: false,
      finder: false,
    });
  }
  assert.deepEqual(ytArtistOpening({ ...empty, failure: "offline" }, context), {
    ask: false,
    finder: false,
  });
});

test("an Online retry waits for content and settlement and cannot escape to another mode", () => {
  const failed: YtArtistSection = { status: "ready", saved: null, failure: "offline" };
  const retry = { ...context, pick: "online" as const, retry: true };
  assert.equal(ytArtistOpening(failed, retry).ask, false);
  assert.equal(ytArtistOpening(failed, { ...retry, settled: true }).ask, true);
  assert.equal(
    ytArtistOpening(failed, { ...retry, settled: true, contentReady: false }).ask,
    false,
  );
  assert.equal(ytArtistOpening(failed, { ...retry, settled: true, pick: "library" }).ask, false);
  assert.equal(ytArtistOpening(failed, { ...retry, settled: true, enabled: false }).ask, false);
});
