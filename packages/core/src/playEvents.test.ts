import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  EMPTY_PLAY_TRACKER,
  fadingPlaySoFar,
  isCountedPlay,
  keptPlayingEntry,
  playSoFar,
  queueSourceAfter,
  RECAP_PLAY_CONTEXT,
  resumePlay,
  trackPlays,
  type PlayEvent,
  type PlaybackSignal,
  type PlayTrackerState,
} from "./index.ts";

const MIN = 60_000;
const album = { kind: "album", id: "7" } as const;

type StateSignal = Extract<PlaybackSignal, { type: "state" }>;

/** What the player reports: entry `key` (playing track `trackId`, from the album). */
const playing = (
  at: number,
  key: string,
  trackId: string,
  options: {
    durationMs?: number | null;
    context?: PlayEvent["context"];
    source?: PlayEvent["source"];
  } = {},
): StateSignal => ({
  type: "state",
  at,
  key,
  status: "ready",
  playing: true,
  durationMs: options.durationMs === undefined ? 3 * MIN : options.durationMs,
  track: {
    trackId,
    context: options.context === undefined ? album : options.context,
    source: options.source ?? "phone",
  },
});

const paused = (at: number, key: string, trackId: string): StateSignal => ({
  ...playing(at, key, trackId),
  playing: false,
});

const moved = (
  at: number,
  key: string | null,
  reason: Extract<PlaybackSignal, { type: "transition" }>["reason"],
): PlaybackSignal => ({ type: "transition", at, key, reason });

/** The player jumped from `fromMs` to `toMs` within entry `key`. */
const seeked = (at: number, key: string, fromMs: number, toMs: number): PlaybackSignal => ({
  type: "seek",
  at,
  key,
  fromMs,
  toMs,
});

/** Feeds the signals in order; returns the plays that started and ended, and the final state. */
const run = (
  signals: readonly PlaybackSignal[],
  from: PlayTrackerState = EMPTY_PLAY_TRACKER,
): { state: PlayTrackerState; started: PlayEvent[]; ended: PlayEvent[] } => {
  let state = from;
  const started: PlayEvent[] = [];
  const ended: PlayEvent[] = [];
  for (const signal of signals) {
    const result = trackPlays(state, signal);
    state = result.state;
    for (const step of result.steps) (step.type === "started" ? started : ended).push(step.play);
  }
  return { state, started, ended };
};

