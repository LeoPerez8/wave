import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { createJsBlockLog } from "./index.ts";

const setup = (screen: string | null = "/search") => {
  const lines: string[] = [];
  let shown = screen;
  const log = createJsBlockLog({ write: (line) => lines.push(line), screen: () => shown });
  return { log, lines, show: (next: string | null) => (shown = next) };
};

describe("a JS block over 50 ms while a screen is shown writes one line", () => {
  test("a background slice past 50 ms names its work, the screen and its duration", () => {
    const { log, lines } = setup();
    log.sliceRan("Magic Queue batch", 1000, 312);
    assert.deepEqual(lines, ["JS blocked 312 ms on /search by Magic Queue batch"]);
  });

  test("a slice within 50 ms writes nothing", () => {
    const { log, lines } = setup();
    log.sliceRan("scan", 1000, 50);
    assert.deepEqual(lines, []);
  });

  test("the long task the runtime reports for an already logged slice adds no second line", () => {
    const { log, lines } = setup();
    log.sliceRan("sync", 1000, 120);
    log.longTask(995, 130);
    assert.equal(lines.length, 1);
  });

  test("a long task inside a short slice is put down to that slice's work", () => {
    const { log, lines } = setup();
    log.sliceRan("scan", 2000, 7);
    log.longTask(1990, 80);
    assert.deepEqual(lines, ["JS blocked 80 ms on /search by scan"]);
  });

  test("a long task no slice ran in names the screen's own work", () => {
    const { log, lines } = setup("/");
    log.sliceRan("scan", 100, 7);
    log.longTask(5000, 1500);
    assert.deepEqual(lines, ["JS blocked 1.5 s on / by no background work"]);
  });

  test("a long task starting on a turn the scheduler gave is put down to that turn's work", () => {
    const { log, lines } = setup();
    log.turnTaken("sync", 3000);
    log.longTask(3000, 240);
    assert.deepEqual(lines, ["JS blocked 240 ms on /search by sync"]);
  });

  test("with no screen shown (Wave in the background), nothing is written", () => {
    const { log, lines } = setup(null);
    log.sliceRan("Magic Queue batch", 0, 900);
    log.longTask(5000, 900);
    assert.deepEqual(lines, []);
  });
});
