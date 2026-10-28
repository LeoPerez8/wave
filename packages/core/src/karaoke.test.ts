import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  autoLyricLines,
  currentLyricWordIndex,
  karaokeLyricLines,
  lyricsTranslationRequest,
  parseLyrics,
  shareableLyricLines,
  type LyricLine,
} from "./index.ts";

const syncedLines = (text: string): readonly LyricLine[] => {
  const lyrics = parseLyrics(text);
  if (lyrics.kind !== "synced") assert.fail("expected synced lyrics");
  return lyrics.lines;
};

/** Each line's words as [text, start time]. */
const wordTimes = (text: string) =>
  karaokeLyricLines(syncedLines(text)).map((line) =>
    line.words.map((word) => [word.text, word.timeMs]),
  );

describe("karaokeLyricLines", () => {
  test("a stamped line keeps its Enhanced LRC word times", () => {
    assert.deepEqual(wordTimes("[00:01]<00:01.20>Real <00:02.80>words\n[00:04]Next"), [
      [
        ["Real", 1_200],
        ["words", 2_800],
      ],
      [["Next", 4_000]],
    ]);
  });

  test("an unstamped line shares its span among its words by their length", () => {
    // 10 characters over the 2 s to the next line: 200 ms a character.
    assert.deepEqual(wordTimes("[00:01]We sing loud\n[00:03]Next")[0], [
      ["We", 1_000],
      ["sing", 1_400],
      ["loud", 2_200],
    ]);
  });

  test("an instrumental gap after a line isn't spread over its words", () => {
    // 36 s to the next line, but "a bbb" has 4 characters: capped at 400 ms each.
    assert.deepEqual(wordTimes("[00:04]a bbb\n[00:40]Back")[0], [
      ["a", 4_000],
      ["bbb", 4_400],
    ]);
  });

  test("a long line over a gap is capped at 8 s", () => {
    const line = "abcdefghijklmno pqrstuvwxyzabcd"; // 30 characters: 8 s, not 30 × 400 ms
    assert.deepEqual(wordTimes(`[00:00]${line}\n[01:00]Back`)[0], [
      ["abcdefghijklmno", 0],
      ["pqrstuvwxyzabcd", 4_000],
    ]);
  });

  test("the last line, with no next line, uses the same cap", () => {
    assert.deepEqual(wordTimes("[00:01]First\n[00:50]the end").at(-1), [
      ["the", 50_000],
      ["end", 51_200],
    ]);
  });

  test("a pause (empty line) has no words", () => {
    assert.deepEqual(wordTimes("[00:01]Hello\n[00:03]\n[00:05]Again")[1], []);
  });

  test("mixed lyrics: stamped lines keep real times, the others are estimated", () => {
    assert.deepEqual(
      wordTimes(
        "[00:01]<00:01.20>Real <00:02.80>words\n[00:04]a bbb\n[00:06]<00:06>Stamped <00:07.50>again",
      ),
      [
        [
          ["Real", 1_200],
          ["words", 2_800],
        ],
        [
          ["a", 4_000],
          ["bbb", 4_400],
        ],
        [
          ["Stamped", 6_000],
          ["again", 7_500],
        ],
      ],
    );
  });

  test("words keep their place in the stamp-free text, syllables split by stamps included", () => {
    const [line] = karaokeLyricLines(syncedLines("[00:01]<00:01>Hel<00:01.50>lo  <00:02>world"));
    assert.equal(line?.text, "Hello  world");
    assert.deepEqual(
      line?.words.map((word) => [word.text, word.start, word.end]),
      [
        ["Hel", 0, 3],
        ["lo", 3, 5],
        ["world", 7, 12],
      ],
    );
  });

  test("word stamps follow the offset tag and every time of a repeated line", () => {
    assert.deepEqual(wordTimes("[offset:200]\n[00:01][00:10]<00:01>Hello <00:02>world"), [
      [
        ["Hello", 800],
        ["world", 1_800],
      ],
      [
        ["Hello", 9_800],
        ["world", 10_800],
      ],
    ]);
  });

  test("lines sung together keep the stamped part's times and estimate the rest after it", () => {
    // "Hello" would be estimated at 2.8 s, before "amigo"'s real 3.5 s: it waits for it.
    assert.deepEqual(
      wordTimes("[00:01]<00:01>Hola <00:03.50>amigo\n[00:01]Hello friend\n[00:05]Next")[0],
      [
        ["Hola", 1_000],
        ["amigo", 3_500],
        ["Hello", 3_500],
        ["friend", 3_800],
      ],
    );
  });
});

describe("currentLyricWordIndex", () => {
  const [line] = karaokeLyricLines(syncedLines("[00:01]<00:01>One <00:01.50>two <00:03>three"));
  const words = line?.words ?? [];

  test("no word is sung before the line's first word starts", () => {
    assert.equal(currentLyricWordIndex(words, 999), -1);
  });

  test("a word is sung from its start until the next word's", () => {
    assert.deepEqual(
      [1_000, 1_499, 1_500, 2_999, 3_000].map((at) => currentLyricWordIndex(words, at)),
      [0, 0, 1, 1, 2],
    );
  });

  test("the last word stays sung until the line ends", () => {
    assert.equal(currentLyricWordIndex(words, 9_000), 2);
  });

  test("a seek back finds the earlier word", () => {
    assert.equal(currentLyricWordIndex(words, 1_200), 0);
  });

  test("a line without words has none sung", () => {
    assert.equal(currentLyricWordIndex([], 1_000), -1);
  });
});

describe("stamp-free lyrics elsewhere", () => {
  const lyrics = parseLyrics("[00:01]<00:01>Hello <00:02>world\n[00:04]Next line");

  test("sharing and Android Auto read the words without the stamps", () => {
    assert.deepEqual(shareableLyricLines(lyrics), ["Hello world", "Next line"]);
    assert.deepEqual(autoLyricLines({ on: true, carConnected: true, lyrics, positionMs: 1_500 }), {
      text: { title: "Hello world", artist: "Next line" },
      nextChangeMs: 4_000,
    });
  });

  test("translation sends the words without the stamps", () => {
    if (lyrics.kind !== "synced") assert.fail("expected synced lyrics");
    const request = lyricsTranslationRequest(
      lyrics.lines.map((line) => line.text),
      "pt",
    );
    assert.equal(request?.body, "q=Hello%20world&q=Next%20line");
  });
});