describe("trackPlays", () => {
  test("a track played through ends as a completed, counted play", () => {
    const { ended } = run([
      playing(1_000, "1", "a"),
      moved(181_000, "2", "auto"),
      playing(181_000, "2", "b"),
    ]);
    assert.deepEqual(ended, [
      {
        trackId: "a",
        context: album,
        startedAt: 1_000,
        listenedMs: 3 * MIN,
        durationMs: 3 * MIN,
        endReason: "completed",
        counted: true,
        source: "phone",
      },
    ]);
  });

  test("skipping in Wave or from the notification ends the play as skipped", () => {
    const { ended, started } = run([
      playing(0, "1", "a"),
      moved(10_000, "2", "sync"),
      playing(10_100, "2", "b"),
      moved(150_100, "3", "seek"),
      playing(150_200, "3", "c"),
    ]);
    assert.deepEqual(
      ended.map((play) => [play.trackId, play.endReason, play.listenedMs, play.counted]),
      [
        ["a", "skipped", 10_000, false],
        ["b", "skipped", 140_000, true],
      ],
    );
    assert.deepEqual(
      started.map((play) => [play.trackId, play.startedAt]),
      [
        ["a", 0],
        ["b", 10_100],
        ["c", 150_200],
      ],
    );
  });

  test("a streamed YT Music song is never on record, and the Library songs around it are", () => {
    const { started, ended } = run([
      playing(0, "1", "a"),
      moved(MIN, "2", "auto"),
      playing(MIN, "2", "yt:dQw4w9WgXcQ"),
      moved(5 * MIN, "3", "auto"),
      playing(5 * MIN, "3", "b"),
      moved(8 * MIN, "4", "seek"),
    ]);
    assert.deepEqual(
      started.map((play) => play.trackId),
      ["a", "b"],
    );
    assert.deepEqual(
      ended.map((play) => [play.trackId, play.endReason, play.listenedMs]),
      [
        ["a", "completed", MIN],
        ["b", "skipped", 3 * MIN],
      ],
    );
  });

  test("a song a Recap plays is never on record, and the queue's songs after it are", () => {
    const { started, ended } = run([
      playing(0, "1", "a", { context: RECAP_PLAY_CONTEXT }),
      moved(MIN, "2", "sync"),
      playing(MIN, "2", "b"),
      moved(4 * MIN, "3", "seek"),
    ]);
    assert.deepEqual(
      started.map((play) => play.trackId),
      ["b"],
    );
    assert.deepEqual(
      ended.map((play) => [play.trackId, play.listenedMs]),
      [["b", 3 * MIN]],
    );
  });

  test("a short song counts when played through, not when skipped before the end", () => {
    const { ended } = run([
      playing(0, "1", "jingle", { durationMs: 10_000 }),
      moved(10_000, "2", "auto"),
      playing(10_000, "2", "jingle", { durationMs: 10_000 }),
      moved(19_000, "3", "sync"),
    ]);
    assert.deepEqual(
      ended.map((play) => [play.endReason, play.listenedMs, play.counted]),
      [
        ["completed", 10_000, true],
        ["skipped", 9_000, false],
      ],
    );
  });

  test("time spent paused isn't listened, and resuming continues the same play", () => {
    const { ended, started } = run([
      playing(0, "1", "a"),
      paused(30_000, "1", "a"),
      playing(100_000, "1", "a"),
      moved(130_000, "2", "sync"),
    ]);
    assert.equal(started.length, 1);
    assert.deepEqual(
      ended.map((play) => [play.trackId, play.startedAt, play.listenedMs]),
      [["a", 0, 60_000]],
    );
  });

  test("the last track playing to its end is completed; playing it again is a new play", () => {
    const { ended, started } = run([
      playing(0, "9", "z"),
      { ...paused(180_000, "9", "z"), status: "ended" },
      { ...paused(181_000, "9", "z"), status: "ended" },
      playing(200_000, "9", "z"),
    ]);
    assert.deepEqual(
      ended.map((play) => [play.trackId, play.endReason, play.listenedMs]),
      [["z", "completed", 180_000]],
    );
    assert.deepEqual(
      started.map((play) => play.startedAt),
      [0, 200_000],
    );
  });

  test("each pass of a repeated track is a completed play of its own", () => {
    const { ended, started } = run([
      playing(0, "1", "a"),
      moved(180_000, "1", "repeat"),
      playing(180_000, "1", "a"),
      moved(200_000, "2", "sync"),
    ]);
    assert.deepEqual(
      ended.map((play) => [play.trackId, play.startedAt, play.endReason, play.listenedMs]),
      [
        ["a", 0, "completed", 180_000],
        ["a", 180_000, "skipped", 20_000],
      ],
    );
    assert.equal(started.length, 2);
  });

  test("the player failing mid-play ends the play as interrupted", () => {
    const { ended, state } = run([
      playing(0, "1", "a"),
      { ...paused(45_000, "1", "a"), status: "idle" },
    ]);
    assert.deepEqual(
      ended.map((play) => [play.trackId, play.endReason, play.listenedMs]),
      [["a", "interrupted", 45_000]],
    );
    assert.equal(state.play, null);
  });

  test("the player stopping after a pause ends the play as stopped", () => {
    const { ended } = run([
      playing(0, "1", "a"),
      paused(45_000, "1", "a"),
      { ...paused(300_000, "1", "a"), status: "idle" },
    ]);
    assert.deepEqual(
      ended.map((play) => [play.trackId, play.endReason, play.listenedMs]),
      [["a", "stopped", 45_000]],
    );
  });

  test("going back to the start of the track ends the play as skipped; the replay is a new play", () => {
    // "Previous" after three seconds, from Wave, the notification or a headset.
    const { ended, started } = run([
      playing(0, "1", "a"),
      seeked(60_000, "1", 60_000, 0),
      playing(60_100, "1", "a"),
      moved(80_100, "2", "sync"),
    ]);
    assert.deepEqual(
      ended.map((play) => [play.trackId, play.startedAt, play.endReason, play.listenedMs]),
      [
        ["a", 0, "skipped", 60_000],
        ["a", 60_100, "skipped", 20_000],
      ],
    );
    assert.equal(started.length, 2);
  });

  test("seeking elsewhere in the track, even near its start, goes on with the same play", () => {
    const { ended, started } = run([
      playing(0, "1", "a"),
      seeked(30_000, "1", 30_000, 120_000),
      seeked(40_000, "1", 130_000, 5_000),
      // Another entry's seek is for the transition to tell.
      seeked(55_000, "2", 20_000, 0),
      moved(60_000, "2", "sync"),
    ]);
    assert.equal(started.length, 1);
    assert.deepEqual(
      ended.map((play) => [play.trackId, play.endReason, play.listenedMs]),
      [["a", "skipped", 60_000]],
    );
  });

  test("going back to the start right after it started isn't a replay", () => {
    const { ended, started } = run([
      playing(0, "1", "a"),
      seeked(800, "1", 800, 0),
      moved(30_000, "2", "sync"),
    ]);
    assert.equal(started.length, 1);
    assert.deepEqual(
      ended.map((play) => play.listenedMs),
      [30_000],
    );
  });

  test("takes the track's length once the player knows it", () => {
    const { ended } = run([
      playing(0, "1", "a", { durationMs: null }),
      playing(500, "1", "a", { durationMs: 100_000 }),
      moved(60_000, "2", "sync"),
    ]);
    assert.deepEqual(
      ended.map((play) => [play.durationMs, play.counted]),
      [[100_000, true]],
    );
  });

  test("another entry showing up without a transition ends the play as skipped", () => {
    const { ended, started } = run([playing(0, "1", "a"), playing(10_000, "2", "b")]);
    assert.deepEqual(
      ended.map((play) => [play.trackId, play.endReason, play.listenedMs]),
      [["a", "skipped", 10_000]],
    );
    assert.deepEqual(
      started.map((play) => [play.trackId, play.startedAt]),
      [
        ["a", 0],
        ["b", 10_000],
      ],
    );
  });
});

