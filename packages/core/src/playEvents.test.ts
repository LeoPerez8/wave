import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  EMPTY_PLAY_TRACKER,
  isCountedPlay,
  playSoFar,
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
  options: { durationMs?: number | null; context?: PlayEvent["context"] } = {},
): StateSignal => ({
  type: "state",
  at,
  key,
  status: "ready",
  playing: true,
  durationMs: options.durationMs === undefined ? 3 * MIN : options.durationMs,
  track: { trackId, context: options.context === undefined ? album : options.context },
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
      },
    ]);
  });

  test("skipping in Wave or from the notification ends the play as skipped", () => {
    const { ended, started } = run([
      playing(0, "1", "a"),
      moved(20_000, "2", "sync"),
      playing(20_100, "2", "b"),
      moved(150_100, "3", "seek"),
      playing(150_200, "3", "c"),
    ]);
    assert.deepEqual(
      ended.map((play) => [play.trackId, play.endReason, play.listenedMs, play.counted]),
      [
        ["a", "skipped", 20_000, false],
        ["b", "skipped", 130_000, true],
      ],
    );
    assert.deepEqual(
      started.map((play) => [play.trackId, play.startedAt]),
      [
        ["a", 0],
        ["b", 20_100],
        ["c", 150_200],
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
    const { ended, started } = run([
      playing(0, "1", "a"),
      { type: "restart", at: 60_000 },
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

describe("isCountedPlay", () => {
  test("counts a play listened to for half the track", () => {
    assert.equal(isCountedPlay(90_000, 3 * MIN), true);
    assert.equal(isCountedPlay(89_999, 3 * MIN), false);
  });

  test("counts four minutes of a long track before it reaches half", () => {
    assert.equal(isCountedPlay(4 * MIN, 20 * MIN), true);
    assert.equal(isCountedPlay(4 * MIN - 1, 20 * MIN), false);
  });

  test("falls back to the four-minute rule when the duration is unknown", () => {
    assert.equal(isCountedPlay(3 * MIN, null), false);
    assert.equal(isCountedPlay(4 * MIN, null), true);
    assert.equal(isCountedPlay(10_000, 0), false);
  });

  test("never counts a play that wasn't listened to", () => {
    assert.equal(isCountedPlay(0, 1_000), false);
  });
});
