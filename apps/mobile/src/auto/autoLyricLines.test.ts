/// <reference types="node" />
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, mock, test } from "node:test";

import { parseLyrics, type AutoLyricsText, type Lyrics } from "@wave/core";

import { makeExternalStore } from "../lib/externalStore.ts";
import { startAutoLyricLines, type AutoLyricLinesPlayback } from "./autoLyricLines.ts";

const SONG = parseLyrics("[00:02.00]One\n[00:05.00]Two\n[00:09.00]Three");

const playing = (itemId: string, positionMs: number): AutoLyricLinesPlayback => ({
  item: { id: itemId },
  positionMs,
  durationMs: 200_000,
  at: Date.now(),
  isPlaying: true,
});

/** Lets the lyrics reads (promises) settle. */
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

describe("startAutoLyricLines", () => {
  let shown: (AutoLyricsText | null)[];
  /** The line being sung in the last title sent; null for the real title. */
  const sung = () => shown.at(-1)?.title ?? null;
  let lyricsByPath: Map<string, Lyrics>;

  const start = (initial: AutoLyricLinesPlayback) => {
    const playback = makeExternalStore<AutoLyricLinesPlayback>(initial);
    const sync = startAutoLyricLines({
      playback,
      pathOf: (itemId) => `/music/${itemId}.flac`,
      readLyrics: (path) => Promise.resolve(lyricsByPath.get(path) ?? { kind: "none" }),
      show: (_itemId, text) => shown.push(text),
    });
    return { playback, sync };
  };

  beforeEach(() => {
    mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1_000_000 });
    shown = [];
    lyricsByPath = new Map([["/music/a.flac", SONG]]);
  });

  afterEach(() => mock.timers.reset());

  test("in the car with the toggle on, the title shows the line being sung and moves on with the song", async () => {
    const { sync } = start(playing("a", 6_000));
    sync.setToggle({ on: true, carConnected: true });
    await settle();
    assert.equal(sung(), "Two");

    mock.timers.tick(3_000);
    assert.equal(sung(), "Three");
  });

  test("the artist shows the line sung next", async () => {
    const { sync } = start(playing("a", 6_000));
    sync.setToggle({ on: true, carConnected: true });
    await settle();
    assert.deepEqual(shown.at(-1), { title: "Two", artist: "Three" });
  });

  test("a long line's next chunk takes the title when its first word is sung", async () => {
    // 32 letters over the 4 s to the next line: "dancer" (16 letters in) starts at 4 s.
    lyricsByPath.set(
      "/music/a.flac",
      parseLyrics("[00:02.00]Hold me closer tiny dancer in the night\n[00:06.00]Next"),
    );
    const { sync } = start(playing("a", 3_000));
    sync.setToggle({ on: true, carConnected: true });
    await settle();
    assert.deepEqual(shown.at(-1), { title: "Hold me closer tiny", artist: "dancer in the night" });

    mock.timers.tick(1_000);
    assert.deepEqual(shown.at(-1), { title: "dancer in the night", artist: "Next" });
  });

  test("position reports within a line send nothing new, so Auto isn't flooded", async () => {
    const { playback, sync } = start(playing("a", 6_000));
    sync.setToggle({ on: true, carConnected: true });
    await settle();
    const sent = shown.length;

    playback.set(playing("a", 6_500));
    playback.set(playing("a", 7_000));
    assert.equal(shown.length, sent);
  });

  test("a streamed YT Music song, which has no lyrics, keeps its real title and artist", async () => {
    const { sync } = start(playing("yt:dQw4w9WgXcQ", 6_000));
    sync.setToggle({ on: true, carConnected: true });
    await settle();
    assert.deepEqual(shown, [null]);
  });

  test("a seek shows the line at the new position", async () => {
    const { playback, sync } = start(playing("a", 6_000));
    sync.setToggle({ on: true, carConnected: true });
    await settle();

    playback.set(playing("a", 2_500));
    assert.equal(sung(), "One");
  });

  test("the next track shows its real title and artist until its own lyrics are read", async () => {
    const { playback, sync } = start(playing("a", 6_000));
    sync.setToggle({ on: true, carConnected: true });
    await settle();

    playback.set(playing("b", 6_000));
    assert.equal(sung(), null);
  });

  test("a track the queue doesn't know yet gets its lyrics once it does", async () => {
    let known = false;
    const playback = makeExternalStore<AutoLyricLinesPlayback>(playing("a", 6_000));
    const sync = startAutoLyricLines({
      playback,
      pathOf: (itemId) => (known ? `/music/${itemId}.flac` : null),
      readLyrics: (path) => Promise.resolve(lyricsByPath.get(path) ?? { kind: "none" }),
      show: (_itemId, text) => shown.push(text),
    });
    sync.setToggle({ on: true, carConnected: true });
    await settle();
    assert.equal(sung(), null);

    known = true;
    playback.set(playing("a", 6_500));
    await settle();
    assert.equal(sung(), "Two");
  });

  test("turning the toggle off brings the real title and artist back", async () => {
    const { sync } = start(playing("a", 6_000));
    sync.setToggle({ on: true, carConnected: true });
    await settle();

    sync.setToggle({ on: false, carConnected: true });
    assert.equal(sung(), null);
  });

  test("Auto reconnecting gets the lyrics again", async () => {
    const { sync } = start(playing("a", 6_000));
    sync.setToggle({ on: true, carConnected: true });
    await settle();
    sync.setToggle({ on: true, carConnected: false });

    sync.setToggle({ on: true, carConnected: true });
    assert.equal(sung(), "Two");
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

test("car lyrics acquire position reports only with the toggle on in a connected car", () => {
  const playback = makeExternalStore<AutoLyricLinesPlayback>(playing("a", 0));
  const sync = startAutoLyricLines({
    playback,
    pathOf: () => null,
    readLyrics: () => Promise.resolve({ kind: "none" }),
    show: () => {},
  });
  assert.equal(playback.listenerCount(), 0);
  sync.setToggle({ on: true, carConnected: false });
  assert.equal(playback.listenerCount(), 0);
  sync.setToggle({ on: true, carConnected: true });
  assert.equal(playback.listenerCount(), 1);
  sync.setToggle({ on: true, carConnected: true });
  assert.equal(playback.listenerCount(), 1);
  sync.setToggle({ on: false, carConnected: true });
  assert.equal(playback.listenerCount(), 0);
  sync.setToggle({ on: true, carConnected: true });
  sync.setToggle({ on: true, carConnected: false });
  assert.equal(playback.listenerCount(), 0);
  sync.setToggle({ on: true, carConnected: true });
  sync.stop();
  assert.equal(playback.listenerCount(), 0);
});