describe("playSoFar", () => {
  test("a play still going on is on record as interrupted, should Wave's process die", () => {
    const { state, started } = run([playing(0, "1", "a")]);
    assert.deepEqual(
      started.map((play) => [play.endReason, play.listenedMs, play.counted]),
      [["interrupted", 0, false]],
    );
    const soFar = playSoFar(state, 100_000);
    assert.deepEqual(
      [soFar?.trackId, soFar?.endReason, soFar?.listenedMs, soFar?.counted],
      ["a", "interrupted", 100_000, true],
    );
  });

  test("a paused play is on record as stopped, with what was listened before the pause", () => {
    const { state } = run([playing(0, "1", "a"), paused(50_000, "1", "a")]);
    const soFar = playSoFar(state, 400_000);
    assert.deepEqual([soFar?.endReason, soFar?.listenedMs], ["stopped", 50_000]);
  });

  test("there is nothing on record before anything plays", () => {
    assert.equal(playSoFar(EMPTY_PLAY_TRACKER, 1_000), null);
    assert.equal(playSoFar(run([paused(0, "1", "a")]).state, 1_000), null);
  });
});

describe("play source", () => {
  test("a play records where its playback was started from, through to its end", () => {
    const { started, ended } = run([
      playing(0, "1", "a", { source: "auto" }),
      moved(180_000, "2", "auto"),
      playing(180_000, "2", "b", { source: "phone" }),
      moved(200_000, "3", "sync"),
    ]);
    assert.deepEqual(
      started.map((play) => [play.trackId, play.source]),
      [
        ["a", "auto"],
        ["b", "phone"],
      ],
    );
    assert.deepEqual(
      ended.map((play) => [play.trackId, play.source]),
      [
        ["a", "auto"],
        ["b", "phone"],
      ],
    );
  });

  test("a play picked back up after a JS restart keeps the source on record", () => {
    const resumed = resumePlay(
      {
        trackId: "a",
        context: album,
        startedAt: 0,
        listenedMs: 60_000,
        durationMs: 3 * MIN,
        endReason: "interrupted",
        counted: false,
        source: "auto",
      },
      playing(70_000, "1", "a"),
    );
    assert.ok(resumed);
    assert.equal(playSoFar(resumed, 80_000)?.source, "auto");
  });
});

