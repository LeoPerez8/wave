import assert from "node:assert/strict";
import { test } from "node:test";

import {
  recognizeTileNotice,
  resolveRecognizedSong,
  type RecognizeAnswer,
  type RecognizedSong,
  type RecognizeResolution,
  type RecognizeSource,
} from "@wave/core";

import type { RecognizeDeps, RecognizeNative } from "./recognizeSession.ts";
import {
  followRecognizeTile,
  trackCardSessions,
  type RecognizeTileNative,
} from "./recognizeTile.ts";

const SONG: RecognizedSong = {
  title: "I Will Survive",
  artist: "Gloria Gaynor",
  album: "Love Tracks",
  coverUrl: "https://example.com/cover.jpg",
  isrc: null,
  releaseYear: 1978,
};

const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

const resolved = (): RecognizeResolution =>
  resolveRecognizedSong(SONG, [], "disabled") as RecognizeResolution;

/** Android's half: taps waiting in native, and what JS tells it. */
const fakeTile = () => {
  const taps: { tap: number; microphone: boolean }[] = [];
  let requested: (() => void) | null = null;
  let cancelled: ((tap: number) => void) | null = null;
  const tile = {
    calls: [] as string[],
    take: () => taps.shift() ?? null,
    onRequested: (listener: () => void) => {
      requested = listener;
      return () => void (requested = null);
    },
    onCancelled: (listener: (tap: number) => void) => {
      cancelled = listener;
      return () => void (cancelled = null);
    },
    listeningEnded: (tap: number) => void tile.calls.push(`ended ${tap}`),
    finished: () => void tile.calls.push("finished"),
    notify: (notice) => void tile.calls.push(`notify ${notice.kind} ${notice.title}`),
    /** A tap reaches JS, which is already running. */
    tap: (id: number, microphone = false) => {
      taps.push({ tap: id, microphone });
      requested?.();
    },
    /** A tap made before JS was running. */
    waiting: (id: number) => void taps.push({ tap: id, microphone: false }),
    cancel: (id: number) => cancelled?.(id),
  } satisfies RecognizeTileNative & Record<string, unknown>;
  return tile;
};

/** Capture and Shazam, driven by the test; the session between them is the real one. */
const setup = (
  options: {
    resolve?: () => Promise<RecognizeResolution>;
    otherPlaying?: boolean;
    offline?: boolean;
  } = {},
) => {
  let online = options.offline !== true;
  const answers: ((answer: RecognizeAnswer) => void)[] = [];
  let heard: ((session: number, ms: number, audible: boolean) => void) | null = null;
  const native = {
    sources: [] as RecognizeSource[],
    requests: [] as number[],
    stopped: [] as number[],
    playbackActivity: async () => ({
      activeMediaPlayers: options.otherPlaying ? 1 : 0,
      waveMediaPlayers: 0,
    }),
    start: async (source: RecognizeSource, request: number) => {
      native.sources.push(source);
      native.requests.push(request);
      return request;
    },
    cancelStart: () => undefined,
    ask: () => new Promise<RecognizeAnswer>((resolve) => answers.push(resolve)),
    stop: (session: number) => void native.stopped.push(session),
    onHeard: (listener: (session: number, ms: number, audible: boolean) => void) => {
      heard = listener;
      return () => void (heard = null);
    },
    onCaptureFailed: () => () => undefined,
  } satisfies RecognizeNative & Record<string, unknown>;
  const ticks: (() => void)[] = [];
  let clock = 0;
  const logs: string[] = [];
  const held: string[] = [];
  const deps: RecognizeDeps = {
    online: () => online,
    // The card's answer with Wave hidden, as it is for a tile session.
    foreground: () => false,
    now: () => (clock += 500),
    every: (_ms, tick) => {
      ticks.push(tick);
      return () => undefined;
    },
    microphone: async () => "granted",
    holdPlayback: async () => {
      held.push("paused");
      return () => void held.push("resumed");
    },
    native,
    resolve: options.resolve ?? (async () => resolved()),
    log: (_level, line) => void logs.push(line),
  };
  return {
    deps,
    native,
    logs,
    held,
    reconnect: () => void (online = true),
    /** The session running has heard [seconds] in all. */
    hear: async (seconds: number) => {
      heard?.(native.requests.at(-1)!, seconds * 1000, true);
      await settle();
    },
    /** Answers the oldest ask still out. */
    answer: async (answer: RecognizeAnswer) => {
      answers.shift()?.(answer);
      await settle();
    },
    /** Core's clock moves [times] ticks on. */
    tick: (times: number) => {
      for (let i = 0; i < times; i++) for (const tick of ticks) tick();
    },
  };
};

