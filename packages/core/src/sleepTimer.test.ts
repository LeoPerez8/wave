import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { catalogueOf } from "./localisation.ts";
import {
  CUSTOM_SLEEP_MINUTES,
  formatSleepMinutes,
  formatSleepRemaining,
  sleepTimerRemaining,
  startSleepTimer,
  stepSleepMinutes,
} from "./index.ts";

describe("startSleepTimer", () => {
  test("a 30-minute timer set at 22:00 stops playback at 22:30", () => {
    const now = Date.UTC(2026, 9, 11, 22, 0);
    assert.deepEqual(startSleepTimer({ type: "minutes", minutes: 30 }, now), {
      type: "deadline",
      endsAt: Date.UTC(2026, 9, 11, 22, 30),
    });
  });

  test("end of track waits for the playing track to finish rather than a clock time", () => {
    assert.deepEqual(startSleepTimer({ type: "endOfTrack" }, 1_000), { type: "endOfTrack" });
  });

  test("a duration of no time, negative or not a number starts nothing", () => {
    for (const minutes of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      assert.equal(startSleepTimer({ type: "minutes", minutes }, 1_000), null, String(minutes));
    }
  });
});

describe("sleepTimerRemaining", () => {
  const playhead = { positionMs: 60_000, durationMs: 240_000 };

  test("a deadline counts down on the clock, whatever the track is doing", () => {
    const timer = { type: "deadline", endsAt: 1_800_000 } as const;
    assert.equal(sleepTimerRemaining(timer, { now: 1_000_000, ...playhead }), 800_000);
  });

  test("a deadline that has passed, before the player has caught up, reads no time left", () => {
    const timer = { type: "deadline", endsAt: 1_800_000 } as const;
    assert.equal(sleepTimerRemaining(timer, { now: 1_800_400, ...playhead }), 0);
  });

  test("end of track is what is left of the playing track", () => {
    const timer = { type: "endOfTrack" } as const;
    assert.equal(sleepTimerRemaining(timer, { now: 1_000_000, ...playhead }), 180_000);
  });

  test("end of track isn't known until the track's duration is", () => {
    const timer = { type: "endOfTrack" } as const;
    const clock = { now: 1_000_000, positionMs: 0, durationMs: null };
    assert.equal(sleepTimerRemaining(timer, clock), null);
  });

  test("end of track reads no time left once the playhead reaches the end", () => {
    const timer = { type: "endOfTrack" } as const;
    const clock = { now: 1_000_000, positionMs: 240_300, durationMs: 240_000 };
    assert.equal(sleepTimerRemaining(timer, clock), 0);
  });
});

describe("stepSleepMinutes", () => {
  test("under ten minutes, the custom duration moves a minute at a time", () => {
    assert.equal(stepSleepMinutes(5, 1), 6);
    assert.equal(stepSleepMinutes(5, -1), 4);
  });

  test("from ten minutes to an hour, it moves five minutes at a time", () => {
    assert.equal(stepSleepMinutes(10, 1), 15);
    assert.equal(stepSleepMinutes(15, -1), 10);
    assert.equal(stepSleepMinutes(10, -1), 9);
    assert.equal(stepSleepMinutes(55, 1), 60);
  });

  test("from an hour up, it moves a quarter of an hour at a time", () => {
    assert.equal(stepSleepMinutes(60, 1), 75);
    assert.equal(stepSleepMinutes(75, -1), 60);
    assert.equal(stepSleepMinutes(60, -1), 55);
  });

  test("it holds between one minute and twelve hours", () => {
    assert.equal(stepSleepMinutes(1, -1), 1);
    assert.equal(stepSleepMinutes(720, 1), 720);
    assert.equal(CUSTOM_SLEEP_MINUTES.min, 1);
    assert.equal(CUSTOM_SLEEP_MINUTES.max, 720);
  });
});

describe("formatSleepRemaining", () => {
  test("counts down in whole seconds, rounding up, so a fresh 15-minute timer reads 15:00", () => {
    assert.equal(formatSleepRemaining(899_400), "15:00");
    assert.equal(formatSleepRemaining(61_000), "1:01");
    assert.equal(formatSleepRemaining(3_725_000), "1:02:05");
    assert.equal(formatSleepRemaining(0), "0:00");
  });
});

describe("formatSleepMinutes", () => {
  test("reads in minutes under an hour, and in hours and minutes from there", () => {
    assert.equal(formatSleepMinutes(45), "45 min");
    assert.equal(formatSleepMinutes(90), "1 h 30 min");
    assert.equal(formatSleepMinutes(120), "2 h");
  });

  test("reads the app's units in Portuguese", () => {
    const pt = catalogueOf("pt-BR");
    assert.equal(formatSleepMinutes(45, pt), "45 min");
    assert.equal(formatSleepMinutes(90, pt), "1 h 30 min");
    assert.equal(formatSleepMinutes(120, pt), "2 h");
  });
});
