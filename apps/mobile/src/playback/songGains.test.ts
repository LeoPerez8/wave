/// <reference types="node" />
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { reduceQueue, EMPTY_QUEUE, type SongLoudness } from "@wave/core";

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

test("album completion refreshes every held context entry, while manual occurrences keep track gain", () => {
  const state = reduceQueue(EMPTY_QUEUE, {
    type: "play",
    trackIds: ["7", "8"],
    startIndex: 0,
    context: { kind: "album", id: "42" },
  }).state;
  const entries = [...state.entries, { key: "manual", trackId: "7", contextIndex: null }];
  const gains = createEntryGains();
  const loudness = new Map([
    [7, tagged(3)],
    [8, tagged(-8)],
  ]);
  const album = {
    id: "42",
    songs: [
      { id: 7, durationMs: 1_000, trackGainDb: 3, albumGainDb: -4, albumPeak: 1 },
      { id: 8, durationMs: 9_000, trackGainDb: -8, albumGainDb: -4, albumPeak: 1 },
    ],
  };
  for (const entry of entries) gains.withItem(entry, loudness, { state, album: null });
  assert.deepEqual(gains.changes(entries, loudness, { state, album }), [
    { key: entries[0]!.key, gainDb: -4, gainSource: "albumTag" },
    { key: entries[1]!.key, gainDb: -4, gainSource: "albumTag" },
  ]);
  // The native stage keeps the currently playing decision; all future starts get track gain.
  assert.deepEqual(
    gains.changes(entries, loudness, { state: { ...state, shuffle: true }, album }),
    [
      { key: entries[0]!.key, gainDb: -0, gainSource: "tag" },
      { key: entries[1]!.key, gainDb: -8, gainSource: "tag" },
    ],
  );
});
