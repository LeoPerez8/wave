import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { autoLyricLines, parseLyrics } from "./index.ts";

const synced = parseLyrics("[00:02.00]One\n[00:05.00]Two\n[00:09.00]Three");

const showing = { on: true, carConnected: true } as const;

const COVER = { lines: null, nextChangeMs: null };

describe("autoLyricLines", () => {
  test("the line being sung shows with its neighbours until the next one starts", () => {
    assert.deepEqual(autoLyricLines({ ...showing, lyrics: synced, positionMs: 6_000 }), {
      lines: { previous: "One", current: "Two", next: "Three" },
      nextChangeMs: 9_000,
    });
  });

  test("with the toggle off, the cover shows", () => {
    assert.deepEqual(
      autoLyricLines({ on: false, carConnected: true, lyrics: synced, positionMs: 6_000 }),
      COVER,
    );
  });

  test("with Auto disconnected, the cover shows even with the toggle on", () => {
    assert.deepEqual(
      autoLyricLines({ on: true, carConnected: false, lyrics: synced, positionMs: 6_000 }),
      COVER,
    );
  });

  test("before the first line, the cover shows until it starts", () => {
    assert.deepEqual(autoLyricLines({ ...showing, lyrics: synced, positionMs: 500 }), {
      lines: null,
      nextChangeMs: 2_000,
    });
  });

  test("the first line has nothing above it, and the last nothing below, to the end of the track", () => {
    assert.deepEqual(autoLyricLines({ ...showing, lyrics: synced, positionMs: 2_000 }).lines, {
      previous: null,
      current: "One",
      next: "Two",
    });
    assert.deepEqual(autoLyricLines({ ...showing, lyrics: synced, positionMs: 200_000 }), {
      lines: { previous: "Two", current: "Three", next: null },
      nextChangeMs: null,
    });
  });

  test("a pause between lines shows the cover until the next line", () => {
    const withPause = parseLyrics("[00:02.00]One\n[00:04.00]\n[00:10.00]Two");
    assert.deepEqual(autoLyricLines({ ...showing, lyrics: withPause, positionMs: 6_000 }), {
      lines: null,
      nextChangeMs: 10_000,
    });
  });

  test("the lines around one being sung skip pauses", () => {
    const withPauses = parseLyrics(
      "[00:02.00]One\n[00:04.00]\n[00:10.00]Two\n[00:14.00]\n[00:20.00]Three",
    );
    assert.deepEqual(autoLyricLines({ ...showing, lyrics: withPauses, positionMs: 11_000 }), {
      lines: { previous: "One", current: "Two", next: "Three" },
      nextChangeMs: 14_000,
    });
  });

  test("a track with only unsynced lyrics, or none, keeps the cover", () => {
    for (const lyrics of [parseLyrics("Just words\nNo times"), parseLyrics(""), null]) {
      assert.deepEqual(autoLyricLines({ ...showing, lyrics, positionMs: 6_000 }), COVER);
    }
  });

  test("lines sung together share the one line", () => {
    const duet = parseLyrics("[00:02.00]Me\n[00:02.00]You");
    assert.equal(
      autoLyricLines({ ...showing, lyrics: duet, positionMs: 3_000 }).lines?.current,
      "Me / You",
    );
  });
});
