import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { autoLyricLine, parseLyrics } from "./index.ts";

const synced = parseLyrics("[00:02.00]One\n[00:05.00]Two\n[00:09.00]Three");

const showing = { on: true, carConnected: true } as const;

describe("autoLyricLine", () => {
  test("with the toggle off, the artist shows", () => {
    assert.deepEqual(
      autoLyricLine({ on: false, carConnected: true, lyrics: synced, positionMs: 6_000 }),
      { line: null, nextChangeMs: null },
    );
  });

  test("with the toggle on in the car, the line being sung shows until the next one starts", () => {
    assert.deepEqual(autoLyricLine({ ...showing, lyrics: synced, positionMs: 6_000 }), {
      line: "Two",
      nextChangeMs: 9_000,
    });
  });

  test("before the first line, the artist shows until it starts", () => {
    assert.deepEqual(autoLyricLine({ ...showing, lyrics: synced, positionMs: 500 }), {
      line: null,
      nextChangeMs: 2_000,
    });
  });

  test("a pause between lines shows the artist until the next line", () => {
    const withPause = parseLyrics("[00:02.00]One\n[00:04.00]\n[00:10.00]Two");
    assert.deepEqual(autoLyricLine({ ...showing, lyrics: withPause, positionMs: 6_000 }), {
      line: null,
      nextChangeMs: 10_000,
    });
  });

  test("a track with only unsynced lyrics, or none, keeps the artist", () => {
    for (const lyrics of [parseLyrics("Just words\nNo times"), parseLyrics(""), null]) {
      assert.deepEqual(autoLyricLine({ ...showing, lyrics, positionMs: 6_000 }), {
        line: null,
        nextChangeMs: null,
      });
    }
  });

  test("the last line stays to the end of the track", () => {
    assert.deepEqual(autoLyricLine({ ...showing, lyrics: synced, positionMs: 200_000 }), {
      line: "Three",
      nextChangeMs: null,
    });
  });

  test("lines sung together share the one line", () => {
    const duet = parseLyrics("[00:02.00]Me\n[00:02.00]You");
    assert.equal(autoLyricLine({ ...showing, lyrics: duet, positionMs: 3_000 }).line, "Me / You");
  });

  test("with Auto disconnected, the artist shows even with the toggle on", () => {
    assert.deepEqual(
      autoLyricLine({ on: true, carConnected: false, lyrics: synced, positionMs: 6_000 }),
      { line: null, nextChangeMs: null },
    );
  });
});
