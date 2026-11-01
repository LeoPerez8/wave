import assert from "node:assert/strict";
import { test } from "node:test";
import type { RecognizeMatch, RecognizeSource } from "@wave/core";

import {
  createRecognizeEntry,
  followRecognizeMatches,
  followRecognizeRequests,
} from "./recognizeEntry.ts";

const MATCH: RecognizeMatch = {
  song: {
    title: "Le Freak",
    artist: "Chic",
    album: null,
    coverUrl: null,
    isrc: null,
    releaseYear: null,
  },
  result: null,
};

test("launches choose the audio source automatically and keep an open card's source", () => {
  const sources: (RecognizeSource | "auto")[] = [];
  let close!: () => void;
  const entry = createRecognizeEntry({
    foreground: () => true,
    show: (source, closed) => {
      assert.equal(typeof source, "string");
      sources.push(source as RecognizeSource | "auto");
      close = closed;
    },
  });
  entry.request();
  entry.request("microphone");
  assert.deepEqual(sources, ["auto"]);
  close();
  entry.request("playback");
  entry.request();
  assert.deepEqual(sources, ["auto", "playback"]);
});

test("tile, shortcut and Search share one card until it closes", () => {
  const cards: (() => void)[] = [];
  const entry = createRecognizeEntry({
    foreground: () => true,
    show: (_source, closed) => {
      cards.push(closed);
    },
  });
  entry.request();
  entry.request();
  assert.equal(cards.length, 1);
  cards[0]!();
  entry.request();
  assert.equal(cards.length, 2);
});

test("the inbox delivers cold and warm launches and stops delivering after cleanup", () => {
  let pending = true;
  const listeners = new Set<() => void>();
  let opened = 0;
  const stop = followRecognizeRequests(
    {
      take: () => {
        const next = pending;
        pending = false;
        return next;
      },
      subscribe: (listener) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
    },
    () => {
      opened++;
    },
  );
  assert.equal(opened, 1);
  pending = true;
  for (const listener of listeners) listener();
  assert.equal(opened, 2);
  stop();
  pending = true;
  for (const listener of listeners) listener();
  assert.equal(opened, 2);
  assert.equal(pending, true);
});

test("a cold or hidden launch waits for foreground, then consumes the request once", () => {
  let foreground = false;
  let opened = 0;
  const entry = createRecognizeEntry({
    foreground: () => foreground,
    show: () => {
      opened++;
    },
  });
  entry.request();
  entry.request();
  assert.equal(opened, 0);
  foreground = true;
  entry.resume();
  entry.resume();
  assert.equal(opened, 1);
});

test("a match waits for the foreground like any other launch", () => {
  const shown: unknown[] = [];
  let foreground = false;
  const entry = createRecognizeEntry({
    foreground: () => foreground,
    show: (opening) => void shown.push(opening),
  });
  entry.request(MATCH);
  assert.deepEqual(shown, []);
  foreground = true;
  entry.resume();
  assert.deepEqual(shown, [MATCH]);
});

test("a match replaces the card open, whose late close leaves the new one counted", () => {
  const cards: { closed: () => void; closes: number }[] = [];
  const entry = createRecognizeEntry({
    foreground: () => true,
    show: (_opening, closed) => {
      const card = { closed, closes: 0 };
      cards.push(card);
      return () => void card.closes++;
    },
  });
  entry.request();
  entry.request(MATCH);
  assert.equal(cards.length, 2);
  assert.equal(cards[0]!.closes, 1);
  cards[0]!.closed();
  entry.request();
  assert.equal(cards.length, 2);
  cards[1]!.closed();
  entry.request();
  assert.equal(cards.length, 3);
});

test("a match's inbox delivers what it holds, cold and warm, until cleanup", () => {
  const waiting = ["cold"];
  let warm: (() => void) | null = null;
  const opened: string[] = [];
  const stop = followRecognizeMatches(
    {
      take: () => waiting.shift() ?? null,
      subscribe: (listener) => {
        warm = listener;
        return () => void (warm = null);
      },
    },
    (match) => void opened.push(match),
  );
  assert.deepEqual(opened, ["cold"]);
  waiting.push("warm");
  warm!();
  assert.deepEqual(opened, ["cold", "warm"]);
  stop();
  assert.equal(warm, null);
});
