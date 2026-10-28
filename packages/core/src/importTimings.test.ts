import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { importPhaseTimer, importTimingsLogLine } from "./index.ts";

describe("an import's phase timings in the app log", () => {
  test("each phase gets the time since the one before, from the moment it was queued", () => {
    let now = 1_000;
    const timer = importPhaseTimer(() => now, 400);
    now = 1_600;
    timer.mark("waiting");
    now = 43_600;
    timer.mark("reading");
    now = 44_400;
    timer.mark("listing");
    now = 47_500;
    timer.mark("indexing");
    now = 59_700;
    timer.mark("matching");
    now = 60_100;
    timer.mark("starring");
    now = 90_200;
    timer.mark("adding");
    assert.equal(
      importTimingsLogLine("Liked Songs", 10_000, timer.timings()),
      'Import of "Liked Songs" (10,000 songs) phases: waited 1.2 s, read 42.0 s, ' +
        "listed the Library 0.8 s, indexed the Library 3.1 s, matched 12.2 s, starred 0.4 s, " +
        "added 30.1 s; 89.8 s in all",
    );
  });

  test("a phase it went through twice adds up, and one it skipped isn't named", () => {
    let now = 0;
    const timer = importPhaseTimer(() => now);
    now = 60;
    timer.mark("waiting");
    now = 2_050;
    timer.mark("reading");
    now = 2_100;
    timer.mark("listing");
    now = 3_100;
    timer.mark("matching");
    now = 3_150;
    timer.mark("listing");
    now = 4_150;
    timer.mark("matching");
    assert.equal(
      importTimingsLogLine("Road Trip", 1, timer.timings()),
      'Import of "Road Trip" (1 song) phases: waited 0.1 s, read 2.0 s, ' +
        "listed the Library 0.1 s, matched 2.0 s; 4.2 s in all",
    );
  });
});
