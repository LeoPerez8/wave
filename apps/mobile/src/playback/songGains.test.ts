/// <reference types="node" />
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { SongLoudness } from "@wave/core";

import { createEntryGains, playerGain } from "./songGains.ts";

const tagged = (trackGainDb: number, trackPeak: number | null = 1): SongLoudness => ({
  trackGainDb,
  trackPeak,
});

describe("playerGain", () => {
  test("a Library song with a value gets its capped gain, named by its source", () => {
    const loudness = new Map([[7, tagged(9, 0.5)]]);
    const gain = playerGain({ trackId: "7" }, loudness);
    assert.equal(gain.gainSource, "tag");
    assert.ok(Math.abs((gain.gainDb ?? 0) - 6.0206) < 0.001);
  });

  test("a song with no value, and a streamed song, get none: the player gives them the typical gain or YouTube's", () => {
    const loudness = new Map([[7, tagged(-3)]]);
    assert.deepEqual(playerGain({ trackId: "8" }, loudness), { gainDb: null, gainSource: null });
    assert.deepEqual(playerGain({ trackId: "yt:abc" }, loudness), {
      gainDb: null,
      gainSource: null,
    });
  });
});

describe("createEntryGains", () => {
  const entries = [
    { key: "a", trackId: "7" },
    { key: "b", trackId: "8" },
    // The same song twice in the queue: each entry gets it.
    { key: "c", trackId: "7" },
    { key: "d", trackId: "yt:abc" },
  ];

  test("a value learned after the queue was pushed goes to every entry of its song, once", () => {
    const gains = createEntryGains();
    for (const entry of entries) gains.withItem(entry, new Map());
    const learned = new Map([[7, tagged(-6)]]);
    assert.deepEqual(gains.changes(entries, learned), [
      { key: "a", gainDb: -6, gainSource: "tag" },
      { key: "c", gainDb: -6, gainSource: "tag" },
    ]);
    // Nothing new: nothing to send.
    assert.deepEqual(gains.changes(entries, learned), []);
  });

  test("a song whose tags are gone loses its gain", () => {
    const gains = createEntryGains();
    gains.withItem(entries[0]!, new Map([[7, tagged(-6)]]));
    assert.deepEqual(gains.changes([entries[0]!], new Map()), [
      { key: "a", gainDb: null, gainSource: null },
    ]);
  });

  test("entries the queue's item already carried the gain of aren't sent again", () => {
    const gains = createEntryGains();
    const loudness = new Map([[7, tagged(-6)]]);
    assert.deepEqual(gains.withItem(entries[0]!, loudness), { gainDb: -6, gainSource: "tag" });
    assert.deepEqual(gains.changes([entries[0]!], loudness), []);
  });

  test("entries the player held before JS started get their gains", () => {
    const gains = createEntryGains();
    assert.deepEqual(gains.changes(entries, new Map([[7, tagged(-6)]])), [
      { key: "a", gainDb: -6, gainSource: "tag" },
      { key: "b", gainDb: null, gainSource: null },
      { key: "c", gainDb: -6, gainSource: "tag" },
    ]);
  });

  test("an entry the player dropped is forgotten, and gets its gain again if it comes back", () => {
    const gains = createEntryGains();
    const loudness = new Map([[7, tagged(-6)]]);
    gains.withItem(entries[0]!, loudness);
    gains.retain(["b"]);
    assert.deepEqual(gains.changes([entries[0]!], loudness), [
      { key: "a", gainDb: -6, gainSource: "tag" },
    ]);
  });
});
