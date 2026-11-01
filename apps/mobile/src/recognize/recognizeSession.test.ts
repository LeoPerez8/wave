import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  resolveRecognizedSong,
  type RecognizeAnswer,
  type RecognizeCard,
  type RecognizedSong,
  type RecognizeSource,
} from "@wave/core";

import {
  startRecognizeSession,
  type RecognizeNative,
  type RecognizeDeps,
} from "./recognizeSession.ts";

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
const fakeNative = (
  options: { startFails?: boolean; otherPlaying?: boolean; consentDeclined?: boolean } = {},
) => {
  let heard: ((session: number, heardMs: number, audible: boolean) => void) | null = null;
  let captureFailed: ((session: number) => void) | null = null;
  const answers: ((answer: RecognizeAnswer) => void)[] = [];
  const rejections: ((error: Error) => void)[] = [];
  const native = {
    started: 0,
    asks: [] as { session: number; last: boolean }[],
    stopped: [] as number[],
    sources: [] as RecognizeSource[],
    playbackActivity: async () => ({
      activeMediaPlayers: options.otherPlaying ? 1 : 0,
      waveMediaPlayers: 0,
    }),
    cancelledStarts: [] as number[],
    requests: [] as number[],
    cancelStart: (request: number) => void native.cancelledStarts.push(request),
    start: async (source: RecognizeSource, request: number): Promise<number> => {
      native.sources.push(source);
      native.requests.push(request);
      if (options.consentDeclined) throw { code: "ERR_RECOGNIZE_CONSENT" };
      if (options.startFails) throw new Error("The microphone couldn't be opened");
      native.started++;
      return 6 + native.started;
    },
    ask: (session: number, last: boolean) => {
      native.asks.push({ session, last });
      return new Promise<RecognizeAnswer>((resolve, reject) => {
        answers.push(resolve);
        rejections.push(reject);
      });
    },
    stop: (session: number) => void native.stopped.push(session),
    onHeard: (listener: (session: number, heardMs: number, audible: boolean) => void) => {
      heard = listener;
      return () => void (heard = null);
    },
    onCaptureFailed: (listener: (session: number) => void) => {
      captureFailed = listener;
      return () => void (captureFailed = null);
    },
    /** The capture has heard [seconds] in all. */
    hear: async (seconds: number, session = 7, audible = true) => {
      heard?.(session, seconds * 1000, audible);
      await settle();
    },
    /** Answers the oldest ask still out. */
    answer: async (answer: RecognizeAnswer) => {
      rejections.shift();
      answers.shift()?.(answer);
      await settle();
    },
    /** Rejects the oldest ask still out. */
    reject: async (code = "ERR_RECOGNIZE_ENDED") => {
      rejections.shift()?.(Object.assign(new Error("The ask failed"), { code }));
      answers.shift();
      await settle();
    },
    failCapture: async (session = 7) => {
      captureFailed?.(session);
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
    askMicrophone?: RecognizeDeps["microphone"];
    playing?: boolean;
    startFails?: boolean;
    otherPlaying?: boolean;
    consentDeclined?: boolean;
    source?: RecognizeSource | "auto";
    resolve?: RecognizeDeps["resolve"];
  } = {},
) => {
  const native = fakeNative(options);
  const cards: RecognizeCard[] = [];
  const lines: string[] = [];
  const levels: string[] = [];
  const playback = { playing: options.playing ?? false, pauses: 0, resumes: 0 };
  const clock = fakeClock();
  const app = { foreground: true, closes: 0 };
  const deps: RecognizeDeps = {
    online: () => options.online ?? true,
    foreground: () => app.foreground,
    now: clock.now,
    every: clock.every,
    microphone: options.askMicrophone ?? (async () => options.microphone ?? "granted"),
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
    resolve:
      options.resolve ??
      (async (song) => {
        const answer = resolveRecognizedSong(song, [], "disabled");
        if (answer.kind !== "resolved") throw new Error("Expected a result");
        return answer;
      }),
    log: (level, line) => {
      levels.push(level);
      lines.push(line);
    },
  };
  const session = startRecognizeSession(
    deps,
    options.source ?? "microphone",
    (card) => void cards.push(card),
    () => void app.closes++,
  );
  return {
    deps,
    native,
    cards,
    lines,
    levels,
    playback,
    clock,
    app,
    session,
    last: () => cards.at(-1),
  };
};

/** A clock the test moves: `every` timers fire as it passes them. */
const fakeClock = () => {
  let now = 0;
  const timers = new Set<{ ms: number; next: number; tick: () => void }>();
  return {
    now: () => now,
    every: (ms: number, tick: () => void) => {
      const timer = { ms, next: now + ms, tick };
      timers.add(timer);
      return () => void timers.delete(timer);
    },
    get running() {
      return timers.size;
    },
    /** Moves the clock on by [seconds], firing each timer it passes, then settles. */
    advance: async (seconds: number) => {
      const until = now + seconds * 1000;
      for (;;) {
        const due = [...timers].filter((timer) => timer.next <= until);
        if (due.length === 0) break;
        const timer = due.reduce((a, b) => (a.next <= b.next ? a : b));
        now = timer.next;
        timer.next += timer.ms;
        timer.tick();
        await settle();
      }
      now = until;
      await settle();
    },
  };
};

describe("a Recognize session", () => {
  for (const source of ["microphone", "playback"] as const) {
    test(`leaving Wave cancels active ${source} capture and releases playback`, async () => {
      const { session, native, playback, lines } = setup({ source, playing: true });
      await settle();
      await native.hear(2);
      assert.equal(session.cancelOnBackground(), true);
      await session.done;
      assert.deepEqual(native.stopped, [7]);
      assert.equal(native.listening, false);
      assert.equal(playback.playing, true);
      assert.match(lines[0]!, /cancelled after 2.0 s/);
    });
  }

  test("Android's phone-audio consent may pause Wave without cancelling the launch", async () => {
    const { native, session } = setup({ source: "playback" });
    let grant!: (id: number) => void;
    native.start = () =>
      new Promise<number>((resolve) => {
        grant = resolve;
      });
    await settle();
    assert.equal(session.cancelOnBackground(), false);
    assert.deepEqual(native.cancelledStarts, []);
    grant(7);
    await settle();
    assert.equal(session.cancelOnBackground(), true);
    await session.done;
    assert.deepEqual(native.stopped, [7]);
    assert.equal(native.listening, false);
  });

  test("switching sources restarts at four seconds and ignores the previous source's answer", async () => {
    const { deps, native, session, cards, playback } = setup({
      source: "microphone",
      playing: true,
    });
    await settle();
    await native.hear(8);
    session.cancel();
    await session.done;
    const phone = startRecognizeSession(
      deps,
      "playback",
      (card) => void cards.push(card),
      () => undefined,
    );
    await settle();
    assert.equal(playback.playing, true);
    await native.answer({ kind: "match", song: SONG });
    assert.equal(cards.at(-1)?.kind, "listening");
    await native.hear(3.75, 8);
    assert.equal(native.asks.length, 1);
    await native.hear(4, 8);
    assert.deepEqual(native.asks.at(-1), { session: 8, last: false });
    phone.cancel();
    await phone.done;
    assert.deepEqual(native.stopped, [7, 8]);
  });

  test("switching away while consent is pending cancels that start and stops any late capture", async () => {
    const { deps, native, session } = setup({ source: "playback" });
    let grant!: (id: number) => void;
    native.start = async (source, request) => {
      native.requests.push(request);
      return source === "playback"
        ? new Promise<number>((resolve) => {
            grant = resolve;
          })
        : 8;
    };
    await settle();
    const oldRequest = native.requests[0];
    session.cancel();
    await session.done;
    assert.deepEqual(native.cancelledStarts, [oldRequest]);
    const microphone = startRecognizeSession(
      deps,
      "microphone",
      () => undefined,
      () => undefined,
    );
    await settle();
    grant(7);
    await settle();
    assert.deepEqual(native.stopped, [7]);
    assert.notEqual(native.requests[1], oldRequest);
    microphone.cancel();
    await microphone.done;
    assert.deepEqual(native.stopped, [7, 8]);
  });
  test("automatic choice uses the microphone when nothing else plays", async () => {
    const { native, session } = setup({ source: "auto" });
    await settle();
    assert.deepEqual(native.sources, ["microphone"]);
    session.cancel();
    await session.done;
  });

  test("silent phone capture offers the microphone without sending a signature", async () => {
    const { native, session, last } = setup({ source: "playback" });
    await settle();
    await native.hear(4, 7, false);
    await session.done;
    assert.deepEqual(last(), { kind: "ended", end: { kind: "blocked" } });
    assert.deepEqual(native.asks, []);
    assert.deepEqual(native.stopped, [7]);
  });

  test("declining Android's capture consent ends with its own message", async () => {
    const { session, last, lines } = setup({ source: "playback", consentDeclined: true });
    await session.done;
    assert.deepEqual(last(), { kind: "ended", end: { kind: "consentDeclined" } });
    assert.deepEqual(lines, [
      "Recognize through this phone: capture consent declined, nothing heard",
    ]);
  });
  test("automatically captures another app without pausing Wave", async () => {
    const { native, playback, session, lines } = setup({
      source: "auto",
      otherPlaying: true,
      playing: true,
    });
    await settle();
    assert.deepEqual(native.sources, ["playback"]);
    assert.equal(playback.pauses, 0);
    await native.hear(4);
    await native.answer({ kind: "match", song: SONG });
    await session.done;
    assert.deepEqual(lines, [
      "Recognize through this phone: a match after 4.0 s, YT Music lookup: disabled",
    ]);
  });
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
    assert.deepEqual(last(), {
      kind: "resolved",
      result: {
        kind: "unsearched",
        song: {
          title: SONG.title,
          artists: [SONG.artist],
          album: SONG.album,
          artworkUrl: null,
          durationMs: null,
        },
      },
    });
    assert.deepEqual(native.stopped, [7]);
    assert.equal(native.listening, false);
    assert.deepEqual(lines, [
      "Recognize through the microphone: a match after 4.0 s, YT Music lookup: disabled",
    ]);
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
    await native.answer({ kind: "failed", failure: "refused", status: 403 });
    await session.done;

    assert.deepEqual(last(), {
      kind: "ended",
      end: { kind: "failed", failure: "refused", status: 403 },
    });
    assert.deepEqual(lines, [
      "Recognize through the microphone: failed after 4.0 s (refused, HTTP 403)",
    ]);
    assert.deepEqual(levels, ["warn"]);
  });

  test("a rate limit at 4 seconds keeps listening and the next ask can name the song", async () => {
    const { native, last, lines, session } = setup();
    await settle();
    await native.hear(4);
    await native.answer({ kind: "failed", failure: "refused", status: 429 });
    assert.deepEqual(last(), { kind: "listening" });
    assert.deepEqual(native.stopped, []);

    await native.hear(8);
    assert.deepEqual(
      native.asks.map((ask) => ask.last),
      [false, false],
    );
    await native.answer({ kind: "match", song: SONG });
    await session.done;
    assert.equal(last()?.kind, "resolved");
    assert.deepEqual(lines, [
      "Recognize through the microphone: a match after 8.0 s, 1 request failed before it, YT Music lookup: disabled",
    ]);
  });

  test("the last step's retry goes out on the clock, and its failure shows on the card", async () => {
    const { native, last, lines, session, clock } = setup();
    const unanswered = { kind: "failed", failure: "network", status: null } as const;
    await settle();
    await native.hear(1);
    await clock.advance(1);
    await native.hear(4);
    await native.answer({ kind: "noMatch" });
    await clock.advance(1);
    await native.hear(8);
    await native.answer({ kind: "noMatch" });
    await clock.advance(1);
    await native.hear(12);
    await native.answer(unanswered);
    assert.equal(native.asks.length, 3);

    await clock.advance(1);
    assert.deepEqual(native.asks.at(-1), { session: 7, last: true });
    assert.equal(native.asks.length, 4);
    await native.answer(unanswered);
    await clock.advance(2);
    assert.equal(native.asks.length, 5);
    await native.answer(unanswered);
    await clock.advance(4);
    assert.equal(native.asks.length, 6);
    await native.answer(unanswered);
    await session.done;

    assert.deepEqual(last(), { kind: "ended", end: unanswered });
    assert.deepEqual(lines, [
      "Recognize through the microphone: failed after 12.0 s (network), 3 requests failed before it",
    ]);
  });

  test("Cancel during a retry's wait sends nothing more and ignores the answer still out", async () => {
    const { native, cards, lines, session, clock } = setup();
    await settle();
    await native.hear(4);
    await native.answer({ kind: "noMatch" });
    await native.hear(8);
    await native.answer({ kind: "noMatch" });
    await native.hear(12);
    await native.answer({ kind: "failed", failure: "refused", status: 503 });
    session.cancel();
    await session.done;
    await clock.advance(2);
    await native.answer({ kind: "match", song: SONG });

    assert.equal(native.asks.length, 3);
    assert.deepEqual(cards, [{ kind: "listening" }]);
    assert.deepEqual(lines, [
      "Recognize through the microphone: cancelled after 12.0 s, 1 request failed before it",
    ]);
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
    const { last, playback, session, clock } = setup({ startFails: true, playing: true });
    await settle();
    await clock.advance(1);
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

  test("an ask that fails for another reason than an ended session isn't a capture failure", async () => {
    for (const code of ["ERR_RECOGNIZE_ASK", "ERR_UNEXPECTED"]) {
      const { native, last, lines, session } = setup();
      await settle();
      await native.hear(4);
      await native.reject(code);
      await session.done;
      assert.deepEqual(last(), {
        kind: "ended",
        end: { kind: "failed", failure: "unreadable", status: null },
      });
      assert.deepEqual(lines, [
        "Recognize through the microphone: failed after 4.0 s (unreadable)",
      ]);
    }
  });

  test("audio that stops on its own ends it as a capture failure", async () => {
    const { native, last, session, clock, app } = setup();
    await settle();
    await native.hear(2);
    await native.failCapture();
    assert.equal(last()?.kind, "listening");
    await clock.advance(1);
    await session.done;
    assert.equal(app.closes, 0);
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

describe("Android pausing Wave", () => {
  test("the microphone permission dialog doesn't cancel the session", async () => {
    let answer!: (permission: "granted" | "denied") => void;
    const { native, session, app } = setup({
      askMicrophone: () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    });
    await settle();
    app.foreground = false;
    assert.equal(session.cancelOnBackground(), false);
    answer("granted");
    app.foreground = true;
    await settle();
    assert.equal(native.started, 1);
    await native.hear(4);
    assert.deepEqual(native.asks, [{ session: 7, last: false }]);
    assert.equal(session.cancelOnBackground(), true);
    await session.done;
  });

  test("a capture that stops as Wave is hidden ends as Cancel and closes the card", async () => {
    const { native, session, cards, lines, levels, app, clock, playback } = setup({
      playing: true,
    });
    await settle();
    await native.hear(2);
    // The capture's report reaches JS before the app state does.
    await native.failCapture();
    app.foreground = false;
    await clock.advance(0.5);
    await session.done;
    assert.deepEqual(cards, [{ kind: "listening" }]);
    assert.equal(app.closes, 1);
    assert.deepEqual(lines, ["Recognize through the microphone: cancelled after 2.0 s"]);
    assert.deepEqual(levels, ["info"]);
    assert.equal(playback.playing, true);
  });

  test("a capture that stops, then the app state's Cancel, ends once as Cancel", async () => {
    const { native, session, cards, lines, app, clock } = setup();
    await settle();
    await native.hear(2);
    await native.failCapture();
    app.foreground = false;
    assert.equal(session.cancelOnBackground(), true);
    await clock.advance(2);
    await session.done;
    assert.deepEqual(cards, [{ kind: "listening" }]);
    assert.equal(app.closes, 0);
    assert.deepEqual(lines, ["Recognize through the microphone: cancelled after 2.0 s"]);
  });

  test("phone audio whose start ends as Wave is hidden ends as Cancel", async () => {
    // Native ends a start still binding its service when Wave goes to the background,
    // and Wave may be back by the time the clock ticks.
    const { native, session, cards, app, lines } = setup({ source: "playback" });
    let fail!: (error: unknown) => void;
    native.start = () =>
      new Promise<number>((_resolve, reject) => {
        fail = reject;
      });
    await settle();
    app.foreground = false;
    assert.equal(session.cancelOnBackground(), false);
    app.foreground = true;
    fail({ code: "ERR_RECOGNIZE_ENDED" });
    await session.done;
    assert.deepEqual(cards, [{ kind: "listening", source: "playback" }]);
    assert.equal(app.closes, 1);
    assert.deepEqual(lines, ["Recognize through this phone: cancelled after 0.0 s"]);
  });

  test("phone audio whose start fails while Wave is hidden ends as Cancel", async () => {
    const { native, session, cards, app, clock, lines } = setup({ source: "playback" });
    let fail!: (error: unknown) => void;
    native.start = () =>
      new Promise<number>((_resolve, reject) => {
        fail = reject;
      });
    await settle();
    app.foreground = false;
    assert.equal(session.cancelOnBackground(), false);
    fail({ code: "ERR_RECOGNIZE_CAPTURE" });
    await clock.advance(1);
    await session.done;
    assert.deepEqual(cards, [{ kind: "listening", source: "playback" }]);
    assert.equal(app.closes, 1);
    assert.deepEqual(lines, ["Recognize through this phone: cancelled after 0.0 s"]);
  });
});

describe("a session that stalls", () => {
  test("a start that never settles ends as a capture failure and stops the clock", async () => {
    const { native, session, last, clock, playback } = setup({ playing: true });
    native.start = () => new Promise<number>(() => undefined);
    await settle();
    await clock.advance(2.5);
    assert.equal(last()?.kind, "listening");
    await clock.advance(0.5);
    await session.done;
    assert.deepEqual(last(), {
      kind: "ended",
      end: { kind: "failed", failure: "capture", status: null },
    });
    assert.equal(native.cancelledStarts.length, 1);
    assert.equal(playback.playing, true);
    assert.equal(clock.running, 0);
  });

  test("audio that stops advancing ends it as a capture failure", async () => {
    const { native, session, last, lines, clock } = setup();
    await settle();
    await native.hear(1);
    await clock.advance(2);
    await native.hear(2);
    await clock.advance(2.5);
    assert.equal(last()?.kind, "listening");
    await clock.advance(0.5);
    await session.done;
    assert.deepEqual(native.stopped, [7]);
    assert.deepEqual(lines, ["Recognize through the microphone: failed after 2.0 s (capture)"]);
  });

  test("the time behind Android's consent dialog doesn't count", async () => {
    const { native, session, last, app, clock } = setup({ source: "playback" });
    let grant!: (id: number) => void;
    native.start = () =>
      new Promise<number>((resolve) => {
        grant = resolve;
      });
    await settle();
    app.foreground = false;
    await clock.advance(20);
    app.foreground = true;
    grant(7);
    await native.hear(1);
    await clock.advance(2);
    assert.equal(last()?.kind, "listening");
    session.cancel();
    await session.done;
  });
});

describe("native reports that come before the session's id", () => {
  test("a capture failure before the start settles still ends the session", async () => {
    const { native, session, last, clock } = setup();
    let started!: (id: number) => void;
    native.start = () =>
      new Promise<number>((resolve) => {
        started = resolve;
      });
    await settle();
    await native.failCapture(7);
    started(7);
    await settle();
    await clock.advance(1);
    await session.done;
    assert.deepEqual(last(), {
      kind: "ended",
      end: { kind: "failed", failure: "capture", status: null },
    });
  });

  test("audio heard before the start settles counts, and another session's doesn't", async () => {
    const { native, session } = setup();
    let started!: (id: number) => void;
    native.start = () =>
      new Promise<number>((resolve) => {
        started = resolve;
      });
    await settle();
    await native.hear(4, 6);
    await native.failCapture(6);
    await native.hear(4, 7);
    assert.deepEqual(native.asks, []);
    started(7);
    await settle();
    assert.deepEqual(native.asks, [{ session: 7, last: false }]);
    await native.answer({ kind: "match", song: SONG });
    await session.done;
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
    [
      "an error",
      (native) => native.answer({ kind: "failed", failure: "unreadable", status: null }),
    ],
    [
      "a capture failure",
      async (native) => {
        await native.failCapture();
        await native.answer({ kind: "noMatch" });
      },
    ],
  ];

  for (const [name, end] of endings) {
    test(`pauses while listening and resumes after ${name}`, async () => {
      const { native, playback, session, clock } = setup({ playing: true });
      await settle();
      assert.equal(playback.playing, false);
      await native.hear(4);
      await end(native);
      await clock.advance(1);
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

test("a match stops capturing and resumes playback while the card waits for its playable result", async () => {
  let deliver!: (value: Awaited<ReturnType<RecognizeDeps["resolve"]>>) => void;
  const pending = new Promise<Awaited<ReturnType<RecognizeDeps["resolve"]>>>((resolve) => {
    deliver = resolve;
  });
  const { native, last, lines, playback, session } = setup({
    playing: true,
    resolve: () => pending,
  });
  await settle();
  await native.hear(4);
  await native.answer({ kind: "match", song: SONG });
  assert.equal(playback.playing, true);
  assert.deepEqual(native.stopped, [7]);
  assert.deepEqual(last(), { kind: "resolving", song: SONG });
  assert.deepEqual(lines, []);
  const answer = resolveRecognizedSong(SONG, [], "disabled");
  if (answer.kind !== "resolved") throw new Error("Expected a result");
  deliver(answer);
  await session.done;
  assert.deepEqual(last(), { kind: "resolved", result: answer.result });
  assert.deepEqual(lines, [
    "Recognize through the microphone: a match after 4.0 s, YT Music lookup: disabled",
  ]);
});

test("closing during lookup withdraws the search and ignores its late result, logging once", async () => {
  let deliver!: (value: Awaited<ReturnType<RecognizeDeps["resolve"]>>) => void;
  let signal: AbortSignal | undefined;
  const pending = new Promise<Awaited<ReturnType<RecognizeDeps["resolve"]>>>((resolve) => {
    deliver = resolve;
  });
  const { native, cards, lines, session } = setup({
    resolve: (_song, abort) => {
      signal = abort;
      return pending;
    },
  });
  await settle();
  await native.hear(4);
  await native.answer({ kind: "match", song: SONG });
  session.cancel();
  await session.done;
  assert.equal(signal?.aborted, true);
  const shown = [...cards];
  const answer = resolveRecognizedSong(SONG, [], "disabled");
  if (answer.kind !== "resolved") throw new Error("Expected a result");
  deliver(answer);
  await settle();
  assert.deepEqual(cards, shown);
  assert.deepEqual(lines, [
    "Recognize through the microphone: a match after 4.0 s, YT Music lookup: cancelled",
  ]);
  assert.deepEqual(native.stopped, [7]);
});

test("a failed lookup still offers an unsearched result and logs a warning", async () => {
  const { native, last, levels, lines, session } = setup({
    resolve: async () => {
      throw new Error("Lookup failed");
    },
  });
  await settle();
  await native.hear(4);
  await native.answer({ kind: "match", song: SONG });
  await session.done;
  assert.equal(last()?.kind, "resolved");
  const card = last();
  if (card?.kind === "resolved") assert.equal(card.result.kind, "unsearched");
  assert.deepEqual(levels, ["warn"]);
  assert.deepEqual(lines, [
    "Recognize through the microphone: a match after 4.0 s, YT Music lookup: failed",
  ]);
});
