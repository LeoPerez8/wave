/// <reference types="node" />
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, mock, test } from "node:test";

import { parseLyrics, type Lyrics } from "@wave/core";

import { makeExternalStore } from "../lib/externalStore.ts";
import { startAutoLyricLine, type AutoLyricLinePlayback } from "./autoLyricLine.ts";

const SONG = parseLyrics("[00:02.00]One\n[00:05.00]Two\n[00:09.00]Three");

const playing = (itemId: string, positionMs: number): AutoLyricLinePlayback => ({
  item: { id: itemId },
  positionMs,
  durationMs: 200_000,
  at: Date.now(),
  isPlaying: true,
});

/** Lets the lyrics reads (promises) settle. */
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

describe("startAutoLyricLine", () => {
  let shown: (string | null)[];
  let lyricsByPath: Map<string, Lyrics>;

  const start = (initial: AutoLyricLinePlayback) => {
    const playback = makeExternalStore<AutoLyricLinePlayback>(initial);
    const sync = startAutoLyricLine({
      playback,
      pathOf: (itemId) => `/music/${itemId}.flac`,
      readLyrics: (path) => Promise.resolve(lyricsByPath.get(path) ?? { kind: "none" }),
      show: (_itemId, line) => shown.push(line),
    });
    return { playback, sync };
  };

  beforeEach(() => {
    mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1_000_000 });
    shown = [];
    lyricsByPath = new Map([["/music/a.flac", SONG]]);
  });

  afterEach(() => mock.timers.reset());

  test("in the car with the toggle on, the line being sung shows and moves on with the song", async () => {
    const { sync } = start(playing("a", 6_000));
    sync.setToggle({ on: true, carConnected: true });
    await settle();
    assert.equal(shown.at(-1), "Two");

    mock.timers.tick(3_000);
    assert.equal(shown.at(-1), "Three");
  });

  test("a seek shows the line at the new position", async () => {
    const { playback, sync } = start(playing("a", 6_000));
    sync.setToggle({ on: true, carConnected: true });
    await settle();

    playback.set(playing("a", 2_500));
    assert.equal(shown.at(-1), "One");
  });

  test("the next track shows its artist until its own lyrics are read", async () => {
    const { playback, sync } = start(playing("a", 6_000));
    sync.setToggle({ on: true, carConnected: true });
    await settle();

    playback.set(playing("b", 6_000));
    assert.equal(shown.at(-1), null);
  });

  test("a track the queue doesn't know yet gets its line once it does", async () => {
    let known = false;
    const playback = makeExternalStore<AutoLyricLinePlayback>(playing("a", 6_000));
    const sync = startAutoLyricLine({
      playback,
      pathOf: (itemId) => (known ? `/music/${itemId}.flac` : null),
      readLyrics: (path) => Promise.resolve(lyricsByPath.get(path) ?? { kind: "none" }),
      show: (_itemId, line) => shown.push(line),
    });
    sync.setToggle({ on: true, carConnected: true });
    await settle();
    assert.equal(shown.at(-1), null);

    known = true;
    playback.set(playing("a", 6_500));
    await settle();
    assert.equal(shown.at(-1), "Two");
  });

  test("turning the toggle off shows the artist", async () => {
    const { sync } = start(playing("a", 6_000));
    sync.setToggle({ on: true, carConnected: true });
    await settle();

    sync.setToggle({ on: false, carConnected: true });
    assert.equal(shown.at(-1), null);
  });

  test("Auto reconnecting gets the line again", async () => {
    const { sync } = start(playing("a", 6_000));
    sync.setToggle({ on: true, carConnected: true });
    await settle();
    sync.setToggle({ on: true, carConnected: false });

    sync.setToggle({ on: true, carConnected: true });
    assert.equal(shown.at(-1), "Two");
  });

  test("stopping sends nothing more", async () => {
    const { playback, sync } = start(playing("a", 6_000));
    sync.setToggle({ on: true, carConnected: true });
    await settle();
    const sent = shown.length;

    sync.stop();
    playback.set(playing("a", 2_500));
    mock.timers.tick(10_000);
    assert.equal(shown.length, sent);
  });
});
