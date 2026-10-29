import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { RecognizeAnswer, RecognizeCard, RecognizedSong } from "@wave/core";

import { startRecognizeSession, type RecognizeNative } from "./recognizeSession.ts";

const SONG: RecognizedSong = {
  title: "I Will Survive",
  artist: "Gloria Gaynor",
  album: "Love Tracks",
  coverUrl: null,
  isrc: "USUR10200634",
  releaseYear: 1978,
};

/** Lets pending promise callbacks run. */
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

/** A native module whose capture and answers the test drives. */
const fakeNative = (options: { startFails?: boolean } = {}) => {
  let heard: ((session: number, heardMs: number) => void) | null = null;
  let captureFailed: ((session: number) => void) | null = null;
  const answers: ((answer: RecognizeAnswer) => void)[] = [];
  const rejections: ((error: Error) => void)[] = [];
  const native = {
    started: 0,
    asks: [] as { session: number; last: boolean }[],
    stopped: [] as number[],
    start: async () => {
      if (options.startFails) throw new Error("The microphone couldn't be opened");
      native.started++;
      return 7;
    },
    ask: (session: number, last: boolean) => {
      native.asks.push({ session, last });
      return new Promise<RecognizeAnswer>((resolve, reject) => {
        answers.push(resolve);
        rejections.push(reject);
      });
    },
    stop: (session: number) => void native.stopped.push(session),
    onHeard: (listener: (session: number, heardMs: number) => void) => {
      heard = listener;
      return () => void (heard = null);
    },
    onCaptureFailed: (listener: (session: number) => void) => {
      captureFailed = listener;
      return () => void (captureFailed = null);
    },
    /** The capture has heard [seconds] in all. */
    hear: async (seconds: number, session = 7) => {
      heard?.(session, seconds * 1000);
      await settle();
    },
    /** Answers the oldest ask still out. */
    answer: async (answer: RecognizeAnswer) => {
      rejections.shift();
      answers.shift()?.(answer);
      await settle();
    },
    /** Rejects the oldest ask still out. */
    reject: async () => {
      rejections.shift()?.(new Error("The session has ended"));
      answers.shift();
      await settle();
    },
    failCapture: async () => {
      captureFailed?.(7);
      await settle();
    },
    get listening() {
      return heard !== null;
    },
  } satisfies RecognizeNative & Record<string, unknown>;
  return native;
};

const setup = (
  options: {
    online?: boolean;
    microphone?: "granted" | "denied";
    playing?: boolean;
    startFails?: boolean;
  } = {},
) => {
  const native = fakeNative(options);
  const cards: RecognizeCard[] = [];
  const lines: string[] = [];
  const levels: string[] = [];
  const playback = { playing: options.playing ?? false, pauses: 0, resumes: 0 };
  const session = startRecognizeSession(
    {
      online: () => options.online ?? true,
      microphone: async () => options.microphone ?? "granted",
      holdPlayback: async () => {
        if (!playback.playing) return () => undefined;
        playback.playing = false;
        playback.pauses++;
        return () => {
          playback.playing = true;
          playback.resumes++;
        };
      },
      native,
      log: (level, line) => {
        levels.push(level);
        lines.push(line);
      },
    },
    "microphone",
    (card) => void cards.push(card),
  );
  return { native, cards, lines, levels, playback, session, last: () => cards.at(-1) };
};

