import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { AUTO_LYRIC_LINE_MAX, autoLyricLines, parseLyrics } from "./index.ts";

const synced = parseLyrics("[00:02.00]One\n[00:05.00]Two\n[00:09.00]Three");

/** Fourteen 4-letter words: too long for two chunks. */
const THREE_CHUNKS = "Here come your dark days back from that cold room down into your arms";

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

  test("a long line shows a chunk at a time: the title holds the word being sung, the artist the chunk after it", () => {
    // 32 letters over the 4 s to the next line, so "dancer" (16 letters in) starts at 4 s.
    const long = parseLyrics("[00:02.00]Hold me closer tiny dancer in the night\n[00:06.00]Next");
    assert.deepEqual(autoLyricLines({ ...showing, lyrics: long, positionMs: 3_000 }), {
      text: { title: "Hold me closer tiny", artist: "dancer in the night" },
      nextChangeMs: 4_000,
    });
  });

  test("real word timings move the title on when the next chunk's first stamped word starts", () => {
    // An estimate would start "dancer" at 5 s; its stamp says 4.5 s.
    const lyrics = parseLyrics(
      "[00:02.00]<00:02.00>Hold me closer tiny <00:04.50>  dancer in the night\n[00:08.00]Next",
    );
    assert.deepEqual(autoLyricLines({ ...showing, lyrics, positionMs: 4_000 }), {
      text: { title: "Hold me closer tiny", artist: "dancer in the night" },
      nextChangeMs: 4_500,
    });
    assert.deepEqual(autoLyricLines({ ...showing, lyrics, positionMs: 4_500 }), {
      text: { title: "dancer in the night", artist: "Next" },
      nextChangeMs: 8_000,
    });
  });

  test("a line needing three chunks gets three even ones, each taking the title as its first word is sung", () => {
    // Fourteen 4-letter words (56 letters) over the 8 s cap: a word every 571 ms.
    const lyrics = parseLyrics(`[00:10.00]${THREE_CHUNKS}\n[00:40.00]Next`);
    assert.deepEqual(autoLyricLines({ ...showing, lyrics, positionMs: 10_000 }), {
      text: { title: "Here come your dark days", artist: "back from that cold room" },
      nextChangeMs: 12_857,
    });
    assert.deepEqual(autoLyricLines({ ...showing, lyrics, positionMs: 12_857 }), {
      text: { title: "back from that cold room", artist: "down into your arms" },
      nextChangeMs: 15_714,
    });
    assert.deepEqual(autoLyricLines({ ...showing, lyrics, positionMs: 15_714 }), {
      text: { title: "down into your arms", artist: "Next" },
      nextChangeMs: 40_000,
    });
  });

  test("on the last chunk of the last sung line the artist is the real one, to the end of the track", () => {
    const lyrics = parseLyrics(`[00:10.00]${THREE_CHUNKS}`);
    assert.deepEqual(autoLyricLines({ ...showing, lyrics, positionMs: 13_000 }), {
      text: { title: "back from that cold room", artist: "down into your arms" },
      nextChangeMs: 15_714,
    });
    assert.deepEqual(autoLyricLines({ ...showing, lyrics, positionMs: 200_000 }), {
      text: { title: "down into your arms", artist: null },
      nextChangeMs: null,
    });
  });

  test("a seek either way shows the chunk being sung at the new position", () => {
    const lyrics = parseLyrics(`[00:10.00]${THREE_CHUNKS}\n[00:40.00]Next`);
    for (const [positionMs, title] of [
      [16_000, "down into your arms"],
      [11_000, "Here come your dark days"],
      [13_500, "back from that cold room"],
    ] as const) {
      assert.equal(autoLyricLines({ ...showing, lyrics, positionMs }).text?.title, title);
    }
  });

  test("after a line's last chunk the artist is the next sung line's first chunk, past a pause", () => {
    const lyrics = parseLyrics(
      "[00:02.00]One\n[00:04.00]\n[00:10.00]Hold me closer tiny dancer in the night",
    );
    assert.deepEqual(autoLyricLines({ ...showing, lyrics, positionMs: 3_000 }), {
      text: { title: "One", artist: "Hold me closer tiny" },
      nextChangeMs: 4_000,
    });
  });

  test("before a line's first stamped word, the title is its first chunk", () => {
    const lyrics = parseLyrics(
      "[00:02.00]<00:03.00>Hold me closer tiny <00:04.50>dancer in the night\n[00:08.00]Next",
    );
    assert.deepEqual(autoLyricLines({ ...showing, lyrics, positionMs: 2_500 }), {
      text: { title: "Hold me closer tiny", artist: "dancer in the night" },
      nextChangeMs: 4_500,
    });
  });

  test("a word longer than the limit is a chunk of its own; Auto cuts it with an ellipsis", () => {
    const lyrics = parseLyrics(
      "[00:02.00]<00:02.00>Supercalifragilisticexpialidocious <00:04.00>is the word\n[00:08.00]Next",
    );
    assert.deepEqual(autoLyricLines({ ...showing, lyrics, positionMs: 3_000 }), {
      text: { title: "Supercalifragilisticexpialidocious", artist: "is the word" },
      nextChangeMs: 4_000,
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

  test("long lines sung together each take their own chunk, in the order they're sung", () => {
    // 34 letters over 3 s: "We" (11 letters in) starts at 2.971 s.
    const duet = parseLyrics(
      "[00:02.00]Running away\n[00:02.00]We will never come back here\n[00:05.00]Next",
    );
    assert.deepEqual(autoLyricLines({ ...showing, lyrics: duet, positionMs: 2_500 }), {
      text: { title: "Running away", artist: "We will never come back here" },
      nextChangeMs: 2_971,
    });
    assert.deepEqual(autoLyricLines({ ...showing, lyrics: duet, positionMs: 3_000 }), {
      text: { title: "We will never come back here", artist: "Next" },
      nextChangeMs: 5_000,
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
