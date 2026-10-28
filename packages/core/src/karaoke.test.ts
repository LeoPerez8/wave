import assert from "node:assert/strict";
import { test } from "node:test";
import { karaokeLyricLines, parseLyrics } from "./index.ts";

test("unstamped lines share their span by word length", () => {
  const lyrics = parseLyrics("[00:01]I sing\n[00:03]Next");
  assert.equal(lyrics.kind, "synced");
  if (lyrics.kind !== "synced") return;
  assert.deepEqual(karaokeLyricLines(lyrics.lines)[0]?.words, [
    { timeMs: 1000, text: "I", start: 0, end: 1 },
    { timeMs: 1400, text: "sing", start: 2, end: 6 },
  ]);
});

test("word lookup follows exact boundaries and backward seeks", async () => {
  const { currentLyricWordIndex } = await import("./index.ts");
  const words = [{ timeMs: 1000 }, { timeMs: 1500 }, { timeMs: 3000 }];
  assert.deepEqual(
    [999, 1000, 1499, 1500, 9000, 1200].map((at) => currentLyricWordIndex(words, at)),
    [-1, 0, 0, 1, 2, 0],
  );
  assert.equal(currentLyricWordIndex([], 1000), -1);
});

test("mixed lyrics keep real timings while gaps and the last line use capped estimates", () => {
  const lyrics = parseLyrics(
    "[00:01]<00:01.20>Real <00:02.80>words\n[00:04]a bbb\n[00:40]last words\n[00:45]\n[00:50]the end",
  );
  if (lyrics.kind !== "synced") assert.fail("expected synced lyrics");
  const lines = karaokeLyricLines(lyrics.lines);
  assert.deepEqual(
    lines.map((line) => line.words.map((word) => word.timeMs)),
    [[1200, 2800], [4000, 4400], [40000, 41600], [], [50000, 51200]],
  );
});

test("word stamps follow offsets, repeated lines and stamp-split syllables", () => {
  const lyrics = parseLyrics("[offset:200]\n[00:01][00:10]<00:01>Hel<00:01.50>lo <00:02>world");
  if (lyrics.kind !== "synced") assert.fail("expected synced lyrics");
  assert.deepEqual(
    karaokeLyricLines(lyrics.lines).map((line) => [
      line.text,
      line.words.map((word) => [word.text, word.timeMs, word.start, word.end]),
    ]),
    [
      [
        "Hello world",
        [
          ["Hel", 800, 0, 3],
          ["lo", 1300, 3, 5],
          ["world", 1800, 6, 11],
        ],
      ],
      [
        "Hello world",
        [
          ["Hel", 9800, 0, 3],
          ["lo", 10300, 3, 5],
          ["world", 10800, 6, 11],
        ],
      ],
    ],
  );
});

test("merged lines keep real words and estimate words in the unstamped translation", () => {
  const lyrics = parseLyrics("[00:01]<00:01.20>Hola\n[00:01]Hello\n[00:03]Next");
  if (lyrics.kind !== "synced") assert.fail("expected synced lyrics");
  assert.deepEqual(karaokeLyricLines(lyrics.lines)[0]?.words, [
    { timeMs: 1200, text: "Hola", start: 0, end: 4 },
    { timeMs: 1889, text: "Hello", start: 5, end: 10 },
  ]);
});

test("translation, sharing and Auto keep receiving stamp-free line text", async () => {
  const { autoLyricLines, shareableLyricLines, lyricsTranslationRequest } =
    await import("./index.ts");
  const lyrics = parseLyrics("[00:01]<00:01>Hello <00:02>world\n[00:04]Next line");
  assert.deepEqual(shareableLyricLines(lyrics), ["Hello world", "Next line"]);
  assert.deepEqual(autoLyricLines({ on: true, carConnected: true, lyrics, positionMs: 1500 }), {
    text: { title: "Hello world", artist: "Next line" },
    nextChangeMs: 4000,
  });
  if (lyrics.kind !== "synced") assert.fail("expected synced lyrics");
  const request = lyricsTranslationRequest(
    lyrics.lines.map((line) => line.text),
    "pt",
  );
  assert.ok(request);
  assert.equal(request.body, "q=Hello%20world&q=Next%20line");
});