describe("queueSourceAfter", () => {
  const play = { type: "play", trackIds: ["a"], context: album } as const;

  test("starting playback credits whoever started it", () => {
    assert.equal(queueSourceAfter("phone", play, "auto"), "auto");
    assert.equal(queueSourceAfter("auto", play, "phone"), "phone");
  });

  test("skips, mode changes and queue edits keep the source of the playback going on", () => {
    assert.equal(queueSourceAfter("auto", { type: "next" }, "phone"), "auto");
    assert.equal(queueSourceAfter("auto", { type: "jumpTo", key: "2" }, "phone"), "auto");
    assert.equal(
      queueSourceAfter("auto", { type: "addToQueue", trackIds: ["b"] }, "phone"),
      "auto",
    );
    assert.equal(queueSourceAfter("phone", { type: "setShuffle", on: true }, "auto"), "phone");
  });
});

describe("keptPlayingEntry", () => {
  test("when the player kept playing through a JS restart, its play on record goes on", () => {
    assert.equal(keptPlayingEntry("3", { resumedByPlayer: false }), "3");
  });

  test("when the player resumed the saved queue after a cold start, its plays are new ones", () => {
    assert.equal(keptPlayingEntry("3", { resumedByPlayer: true }), null);
  });

  test("with nothing current, no play goes on", () => {
    assert.equal(keptPlayingEntry(null, { resumedByPlayer: false }), null);
  });
});

describe("resumePlay", () => {
  /** What was on record for a play of `a` when Wave's JS went away. */
  const recorded = (overrides: Partial<PlayEvent> = {}): PlayEvent => ({
    trackId: "a",
    context: album,
    startedAt: 0,
    listenedMs: 60_000,
    durationMs: 3 * MIN,
    endReason: "interrupted",
    counted: false,
    source: "phone",
    ...overrides,
  });

  /** Resumes `play`, failing the test when it isn't picked back up. */
  const resume = (play: PlayEvent, signal: StateSignal): PlayTrackerState => {
    const resumed = resumePlay(play, signal);
    assert.ok(resumed, "the play is picked back up");
    return resumed;
  };

  test("a play the player kept going while JS restarted goes on, so the whole listen counts", () => {
    const resumed = resume(recorded(), playing(70_000, "1", "a"));
    const { started, ended } = run(
      [playing(70_500, "1", "a"), moved(100_000, "2", "auto")],
      resumed,
    );
    assert.equal(started.length, 0);
    assert.deepEqual(ended, [
      {
        trackId: "a",
        context: album,
        startedAt: 0,
        listenedMs: 90_000,
        durationMs: 3 * MIN,
        endReason: "completed",
        counted: true,
        source: "phone",
      },
    ]);
  });

  test("a paused play stays paused until the player resumes it", () => {
    const resumed = resume(
      recorded({ endReason: "stopped", listenedMs: 50_000 }),
      paused(400_000, "1", "a"),
    );
    assert.equal(playSoFar(resumed, 500_000)?.listenedMs, 50_000);
    const { ended } = run([playing(500_000, "1", "a"), moved(510_000, "2", "sync")], resumed);
    assert.deepEqual(
      ended.map((play) => [play.startedAt, play.listenedMs]),
      [[0, 60_000]],
    );
  });

  test("a play that had ended, or of another track or context, isn't picked back up", () => {
    assert.equal(resumePlay(recorded({ endReason: "completed" }), playing(1, "1", "a")), null);
    assert.equal(resumePlay(recorded({ endReason: "skipped" }), playing(1, "1", "a")), null);
    assert.equal(resumePlay(recorded(), playing(1, "1", "b")), null);
    assert.equal(resumePlay(recorded(), playing(1, "1", "a", { context: null })), null);
    assert.equal(resumePlay(recorded({ context: null }), playing(1, "1", "a")), null);
    assert.equal(resumePlay(recorded(), { ...playing(1, "1", "a"), status: "idle" }), null);
    assert.equal(resumePlay(recorded(), { ...playing(1, "1", "a"), track: null }), null);
  });
});

const counted = (
  listenedMs: number,
  durationMs: number | null,
  endReason: PlayEvent["endReason"] = "skipped",
): boolean => isCountedPlay({ listenedMs, durationMs, endReason });