test("a tap made before JS was running starts the session once JS follows the tile", async () => {
  const world = setup();
  const tile = fakeTile();
  tile.waiting(1);
  followRecognizeTile(tile, world.deps, () => null);
  await settle();
  assert.deepEqual(world.native.sources, ["microphone"]);
});

test("a tap with JS running starts the session, and nothing else does", async () => {
  const world = setup();
  const tile = fakeTile();
  followRecognizeTile(tile, world.deps, () => null);
  await settle();
  assert.deepEqual(world.native.sources, []);
  tile.tap(1);
  await settle();
  assert.deepEqual(world.native.sources, ["microphone"]);
});

test("another player doesn't change the source until the tile can ask for phone audio", async () => {
  const world = setup({ otherPlaying: true });
  const tile = fakeTile();
  followRecognizeTile(tile, world.deps, () => null);
  tile.tap(1);
  await settle();
  assert.deepEqual(world.native.sources, ["microphone"]);
});

test("a match says so as soon as Shazam answers, and the tile lets go after the lookup", async () => {
  let settleLookup!: () => void;
  const world = setup({
    resolve: () =>
      new Promise((resolve) => {
        settleLookup = () => resolve(resolved());
      }),
  });
  const tile = fakeTile();
  followRecognizeTile(tile, world.deps, recognizeTileNotice);
  tile.tap(1);
  await settle();
  await world.hear(4);
  await world.answer({ kind: "match", song: SONG });
  assert.deepEqual(tile.calls, ["ended 1", "notify match I Will Survive"]);
  assert.deepEqual(world.held, ["paused", "resumed"]);
  assert.equal(world.logs.length, 0);

  settleLookup();
  await settle();
  assert.deepEqual(tile.calls, ["ended 1", "notify match I Will Survive", "finished"]);
  assert.equal(world.logs.length, 1);
});

test("Core's schedule runs the session: no match only ends it after its last request", async () => {
  const world = setup();
  const tile = fakeTile();
  followRecognizeTile(tile, world.deps, recognizeTileNotice);
  tile.tap(1);
  await settle();
  // However long Core keeps asking: this test holds no copy of its schedule.
  let requests = 0;
  for (let seconds = 4; tile.calls.length === 0 && seconds < 300; seconds += 4) {
    await world.hear(seconds);
    await world.answer({ kind: "noMatch" });
    requests++;
  }
  assert.ok(requests > 1);
  assert.deepEqual(tile.calls, ["ended 1", "notify failure No match", "finished"]);
  assert.equal(world.logs.length, 1);
});

test("Wave staying hidden doesn't end a capture that stops: the failure is a failure", async () => {
  const world = setup();
  const tile = fakeTile();
  followRecognizeTile(tile, world.deps, recognizeTileNotice);
  tile.tap(1);
  await settle();
  await world.hear(1);
  // Core's 3-second stall only counts time in the foreground.
  world.tick(7);
  await settle();
  assert.deepEqual(tile.calls, [
    "ended 1",
    "notify failure Couldn't recognize the song",
    "finished",
  ]);
  assert.match(world.logs[0]!, /failed/);
});

