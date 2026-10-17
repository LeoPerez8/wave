import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { PERF_FLUSH_QUIET_MS, PERF_LOG_TAG, createPerfRecorder, parsePerfLog } from "./index.ts";

/** A clock the test moves by hand, in ms. */
const clock = (start = 1_000) => {
  let now = start;
  return { now: () => now, advance: (ms: number) => (now += ms) };
};

/** Lines as logcat prints them from a release build's console.log. */
const logcat = (lines: readonly string[]): string =>
  lines.map((line) => `10-16 12:00:00.000  4242  4300 I ReactNativeJS: ${line}`).join("\n");

describe("perf recorder and log", () => {
  test("a drained mark reads back from logcat", () => {
    const recorder = createPerfRecorder({ now: clock().now });
    recorder.mark("route", "/settings");
    const [flush] = parsePerfLog(logcat(recorder.drain()));
    assert.equal(flush?.complete, true);
    assert.deepEqual(flush?.entries, [
      { kind: "mark", name: "route", detail: "/settings", at: 1_000 },
    ]);
  });

  test("flushes are numbered in order, so the runner can tell them apart", () => {
    const recorder = createPerfRecorder({ now: clock().now });
    const first = parsePerfLog(logcat(recorder.drain()));
    const second = parsePerfLog(logcat(recorder.drain()));
    assert.deepEqual([first[0]?.tag, second[0]?.tag], ["1", "2"]);
  });

  test("every line starts with the log tag, so logcat can be filtered by it", () => {
    const recorder = createPerfRecorder({ now: clock().now });
    recorder.mark("a");
    for (const line of recorder.drain()) assert.ok(line.startsWith(`${PERF_LOG_TAG} `));
  });

  test("a touch keeps the native event time and when JavaScript saw it", () => {
    const recorder = createPerfRecorder({ now: clock(5_000).now });
    recorder.touch(4_990.5);
    const [flush] = parsePerfLog(logcat(recorder.drain()));
    assert.deepEqual(flush?.entries, [{ kind: "touch", eventAt: 4_990.5, at: 5_000 }]);
  });

  test("render counts add up per component until the next drain", () => {
    const recorder = createPerfRecorder({ now: clock().now });
    recorder.render("MiniPlayer");
    recorder.render("MiniPlayer");
    recorder.render("TabBar");
    const [first] = parsePerfLog(logcat(recorder.drain()));
    assert.deepEqual(first?.renders, { MiniPlayer: 2, TabBar: 1 });
    recorder.render("TabBar");
    const [second] = parsePerfLog(logcat(recorder.drain()));
    assert.deepEqual(second?.renders, { TabBar: 1 });
  });

  test("a drain empties the buffer", () => {
    const recorder = createPerfRecorder({ now: clock().now });
    recorder.mark("once");
    recorder.drain();
    const [second] = parsePerfLog(logcat(recorder.drain()));
    assert.deepEqual(second?.entries, []);
  });

  test("meta given to a drain comes back with its flush", () => {
    const recorder = createPerfRecorder({ now: clock().now });
    const [flush] = parsePerfLog(
      logcat(recorder.drain({ "library.tracks": 12_000, perfBuild: true, commit: null })),
    );
    assert.deepEqual(flush?.meta, { "library.tracks": 12_000, perfBuild: true, commit: null });
  });

  test("a full buffer keeps the newest entries and says how many it dropped", () => {
    const time = clock(0);
    const recorder = createPerfRecorder({ now: time.now, capacity: 2 });
    for (const name of ["a", "b", "c"]) {
      recorder.mark(name);
      time.advance(1);
    }
    const [flush] = parsePerfLog(logcat(recorder.drain()));
    assert.deepEqual(
      flush?.entries.map((entry) => (entry.kind === "mark" ? entry.name : entry.kind)),
      ["b", "c"],
    );
    assert.equal(flush?.dropped, 1);
  });

  test("timings from the platform's observers come back as recorded", () => {
    const recorder = createPerfRecorder({ now: clock().now });
    recorder.timing({ kind: "longtask", at: 10, duration: 120 });
    recorder.timing({
      kind: "event",
      name: "pointerup",
      at: 20,
      duration: 64,
      processingStart: 30,
      processingEnd: 40,
    });
    const [flush] = parsePerfLog(logcat(recorder.drain()));
    assert.deepEqual(flush?.entries, [
      { kind: "longtask", at: 10, duration: 120 },
      {
        kind: "event",
        name: "pointerup",
        at: 20,
        duration: 64,
        processingStart: 30,
        processingEnd: 40,
      },
    ]);
  });

  test("a flush whose end line was lost reads as incomplete", () => {
    const recorder = createPerfRecorder({ now: clock().now });
    recorder.mark("a");
    const lines = recorder.drain();
    const [flush] = parsePerfLog(logcat(lines.slice(0, -1)));
    assert.equal(flush?.complete, false);
  });

  test("other log lines, and flushes back to back, are told apart", () => {
    const recorder = createPerfRecorder({ now: clock().now });
    recorder.mark("first");
    const one = recorder.drain();
    recorder.mark("second");
    const two = recorder.drain();
    const text = logcat([...one, "unrelated line", "WavePerf not json", ...two]);
    assert.deepEqual(
      parsePerfLog(text).map((flush) => [flush.tag, flush.entries.length, flush.complete]),
      [
        ["1", 1, true],
        ["2", 1, true],
      ],
    );
  });

  test("times are kept to a hundredth of a millisecond", () => {
    const recorder = createPerfRecorder({ now: () => 1.23456 });
    recorder.mark("a");
    const [flush] = parsePerfLog(logcat(recorder.drain()));
    assert.deepEqual(flush?.entries, [{ kind: "mark", name: "a", at: 1.23 }]);
  });
});

describe("when the recorder flushes", () => {
  test("the first flush comes once the app has been quiet since it started", () => {
    const time = clock(0);
    const recorder = createPerfRecorder({ now: time.now });
    assert.equal(recorder.dueForFlush(), false);
    time.advance(PERF_FLUSH_QUIET_MS);
    assert.equal(recorder.dueForFlush(), true);
  });

  test("never within the quiet time after a touch, so a measured window holds no logging", () => {
    const time = clock(0);
    const recorder = createPerfRecorder({ now: time.now });
    time.advance(10_000);
    recorder.touch(10_000);
    recorder.mark("route", "/settings");
    time.advance(PERF_FLUSH_QUIET_MS - 1);
    assert.equal(recorder.dueForFlush(), false);
    time.advance(1);
    assert.equal(recorder.dueForFlush(), true);
  });

  test("not when nothing happened since the last flush", () => {
    const time = clock(0);
    const recorder = createPerfRecorder({ now: time.now });
    time.advance(PERF_FLUSH_QUIET_MS);
    recorder.drain();
    time.advance(60_000);
    assert.equal(recorder.dueForFlush(), false);
  });

  test("at most once per quiet time while something keeps rendering", () => {
    const time = clock(0);
    const recorder = createPerfRecorder({ now: time.now });
    time.advance(PERF_FLUSH_QUIET_MS);
    recorder.drain();
    recorder.render("MiniPlayer");
    time.advance(PERF_FLUSH_QUIET_MS / 2);
    assert.equal(recorder.dueForFlush(), false);
    time.advance(PERF_FLUSH_QUIET_MS / 2);
    assert.equal(recorder.dueForFlush(), true);
  });

  test("the quiet time can be set", () => {
    const time = clock(0);
    const recorder = createPerfRecorder({ now: time.now, quietMs: 100 });
    time.advance(100);
    assert.equal(recorder.dueForFlush(), true);
  });
});
