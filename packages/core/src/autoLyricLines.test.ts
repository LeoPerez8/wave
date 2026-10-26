import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { AUTO_LYRIC_LINE_MAX, autoLyricLines, parseLyrics } from "./index.ts";

const synced = parseLyrics("[00:02.00]One\n[00:05.00]Two\n[00:09.00]Three");

const showing = { on: true, carConnected: true } as const;

/** The track's own title and artist, for good. */
const REAL = { text: null, nextChangeMs: null };

describe("autoLyricLines", () => {
  test("the line being sung is the title and the next line the artist, until the next one starts", () => {
    assert.deepEqual(autoLyricLines({ ...showing, lyrics: synced, positionMs: 6_000 }), {
      text: { title: "Two", artist: "Three" },
      nextChangeMs: 9_000,
    });
  });

  test("with the toggle off, the real title and artist show", () => {
    assert.deepEqual(
      autoLyricLines({ on: false, carConnected: true, lyrics: synced, positionMs: 6_000 }),
      REAL,
    );
  });

  test("with Auto disconnected, the real title and artist show even with the toggle on", () => {
    assert.deepEqual(
      autoLyricLines({ on: true, carConnected: false, lyrics: synced, positionMs: 6_000 }),
      REAL,
    );
  });

  test("before the first line, the real title and artist show until it starts", () => {
    assert.deepEqual(autoLyricLines({ ...showing, lyrics: synced, positionMs: 500 }), {
      text: null,
      nextChangeMs: 2_000,
    });
  });

  test("on the last line the artist is the real one, to the end of the track", () => {
    assert.deepEqual(autoLyricLines({ ...showing, lyrics: synced, positionMs: 200_000 }), {
      text: { title: "Three", artist: null },
      nextChangeMs: null,
    });
  });

  test("a pause between lines shows the real title and artist until the next line", () => {
    const withPause = parseLyrics("[00:02.00]One\n[00:04.00]\n[00:10.00]Two");
    assert.deepEqual(autoLyricLines({ ...showing, lyrics: withPause, positionMs: 6_000 }), {
      text: null,
      nextChangeMs: 10_000,
    });
  });

  test("the artist skips pauses, so the line after one already shows", () => {
    const withPause = parseLyrics("[00:02.00]One\n[00:04.00]\n[00:10.00]Two");
    assert.deepEqual(autoLyricLines({ ...showing, lyrics: withPause, positionMs: 3_000 }), {
      text: { title: "One", artist: "Two" },
      nextChangeMs: 4_000,
    });
  });

  test("a last line followed only by a pause has the real artist", () => {
    const endsInPause = parseLyrics("[00:02.00]One\n[00:04.00]");
    assert.deepEqual(autoLyricLines({ ...showing, lyrics: endsInPause, positionMs: 3_000 }), {
      text: { title: "One", artist: null },
      nextChangeMs: 4_000,
    });
  });

  test("a track with only unsynced lyrics, or none, keeps the real title and artist", () => {
    for (const lyrics of [parseLyrics("Just words\nNo times"), parseLyrics(""), null]) {
      assert.deepEqual(autoLyricLines({ ...showing, lyrics, positionMs: 6_000 }), REAL);
    }
  });

  test("lines sung together share the one line", () => {
    const duet = parseLyrics("[00:02.00]Me\n[00:02.00]You\n[00:05.00]Us\n[00:05.00]Them");
    assert.deepEqual(autoLyricLines({ ...showing, lyrics: duet, positionMs: 3_000 }).text, {
      title: "Me / You",
      artist: "Us / Them",
    });
  });

  test("a line longer than the limit splits at the space closest to its middle, title then artist", () => {
    const long = parseLyrics("[00:02.00]Hold me closer tiny dancer in the night\n[00:05.00]Next");
    assert.deepEqual(autoLyricLines({ ...showing, lyrics: long, positionMs: 3_000 }), {
      text: { title: "Hold me closer tiny", artist: "dancer in the night" },
      nextChangeMs: 5_000,
    });
  });

  test("splitting a long line trims spaces left by stripped word timestamps", () => {
    const lyrics = parseLyrics(
      "[00:02.00]Hold me closer tiny <00:03.00>  dancer in the night\n[00:05.00]Next",
    );
    assert.deepEqual(autoLyricLines({ ...showing, lyrics, positionMs: 3_000 }), {
      text: { title: "Hold me closer tiny", artist: "dancer in the night" },
      nextChangeMs: 5_000,
    });
  });

  test("a line of the limit's length still goes whole in the title, with the next line as the artist", () => {
    const atLimit = "Hold me closer tiny dancer now";
    assert.equal(atLimit.length, AUTO_LYRIC_LINE_MAX);
    const lyrics = parseLyrics(`[00:02.00]${atLimit}\n[00:05.00]Next`);
    assert.deepEqual(autoLyricLines({ ...showing, lyrics, positionMs: 3_000 }).text, {
      title: atLimit,
      artist: "Next",
    });
  });

  test("long lines sung together split where one ends and the other starts", () => {
    const duet = parseLyrics(
      "[00:02.00]Running away\n[00:02.00]We will never come back here\n[00:05.00]Next",
    );
    assert.deepEqual(autoLyricLines({ ...showing, lyrics: duet, positionMs: 3_000 }).text, {
      title: "Running away",
      artist: "We will never come back here",
    });
  });

  test("a long line with no space goes whole in the title, with the next line as the artist", () => {
    const unbroken = "Supercalifragilisticexpialidocious";
    const lyrics = parseLyrics(`[00:02.00]${unbroken}\n[00:05.00]Next`);
    assert.deepEqual(autoLyricLines({ ...showing, lyrics, positionMs: 3_000 }).text, {
      title: unbroken,
      artist: "Next",
    });
  });
});