describe("isCountedPlay", () => {
  test("counts a play listened to for more than 15 seconds", () => {
    assert.equal(counted(15_001, 3 * MIN), true);
    assert.equal(counted(15_000, 3 * MIN), false);
    assert.equal(counted(14_000, 3 * MIN, "stopped"), false);
  });

  test("counts more than 15 seconds whatever the track's length, known or not", () => {
    assert.equal(counted(16_000, 20 * MIN, "interrupted"), true);
    assert.equal(counted(16_000, null), true);
    assert.equal(counted(15_000, null), false);
  });

  test("counts a song of 15 seconds or less once it's played to the end", () => {
    assert.equal(counted(15_000, 15_000, "completed"), true);
    assert.equal(counted(8_000, 8_000, "completed"), true);
  });

  test("doesn't count a short song skipped, stopped or cut short before the end", () => {
    assert.equal(counted(7_000, 8_000, "skipped"), false);
    assert.equal(counted(7_000, 8_000, "stopped"), false);
    assert.equal(counted(7_000, 8_000, "interrupted"), false);
  });

  test("a longer song played to the end still needs more than 15 seconds of listening", () => {
    assert.equal(counted(10_000, 3 * MIN, "completed"), false);
    assert.equal(counted(10_000, null, "completed"), false);
  });

  test("never counts a play that wasn't listened to", () => {
    assert.equal(counted(0, 10_000, "completed"), false);
  });
});

const fadeEnded = (at: number): PlaybackSignal => ({ type: "fadeEnded", at });

describe("trackPlays with crossfade", () => {
  /** Song "a" (entry 1) plays from 1 s; at 176 s it starts fading into "b" (entry 2). */
  const overlap: readonly PlaybackSignal[] = [
    playing(1000, "1", "a"),
    moved(176_000, "2", "crossfade"),
    playing(176_000, "2", "b"),
  ];
  test("the next song's play starts with the overlap, and the outgoing one ends when its fade does", () => {
    const during = run(overlap);
    assert.deepEqual(
      during.started.map((play) => play.trackId),
      ["a", "b"],
    );
    assert.deepEqual(during.ended, []);

    const after = run([fadeEnded(181_000)], during.state);
    assert.deepEqual(
      after.ended.map((play) => [play.trackId, play.endReason, play.listenedMs, play.counted]),
      [["a", "completed", 180_000, true]],
    );
    assert.equal(playSoFar(after.state, 181_000)?.trackId, "b");
  });

  test("the outgoing song's progress is kept until its fade ends", () => {
    const { state } = run(overlap);
    const fading = fadingPlaySoFar(state, 178_000);
    assert.equal(fading?.trackId, "a");
    assert.equal(fading?.listenedMs, 177_000);
    assert.equal(fadingPlaySoFar(run([fadeEnded(181_000)], state).state, 182_000), null);
  });

  test("pausing during the overlap pauses both songs' listening time", () => {
    const { ended, state } = run([
      ...overlap,
      paused(178_000, "2", "b"),
      playing(188_000, "2", "b"),
      fadeEnded(191_000),
    ]);
    assert.equal(ended[0]?.listenedMs, 180_000);
    assert.equal(playSoFar(state, 191_000)?.listenedMs, 5000);
  });

  test("skipping during the overlap ends both: the outgoing song completed, the next one skipped", () => {
    const { ended } = run([...overlap, moved(178_000, "3", "seek"), playing(178_000, "3", "c")]);
    assert.deepEqual(
      ended.map((play) => [play.trackId, play.endReason, play.listenedMs]),
      [
        ["a", "completed", 177_000],
        ["b", "skipped", 2000],
      ],
    );
  });

  test("playback going away during the overlap cuts both songs short", () => {
    const { ended, state } = run([...overlap, { ...paused(178_000, "2", "b"), status: "idle" }]);
    assert.deepEqual(
      ended.map((play) => [play.trackId, play.endReason]),
      [
        ["a", "interrupted"],
        ["b", "interrupted"],
      ],
    );
    assert.equal(fadingPlaySoFar(state, 179_000), null);
  });

  test("a streamed song fading into a Library song opens only the Library song's play", () => {
    const { started, ended } = run([
      playing(1000, "1", "yt:abc"),
      moved(176_000, "2", "crossfade"),
      playing(176_000, "2", "b"),
      fadeEnded(181_000),
    ]);
    assert.deepEqual(
      started.map((play) => play.trackId),
      ["b"],
    );
    assert.deepEqual(ended, []);
  });
});
