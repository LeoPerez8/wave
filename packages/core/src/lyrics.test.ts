import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { currentLyricIndex, parseLyrics, pickLyrics, type LyricLine } from "./index.ts";

describe("currentLyricIndex", () => {
  const lines: LyricLine[] = [
    { timeMs: 2_000, text: "One" },
    { timeMs: 5_000, text: "Two" },
    { timeMs: 9_000, text: "Three" },
  ];

  test("no line is current before the first one starts", () => {
    assert.equal(currentLyricIndex(lines, 1_999), -1);
  });

  test("a line is current from its time until the next line's", () => {
    assert.equal(currentLyricIndex(lines, 2_000), 0);
    assert.equal(currentLyricIndex(lines, 4_999), 0);
    assert.equal(currentLyricIndex(lines, 5_000), 1);
  });

  test("the last line stays current to the end of the track", () => {
    assert.equal(currentLyricIndex(lines, 600_000), 2);
  });

  test("no lines, no current line", () => {
    assert.equal(currentLyricIndex([], 1_000), -1);
  });
});

describe("parseLyrics", () => {
  test("timestamped lines become synced lyrics, timed in milliseconds", () => {
    assert.deepEqual(parseLyrics("[00:12.34]First line\n[01:02.50]Second line"), {
      kind: "synced",
      lines: [
        { timeMs: 12_340, text: "First line" },
        { timeMs: 62_500, text: "Second line" },
      ],
    });
  });

  test("a line with several timestamps is sung at each of them, in time order", () => {
    const lrc = ["[00:10.00]Verse", "[00:05.00][00:20.00]Chorus", "[00:15.00]Bridge"].join("\n");
    assert.deepEqual(parseLyrics(lrc), {
      kind: "synced",
      lines: [
        { timeMs: 5_000, text: "Chorus" },
        { timeMs: 10_000, text: "Verse" },
        { timeMs: 15_000, text: "Bridge" },
        { timeMs: 20_000, text: "Chorus" },
      ],
    });
  });

  test("a positive offset shows every line that many milliseconds earlier", () => {
    const lrc = "[ti:Song]\n[offset:+500]\n[00:00.20]Intro\n[00:10.00]Verse";
    assert.deepEqual(parseLyrics(lrc), {
      kind: "synced",
      lines: [
        { timeMs: 0, text: "Intro" },
        { timeMs: 9_500, text: "Verse" },
      ],
    });
  });

  test("a negative offset shows every line later, wherever the tag sits", () => {
    const lrc = "[00:10.00]Verse\n[offset:-250]";
    assert.deepEqual(parseLyrics(lrc), {
      kind: "synced",
      lines: [{ timeMs: 10_250, text: "Verse" }],
    });
  });

  test("text without timestamps is unsynced, keeping its stanza breaks", () => {
    const text = "\r\n  First line\r\nSecond line  \r\n\r\nNext stanza\r\n\r\n";
    assert.deepEqual(parseLyrics(text), {
      kind: "unsynced",
      lines: ["First line", "Second line", "", "Next stanza"],
    });
  });

  test("reads the timestamp forms taggers write: no fraction, tenths, colon or comma", () => {
    const lrc = ["[1:02]A", "[00:03.5]B", "[00:04:25]C", "[00:05,125]D", "[100:00.00]E"].join("\n");
    const lyrics = parseLyrics(lrc);
    assert.equal(lyrics.kind, "synced");
    assert.deepEqual(
      lyrics.kind === "synced" ? lyrics.lines.map((line) => line.timeMs) : [],
      [3_500, 4_250, 5_125, 62_000, 6_000_000],
    );
  });

  test("word timings of enhanced LRC are dropped from the text", () => {
    assert.deepEqual(parseLyrics("[00:01.00] <00:01.00>Hello <00:01.50>world <00:02.00>"), {
      kind: "synced",
      lines: [{ timeMs: 1_000, text: "Hello world" }],
    });
  });

  test("lines sharing a timestamp, like a translation under each line, show as one", () => {
    const lrc = "[00:01.00]Hola\n[00:01.00]Hello\n[00:04.00]Adiós\n[00:04.00]Goodbye";
    assert.deepEqual(parseLyrics(lrc), {
      kind: "synced",
      lines: [
        { timeMs: 1_000, text: "Hola\nHello" },
        { timeMs: 4_000, text: "Adiós\nGoodbye" },
      ],
    });
  });

  test("a timed line without words is kept, as the pause between lines", () => {
    assert.deepEqual(parseLyrics("[00:01.00]Sung\n[00:03.00]\n[00:09.00]Sung again"), {
      kind: "synced",
      lines: [
        { timeMs: 1_000, text: "Sung" },
        { timeMs: 3_000, text: "" },
        { timeMs: 9_000, text: "Sung again" },
      ],
    });
  });

  test("in synced lyrics, untimed lines such as credits are left out", () => {
    assert.deepEqual(parseLyrics("﻿Lyrics by Someone\n[00:01.00]Sung\nThanks for listening"), {
      kind: "synced",
      lines: [{ timeMs: 1_000, text: "Sung" }],
    });
  });

  test("blank text is no lyrics", () => {
    assert.deepEqual(parseLyrics(" \n\t\r\n"), { kind: "none" });
  });

  test("LRC tags without any timed line are no lyrics, and never shown as text", () => {
    assert.deepEqual(parseLyrics("[ar:Artist]\n[ti:Title]\n[length: 03:21]\n[offset:100]"), {
      kind: "none",
    });
    assert.deepEqual(parseLyrics("[by:someone]\nPlain words"), {
      kind: "unsynced",
      lines: ["Plain words"],
    });
  });

  test("section labels such as [Chorus: Jay-Z] are lyrics, not LRC tags", () => {
    assert.deepEqual(parseLyrics("[Verse 1: Kanye]\nFirst line\n\n[Chorus: Jay-Z]\nHook"), {
      kind: "unsynced",
      lines: ["[Verse 1: Kanye]", "First line", "", "[Chorus: Jay-Z]", "Hook"],
    });
  });
});

/** One line of LRC, sung a second in. */
const synced = (text: string) => `[00:01.00]${text}`;

describe("pickLyrics", () => {
  test("synced lyrics win over unsynced ones, from either source", () => {
    assert.deepEqual(pickLyrics({ embedded: "Plain words", sidecar: synced("From the file") }), {
      kind: "synced",
      lines: [{ timeMs: 1_000, text: "From the file" }],
    });
    assert.deepEqual(pickLyrics({ embedded: synced("From the tags"), sidecar: "Plain words" }), {
      kind: "synced",
      lines: [{ timeMs: 1_000, text: "From the tags" }],
    });
  });

  test("when both are synced, the sidecar .lrc wins", () => {
    assert.deepEqual(pickLyrics({ embedded: synced("Tags"), sidecar: synced("Sidecar") }), {
      kind: "synced",
      lines: [{ timeMs: 1_000, text: "Sidecar" }],
    });
  });

  test("when neither is synced, the embedded lyrics win", () => {
    assert.deepEqual(pickLyrics({ embedded: "Tags", sidecar: "Sidecar" }), {
      kind: "unsynced",
      lines: ["Tags"],
    });
  });

  test("a source that is missing or blank is skipped", () => {
    assert.deepEqual(pickLyrics({ embedded: "  ", sidecar: "Sidecar" }), {
      kind: "unsynced",
      lines: ["Sidecar"],
    });
    assert.deepEqual(pickLyrics({ embedded: null, sidecar: null }), { kind: "none" });
  });
});