describe("a Recognize session", () => {
  test("listens, asks at 4 seconds and shows the match", async () => {
    const { native, last, lines, levels, session } = setup();
    await settle();
    assert.deepEqual(last(), { kind: "listening" });
    assert.equal(native.started, 1);

    await native.hear(3.75);
    assert.deepEqual(native.asks, []);
    await native.hear(4);
    assert.deepEqual(native.asks, [{ session: 7, last: false }]);

    await native.answer({ kind: "match", song: SONG });
    await session.done;
    assert.deepEqual(last(), { kind: "ended", end: { kind: "match", song: SONG } });
    assert.deepEqual(native.stopped, [7]);
    assert.equal(native.listening, false);
    assert.deepEqual(lines, ["Recognize through the microphone: a match after 4.0 s"]);
    assert.deepEqual(levels, ["info"]);
  });

  test("asks again at 8 and 12 seconds, then says No match", async () => {
    const { native, last, lines, session } = setup();
    await settle();
    await native.hear(4);
    await native.answer({ kind: "noMatch" });
    await native.hear(8);
    await native.answer({ kind: "noMatch" });
    await native.hear(12);
    await native.answer({ kind: "noMatch" });
    await session.done;

    assert.deepEqual(
      native.asks.map((ask) => ask.last),
      [false, false, true],
    );
    assert.deepEqual(last(), { kind: "ended", end: { kind: "noMatch" } });
    assert.deepEqual(lines, ["Recognize through the microphone: no match after 12.0 s"]);
  });

  test("ends with a refused ask's failure and its HTTP status", async () => {
    const { native, last, lines, levels, session } = setup();
    await settle();
    await native.hear(4);
    await native.answer({ kind: "failed", failure: "refused", status: 429 });
    await session.done;

    assert.deepEqual(last(), {
      kind: "ended",
      end: { kind: "failed", failure: "refused", status: 429 },
    });
    assert.deepEqual(lines, [
      "Recognize through the microphone: failed after 4.0 s (refused, HTTP 429)",
    ]);
    assert.deepEqual(levels, ["warn"]);
  });

  test("ignores another session's audio", async () => {
    const { native } = setup();
    await settle();
    await native.hear(4, 6);
    assert.deepEqual(native.asks, []);
  });

  test("offline, says No connection without capturing", async () => {
    const { native, last, lines, session } = setup({ online: false, playing: true });
    await session.done;
    assert.deepEqual(last(), { kind: "offline" });
    assert.equal(native.started, 0);
    assert.deepEqual(lines, ["Recognize through the microphone: offline, nothing heard"]);
  });

  test("with the microphone denied, says so without capturing", async () => {
    const { native, last, lines, playback, session } = setup({
      microphone: "denied",
      playing: true,
    });
    await session.done;
    assert.deepEqual(last(), { kind: "denied" });
    assert.equal(native.started, 0);
    assert.equal(playback.pauses, 0);
    assert.deepEqual(lines, [
      "Recognize through the microphone: microphone permission denied, nothing heard",
    ]);
  });

  test("a microphone that can't be opened is a capture failure", async () => {
    const { last, playback, session } = setup({ startFails: true, playing: true });
    await session.done;
    assert.deepEqual(last(), {
      kind: "ended",
      end: { kind: "failed", failure: "capture", status: null },
    });
    assert.equal(playback.playing, true);
  });

  test("a last ask the native side can't make still ends the session", async () => {
    const { native, last, session } = setup();
    await settle();
    await native.hear(4);
    await native.answer({ kind: "noMatch" });
    await native.hear(8);
    await native.answer({ kind: "noMatch" });
    await native.hear(12);
    await native.reject();
    await session.done;
    assert.deepEqual(last(), {
      kind: "ended",
      end: { kind: "failed", failure: "capture", status: null },
    });
  });

  test("audio that stops on its own ends it as a capture failure", async () => {
    const { native, last, session } = setup();
    await settle();
    await native.hear(2);
    await native.failCapture();
    await session.done;
    assert.deepEqual(last(), {
      kind: "ended",
      end: { kind: "failed", failure: "capture", status: null },
    });
  });

  test("Cancel stops the capture, logs once and ignores the answer still out", async () => {
    const { native, cards, lines, session } = setup();
    await settle();
    await native.hear(4.5);
    session.cancel();
    await session.done;
    await native.answer({ kind: "match", song: SONG });

    assert.deepEqual(native.stopped, [7]);
    assert.deepEqual(cards, [{ kind: "listening" }]);
    assert.deepEqual(lines, ["Recognize through the microphone: cancelled after 4.5 s"]);
    session.cancel();
    assert.equal(lines.length, 1);
  });

  test("Cancel before the capture started never starts it", async () => {
    const { native, lines, session } = setup();
    session.cancel();
    await session.done;
    assert.equal(native.started, 0);
    assert.deepEqual(lines, ["Recognize through the microphone: cancelled after 0.0 s"]);
  });
});

describe("Wave's playback during a session", () => {
  const endings: readonly [string, (native: ReturnType<typeof fakeNative>) => Promise<void>][] = [
    ["a match", (native) => native.answer({ kind: "match", song: SONG })],
    [
      "no match",
      async (native) => {
        await native.answer({ kind: "noMatch" });
        await native.hear(8);
        await native.answer({ kind: "noMatch" });
        await native.hear(12);
        await native.answer({ kind: "noMatch" });
      },
    ],
    ["an error", (native) => native.answer({ kind: "failed", failure: "network", status: null })],
    ["a capture failure", (native) => native.failCapture()],
  ];

  for (const [name, end] of endings) {
    test(`pauses while listening and resumes after ${name}`, async () => {
      const { native, playback, session } = setup({ playing: true });
      await settle();
      assert.equal(playback.playing, false);
      await native.hear(4);
      await end(native);
      await session.done;
      assert.deepEqual(playback, { playing: true, pauses: 1, resumes: 1 });
    });
  }

  test("resumes after Cancel", async () => {
    const { native, playback, session } = setup({ playing: true });
    await settle();
    await native.hear(2);
    session.cancel();
    await session.done;
    assert.deepEqual(playback, { playing: true, pauses: 1, resumes: 1 });
  });

  test("leaves paused playback paused", async () => {
    const { native, playback, session } = setup({ playing: false });
    await settle();
    await native.hear(4);
    await native.answer({ kind: "match", song: SONG });
    await session.done;
    assert.deepEqual(playback, { playing: false, pauses: 0, resumes: 0 });
  });
});
