import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { createJsBlockLog } from "./index.ts";

const setup = (screen: string | null = "/search") => {
  const lines: string[] = [];
  let shown = screen;
  const log = createJsBlockLog({ write: (line) => lines.push(line), screen: () => shown });
  // Past startup: the app settled its first screen before these blocks.
  log.firstSettled(0);
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

describe("a long task names the work still running in it", () => {
  test("work that began before the task and hasn't ended names it, though no slice ran then", () => {
    const { log, lines } = setup();
    const end = log.workBegan("DJ opening", 1000);
    log.longTask(1400, 90);
    end(1600);
    assert.deepEqual(lines, ["JS blocked 90 ms on /search by DJ opening"]);
  });

  test("work that ended before the task doesn't name it", () => {
    const { log, lines } = setup();
    log.workBegan("DJ opening", 1000)(1200);
    log.longTask(1400, 90);
    assert.deepEqual(lines, ["JS blocked 90 ms on /search by no background work"]);
  });

  test("of two running works, the one begun last names it", () => {
    const { log, lines } = setup();
    log.workBegan("Search index", 1000);
    log.workBegan("Stats page", 1100);
    log.longTask(1400, 90);
    assert.deepEqual(lines, ["JS blocked 90 ms on /search by Stats page"]);
  });

  test("a slice inside the task beats the running work around it", () => {
    const { log, lines } = setup();
    log.workBegan("Search index", 1000);
    log.sliceRan("scan", 1410, 4);
    log.longTask(1400, 90);
    assert.deepEqual(lines, ["JS blocked 90 ms on /search by scan"]);
  });

  test("a turn's work stays running after the turn, while its awaited reads answer", () => {
    const { log, lines } = setup();
    log.turnTaken("Genre pages", 1000);
    log.longTask(1150, 70);
    assert.deepEqual(lines, ["JS blocked 70 ms on /search by Genre pages"]);
  });

  test("a second after its turn, with nothing ended, a turn's work no longer names blocks", () => {
    const { log, lines } = setup();
    log.turnTaken("Genre pages", 1000);
    log.longTask(3000, 70);
    assert.deepEqual(lines, ["JS blocked 70 ms on /search by no background work"]);
  });
});

describe("a long task before the first screen settles is startup's", () => {
  test("with nothing named running, it logs as startup", () => {
    const lines: string[] = [];
    const log = createJsBlockLog({ write: (line) => lines.push(line), screen: () => "/" });
    log.longTask(100, 400);
    log.firstSettled(900);
    log.longTask(1000, 400);
    assert.deepEqual(lines, [
      "JS blocked 400 ms on / by startup",
      "JS blocked 400 ms on / by no background work",
    ]);
  });

  test("named work running then still names it", () => {
    const lines: string[] = [];
    const log = createJsBlockLog({ write: (line) => lines.push(line), screen: () => "/" });
    log.workBegan("player restore", 50);
    log.longTask(100, 400);
    assert.deepEqual(lines, ["JS blocked 400 ms on / by player restore"]);
  });
});
