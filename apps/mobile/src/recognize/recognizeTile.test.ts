import assert from "node:assert/strict";
import { test } from "node:test";

import {
  readRecognizeMatch,
  recognizeTileNotice,
  resolveRecognizedSong,
  writeRecognizeMatch,
  type RecognizeAnswer,
  type RecognizedSong,
  type RecognizeResolution,
  type RecognizeResult,
  type RecognizeSource,
  type RecognizeTrack,
} from "@wave/core";

import {
  startRecognizeSession,
  type RecognizeDeps,
  type RecognizeNative,
} from "./recognizeSession.ts";
import {
  followRecognizeTile,
  trackCardSessions,
  type RecognizeTileDeps,
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
    saved: [] as { line: string; match: string }[],
    matchSaved: (line: string, match: string) => void tile.saved.push({ line, match }),
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
    save?: (result: RecognizeResult) => Promise<string>;
    library?: () => Promise<readonly RecognizeTrack[]>;
    otherPlaying?: boolean;
    offline?: boolean;
    /** What Android's consent dialog does with a phone-audio start; held open by default. */
    consent?: "held";
  } = {},
) => {
  let online = options.offline !== true;
  const answers: ((answer: RecognizeAnswer) => void)[] = [];
  let heard: ((session: number, ms: number, audible: boolean) => void) | null = null;
  let consent: { accept: () => void; decline: () => void } | null = null;
  const native = {
    sources: [] as RecognizeSource[],
    requests: [] as number[],
    stopped: [] as number[],
    cancelled: [] as number[],
    playbackActivity: async () => ({
      activeMediaPlayers: options.otherPlaying ? 1 : 0,
      waveMediaPlayers: 0,
    }),
    start: async (source: RecognizeSource, request: number) => {
      native.sources.push(source);
      native.requests.push(request);
      if (source === "microphone" || options.consent !== "held") return request;
      return new Promise<number>((resolve, reject) => {
        consent = {
          accept: () => resolve(request),
          decline: () =>
            reject(Object.assign(new Error("declined"), { code: "ERR_RECOGNIZE_CONSENT" })),
        };
      });
    },
    cancelStart: (request: number) => void native.cancelled.push(request),
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
  const saves: RecognizeResult[] = [];
  const logLevels: string[] = [];
  const deps: RecognizeTileDeps = {
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
    log: (level, line) => {
      logLevels.push(level);
      logs.push(line);
    },
    save: (result) => {
      saves.push(result);
      return options.save?.(result) ?? Promise.resolve("Added to Shazam");
    },
    couldntSave: () => "Couldn't add to Shazam",
    library: options.library ?? (async () => []),
  };
  return {
    deps,
    native,
    logs,
    logLevels,
    held,
    reconnect: () => void (online = true),
    saves,
    /** Android's consent dialog is answered. */
    accept: async () => {
      consent?.accept();
      await settle();
    },
    decline: async () => {
      consent?.decline();
      await settle();
    },

    /** The session running has heard [seconds] in all. */
    hear: async (seconds: number, audible = true) => {
      heard?.(native.requests.at(-1)!, seconds * 1000, audible);
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

test("another player active: Core's source choice takes the tile to phone audio", async () => {
  const world = setup({ otherPlaying: true });
  const tile = fakeTile();
  followRecognizeTile(tile, world.deps, () => null);
  tile.tap(1);
  await settle();
  assert.deepEqual(world.native.sources, ["playback"]);
});

test("phone audio leaves Wave's playback alone from the tap to the match", async () => {
  const world = setup({ otherPlaying: true });
  const tile = fakeTile();
  followRecognizeTile(tile, world.deps, recognizeTileNotice);
  tile.tap(1);
  await settle();
  await world.hear(4);
  await world.answer({ kind: "match", song: SONG });
  assert.deepEqual(world.held, []);
  assert.deepEqual(tile.calls, ["ended 1", "notify match I Will Survive", "finished"]);
});

test("the consent dialog can stay up as long as it likes: only capture counts as stalling", async () => {
  const world = setup({ otherPlaying: true, consent: "held" });
  const tile = fakeTile();
  followRecognizeTile(tile, world.deps, recognizeTileNotice);
  tile.tap(1);
  await settle();
  // Far past Core's 3-second stall, which would end the session as a failed capture.
  world.tick(60);
  await settle();
  assert.deepEqual(tile.calls, []);
  await world.accept();
  await world.hear(4);
  await world.answer({ kind: "match", song: SONG });
  assert.deepEqual(tile.calls, ["ended 1", "notify match I Will Survive", "finished"]);
});

test("once consent is given a capture that stalls fails as it does from the microphone", async () => {
  const world = setup({ otherPlaying: true, consent: "held" });
  const tile = fakeTile();
  followRecognizeTile(tile, world.deps, recognizeTileNotice);
  tile.tap(1);
  await settle();
  await world.accept();
  await world.hear(1);
  world.tick(7);
  await settle();
  assert.deepEqual(tile.calls, [
    "ended 1",
    "notify failure Couldn't recognize the song",
    "finished",
  ]);
  assert.match(world.logs[0]!, /failed/);
});

test("declining the consent dialog ends the session with no notification", async () => {
  const world = setup({ otherPlaying: true, consent: "held" });
  const tile = fakeTile();
  followRecognizeTile(tile, world.deps, recognizeTileNotice);
  tile.tap(1);
  await settle();
  await world.decline();
  assert.deepEqual(tile.calls, ["ended 1", "finished"]);
  assert.deepEqual(world.held, []);
  assert.equal(world.logs.length, 1);
});

test("Cancel while the consent dialog is up withdraws it, with no notification", async () => {
  const world = setup({ otherPlaying: true, consent: "held" });
  const tile = fakeTile();
  followRecognizeTile(tile, world.deps, recognizeTileNotice);
  tile.tap(2);
  await settle();
  tile.cancel(2);
  await settle();
  assert.deepEqual(world.native.cancelled, [world.native.requests[0]]);
  assert.deepEqual(tile.calls, ["ended 2", "finished"]);
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

/** A session that has got as far as Shazam naming [song]. */
const matched = async (
  world: ReturnType<typeof setup>,
  tile: ReturnType<typeof fakeTile>,
  tap: number,
  song = SONG,
) => {
  tile.tap(tap);
  await settle();
  await world.hear(4);
  await world.answer({ kind: "match", song });
};

test("a match goes to the Shazam playlist on its own, and the notification says so", async () => {
  const world = setup();
  const tile = fakeTile();
  followRecognizeTile(tile, world.deps, recognizeTileNotice);
  await matched(world, tile, 1);
  await settle();
  assert.deepEqual(world.saves, [resolved().result]);
  assert.deepEqual(tile.saved, [
    { line: "Added to Shazam", match: writeRecognizeMatch(SONG, resolved().result) },
  ]);
});

test("the notification says what the save said", async () => {
  const world = setup({ save: async () => "Already in Shazam" });
  const tile = fakeTile();
  followRecognizeTile(tile, world.deps, recognizeTileNotice);
  await matched(world, tile, 1);
  await settle();
  assert.equal(tile.saved[0]?.line, "Already in Shazam");
});

test("the tile lets go only after the save ends", async () => {
  let finishSave!: (line: string) => void;
  const world = setup({
    save: () => new Promise((resolve) => (finishSave = resolve)),
  });
  const tile = fakeTile();
  followRecognizeTile(tile, world.deps, recognizeTileNotice);
  await matched(world, tile, 1);
  await settle();
  assert.equal(tile.calls.includes("finished"), false);
  finishSave("Added to Shazam");
  await settle();
  assert.equal(tile.calls.at(-1), "finished");
});

test("a save that fails says so, warns without the song, and lets the tile go", async () => {
  const world = setup({ save: () => Promise.reject(new Error(`Disk full: ${SONG.title}`)) });
  const tile = fakeTile();
  followRecognizeTile(tile, world.deps, recognizeTileNotice);
  await matched(world, tile, 1);
  await settle();
  assert.equal(tile.saved[0]?.line, "Couldn't add to Shazam");
  assert.equal(tile.calls.at(-1), "finished");
  assert.equal(world.logLevels.at(-1), "warn");
  assert.equal(world.logs.join().includes(SONG.title), false);
});

test("the log line names the lookup and never the song", async () => {
  const world = setup();
  const tile = fakeTile();
  followRecognizeTile(tile, world.deps, recognizeTileNotice);
  await matched(world, tile, 1);
  await settle();
  assert.equal(world.logs.length, 1);
  assert.match(world.logs[0]!, /disabled/);
  for (const held of [SONG.title, SONG.artist, SONG.album!])
    assert.equal(world.logs[0]!.includes(held), false);
});

test("a save that ends after a newer match leaves its notification alone", async () => {
  const lookups: (() => void)[] = [];
  const world = setup({
    resolve: () => new Promise((resolve) => lookups.push(() => resolve(resolved()))),
  });
  const tile = fakeTile();
  followRecognizeTile(tile, world.deps, recognizeTileNotice);
  await matched(world, tile, 1);
  await matched(world, tile, 2, { ...SONG, title: "Le Freak" });
  lookups.shift()!();
  await settle();
  assert.equal(world.saves.length, 1);
  assert.deepEqual(tile.saved, []);
  lookups.shift()!();
  await settle();
  assert.equal(world.saves.length, 2);
  assert.equal(tile.saved.length, 1);
});

test("a session cancelled while listening saves nothing", async () => {
  const world = setup();
  const tile = fakeTile();
  followRecognizeTile(tile, world.deps, recognizeTileNotice);
  tile.tap(1);
  await settle();
  tile.cancel(1);
  await settle();
  assert.deepEqual(world.saves, []);
  assert.deepEqual(tile.saved, []);
});

test("a session from the card saves nothing on its own", async () => {
  const world = setup();
  const run = startRecognizeSession(
    world.deps,
    "microphone",
    () => undefined,
    () => undefined,
  );
  await settle();
  await world.hear(4);
  await world.answer({ kind: "match", song: SONG });
  await run.done;
  await settle();
  assert.deepEqual(world.saves, []);
});

test("a tap before the lookup ends gets its answer, with no second search or save", async () => {
  let settleLookup!: () => void;
  let searches = 0;
  const world = setup({
    resolve: () =>
      new Promise((resolve) => {
        searches++;
        settleLookup = () => resolve(resolved());
      }),
  });
  const tile = fakeTile();
  const following = followRecognizeTile(tile, world.deps, recognizeTileNotice);
  await matched(world, tile, 1);
  const shown = following.result(readRecognizeMatch(writeRecognizeMatch(SONG))!);
  settleLookup();
  assert.deepEqual(await shown, resolved().result);
  await settle();
  assert.equal(searches, 1);
  assert.equal(world.saves.length, 1);
});

test("a tap that arrives after the save, on what it kept before, still gets the answer", async () => {
  const world = setup();
  const tile = fakeTile();
  const following = followRecognizeTile(tile, world.deps, recognizeTileNotice);
  await matched(world, tile, 1);
  await settle();
  const shown = await following.result(readRecognizeMatch(writeRecognizeMatch(SONG))!);
  assert.deepEqual(shown, resolved().result);
  assert.equal(world.saves.length, 1);
});

test("a tap on a settled match reads the Library as it is now, and saves nothing", async () => {
  const track = {
    id: 9,
    title: SONG.title,
    artist: SONG.artist,
    album: "Love Tracks",
    durationMs: 200_000,
  };
  const world = setup({ library: async () => [track] });
  const tile = fakeTile();
  const following = followRecognizeTile(tile, world.deps, recognizeTileNotice);
  const kept = writeRecognizeMatch(SONG, {
    kind: "library",
    track,
    song: resolved().result.song as never,
  });
  const shown = await following.result(readRecognizeMatch(kept)!);
  assert.equal(shown.kind === "library" ? shown.track : null, track);
  assert.deepEqual(world.saves, []);
});

test("a Library that can't be read still shows a kept match", async () => {
  const world = setup({ library: () => Promise.reject(new Error("closed")) });
  const tile = fakeTile();
  const following = followRecognizeTile(tile, world.deps, recognizeTileNotice);
  const shown = await following.result(readRecognizeMatch(writeRecognizeMatch(SONG))!);
  assert.deepEqual(shown, resolved().result);
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

test("blocked phone audio offers Use Microphone, then a normal retry chooses phone audio again", async () => {
  const world = setup({ otherPlaying: true });
  const tile = fakeTile();
  followRecognizeTile(tile, world.deps, recognizeTileNotice);
  tile.tap(1);
  await settle();
  assert.deepEqual(world.native.sources, ["playback"]);
  await world.hear(4, false);
  assert.deepEqual(tile.calls, [
    "ended 1",
    "notify failure This app blocks audio capture",
    "finished",
  ]);
  tile.tap(2, true);
  await settle();
  assert.deepEqual(world.native.sources, ["playback", "microphone"]);
  assert.deepEqual(world.held, ["paused"]);
  tile.cancel(2);
  await settle();
  tile.tap(3);
  await settle();
  assert.deepEqual(world.native.sources, ["playback", "microphone", "playback"]);
  assert.deepEqual(world.held, ["paused", "resumed"]);
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
