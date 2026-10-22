import assert from "node:assert/strict";
import { test } from "node:test";

import { createLibraryReadTiming } from "./libraryReadTiming.ts";

test("fast reads return unchanged with only two timestamps, no inspection or collection", () => {
  let stamps = 0;
  const work: string[] = [];
  const unexpected = () => {
    work.push("extra work");
    throw new Error("fast read did extra work");
  };
  const timing = createLibraryReadTiming({
    now: () => ++stamps * 8,
    route: unexpected,
    write: unexpected,
    schedule: unexpected,
    onSlowRead: unexpected,
  });
  const result = new Proxy({}, { get: unexpected, ownKeys: unexpected });
  assert.equal(
    timing.read("read the playing track", () => result, unexpected),
    result,
  );
  assert.equal(stamps, 2);
  timing.flush();
  assert.deepEqual(work, []);
});

const clock = () => {
  let at = 0;
  let due: { at: number; run: () => void } | undefined;
  const lines: string[] = [];
  const slow: { operation: string; durationMs: number }[] = [];
  let route = "/home";
  const timing = createLibraryReadTiming({
    now: () => at,
    route: () => route,
    write: (line) => lines.push(line),
    onSlowRead: (read) => slow.push(read),
    schedule: (run, delay) => {
      due = { at: at + delay, run };
      return () => {
        due = undefined;
      };
    },
  });
  return {
    timing,
    lines,
    slow,
    read: <A>(operation: string, duration: number, result: A, rows?: (result: A) => number): A =>
      timing.read(
        operation,
        () => {
          at += duration;
          return result;
        },
        rows,
      ),
    wait: (ms: number) => {
      at += ms;
      if (due && at >= due.at) due.run();
    },
    block: (ms: number) => {
      at += ms;
    },
    route: (value: string) => {
      route = value;
    },
  };
};

test("slow reads in one second coalesce, including route changes", () => {
  const c = clock();
  assert.deepEqual(c.read("list songs", 640, [1, 2]), [1, 2]);
  c.wait(500);
  c.route("/artists");
  c.read(
    "read Home's plays",
    20,
    { recentlyPlayed: [1], mostPlayed: [2, 3] },
    (result) => result.recentlyPlayed.length + result.mostPlayed.length,
  );
  c.wait(479);
  assert.deepEqual(c.lines, []);
  c.wait(1);
  assert.deepEqual(c.lines, [
    'Read "list songs" held JS 640 ms (2 rows) on /home; Read "read Home\'s plays" held JS 20 ms (3 rows) on /artists',
  ]);
  assert.deepEqual(
    c.slow.map(({ operation, durationMs }) => ({ operation, durationMs })),
    [
      { operation: "list songs", durationMs: 640 },
      { operation: "read Home's plays", durationMs: 20 },
    ],
  );
});

test("a failed read preserves the original error and still measures its JS hold", () => {
  const c = clock();
  const failure = new Error("database closed");
  assert.throws(
    () =>
      c.timing.read("list songs", () => {
        c.block(42);
        throw failure;
      }),
    (error) => error === failure,
  );
  c.timing.flush();
  assert.deepEqual(c.lines, ['Read "list songs" held JS 42 ms (0 rows) on /home']);
});

test("a gap of one second splits groups even if synchronous work delayed the flush timer", () => {
  const c = clock();
  c.read("list songs", 17, []);
  c.block(980);
  c.read("list artists", 20, [1]);
  assert.deepEqual(c.lines, ['Read "list songs" held JS 17 ms (0 rows) on /home']);
  c.timing.flush();
  assert.equal(c.lines[1], 'Read "list artists" held JS 20 ms (1 row) on /home');
});

test("flushing for export or backgrounding includes pending reads once and cancels the timer", () => {
  const c = clock();
  c.read(
    "read queued songs",
    32,
    new Map([
      [1, "song"],
      [2, "song"],
    ]),
  );
  c.read("read a song to replace", 18, null);
  c.timing.flush();
  c.timing.flush();
  c.wait(1_000);
  assert.deepEqual(c.lines, [
    'Read "read queued songs" held JS 32 ms (2 rows) on /home; Read "read a song to replace" held JS 18 ms (0 rows) on /home',
  ]);
});

test("fast reads neither log nor extend an existing slow group", () => {
  const c = clock();
  c.read("list songs", 17, [1]);
  c.wait(900);
  c.read("read the saved queue", 16, { queue: "[]", positionMs: 0 });
  c.wait(84);
  assert.deepEqual(c.lines, ['Read "list songs" held JS 17 ms (1 row) on /home']);
});

test("read diagnostics never change a read's result or original failure", () => {
  const logFailure = new Error("log unavailable");
  const fail = () => {
    throw logFailure;
  };
  let at = 0;
  const timing = createLibraryReadTiming({
    now: () => at,
    route: fail,
    write: fail,
    schedule: fail,
  });
  const result = { id: 1 };
  assert.equal(
    timing.read("read a song", () => {
      at += 40;
      return result;
    }),
    result,
  );
  const failure = new Error("database closed");
  assert.throws(
    () =>
      timing.read("read a song", () => {
        at += 40;
        throw failure;
      }),
    (error) => error === failure,
  );
});

test("a continuous run of slow reads is reported in one-second windows", () => {
  const c = clock();
  c.read("read first", 20, [1]);
  c.wait(900);
  c.read("read second", 20, [2]);
  c.wait(80);
  assert.deepEqual(c.lines, [
    'Read "read first" held JS 20 ms (1 row) on /home; Read "read second" held JS 20 ms (1 row) on /home',
  ]);
  c.read("read third", 20, [3]);
  c.wait(1_000);
  assert.equal(c.lines[1], 'Read "read third" held JS 20 ms (1 row) on /home');
});