test("a refused request tells the card's reason, and the tile lets go", async () => {
  const world = setup();
  const tile = fakeTile();
  followRecognizeTile(tile, world.deps, recognizeTileNotice);
  tile.tap(1);
  await settle();
  await world.hear(4);
  await world.answer({ kind: "failed", failure: "refused", status: 403 });
  assert.deepEqual(tile.calls, [
    "ended 1",
    "notify failure Couldn't recognize the song",
    "finished",
  ]);
  assert.deepEqual(world.held, ["paused", "resumed"]);
});

test("offline says No connection without capturing", async () => {
  const world = setup({ offline: true });
  const tile = fakeTile();
  followRecognizeTile(tile, world.deps, recognizeTileNotice);
  tile.tap(1);
  await settle();
  assert.deepEqual(tile.calls, ["ended 1", "notify failure No connection", "finished"]);
  assert.deepEqual(world.native.sources, []);
});

test("Try Again is a new tap: it listens again after a failure", async () => {
  const world = setup({ offline: true });
  const tile = fakeTile();
  followRecognizeTile(tile, world.deps, recognizeTileNotice);
  tile.tap(1);
  await settle();
  world.reconnect();
  tile.tap(2);
  await settle();
  assert.deepEqual(world.native.sources, ["microphone"]);
});

test("Use Microphone listens through the microphone with another player active", async () => {
  const world = setup({ otherPlaying: true });
  const tile = fakeTile();
  followRecognizeTile(tile, world.deps, recognizeTileNotice);
  tile.tap(1, true);
  await settle();
  assert.deepEqual(world.native.sources, ["microphone"]);
});

test("Cancel ends the session with no notification, and resumes playback", async () => {
  const world = setup();
  const tile = fakeTile();
  followRecognizeTile(tile, world.deps, recognizeTileNotice);
  tile.tap(4);
  await settle();
  await world.hear(4);
  tile.cancel(4);
  await settle();
  await world.answer({ kind: "match", song: SONG });
  assert.deepEqual(tile.calls, ["ended 4", "finished"]);
  assert.deepEqual(world.held, ["paused", "resumed"]);
  assert.deepEqual(world.native.stopped, [world.native.requests[0]]);
});

test("a cancel for an earlier tap leaves the session listening now alone", async () => {
  const world = setup();
  const tile = fakeTile();
  followRecognizeTile(tile, world.deps, recognizeTileNotice);
  tile.tap(5);
  await settle();
  tile.cancel(4);
  await settle();
  assert.deepEqual(tile.calls, []);
});

test("a card session taking over the capture cancels the tile's", async () => {
  const world = setup();
  const tile = fakeTile();
  const following = followRecognizeTile(tile, world.deps, recognizeTileNotice);
  tile.tap(1);
  await settle();
  following.cancel();
  await settle();
  assert.deepEqual(tile.calls, ["ended 1", "finished"]);
});

test("a new tap during a lookup listens, and native lets go only after both end", async () => {
  const lookups: (() => void)[] = [];
  const world = setup({
    resolve: () => new Promise((resolve) => lookups.push(() => resolve(resolved()))),
  });
  const tile = fakeTile();
  followRecognizeTile(tile, world.deps, recognizeTileNotice);
  tile.tap(1);
  await settle();
  await world.hear(4);
  await world.answer({ kind: "match", song: SONG });
  tile.tap(2);
  await settle();
  lookups.shift()!();
  await settle();
  assert.deepEqual(tile.calls, ["ended 1", "notify match I Will Survive"]);
  tile.cancel(2);
  await settle();
  assert.deepEqual(tile.calls, ["ended 1", "notify match I Will Survive", "ended 2", "finished"]);
});

test("a card session counts until its last lookup ends", async () => {
  const reports: boolean[] = [];
  const track = trackCardSessions((running) => void reports.push(running));
  let endFirst!: () => void;
  let endSecond!: () => void;
  track({ done: new Promise((resolve) => (endFirst = resolve)) });
  track({ done: new Promise((resolve) => (endSecond = resolve)) });
  assert.deepEqual(reports, [true]);
  endFirst();
  await settle();
  assert.deepEqual(reports, [true]);
  endSecond();
  await settle();
  assert.deepEqual(reports, [true, false]);
});
