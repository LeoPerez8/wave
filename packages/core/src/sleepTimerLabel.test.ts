import assert from "node:assert/strict";
import { test } from "node:test";

import { sleepTimerLabelSeconds } from "./index.ts";

test("a deadline label changes only at whole seconds remaining, including while paused", () => {
  const timer = { type: "deadline", endsAt: 60_250 } as const;
  assert.equal(sleepTimerLabelSeconds(timer, 250), 60);
  assert.equal(sleepTimerLabelSeconds(timer, 1_249), 60);
  assert.equal(sleepTimerLabelSeconds(timer, 1_250), 59);
  assert.equal(sleepTimerLabelSeconds(timer, 60_249), 1);
  assert.equal(sleepTimerLabelSeconds(timer, 60_250), 0);
  assert.equal(sleepTimerLabelSeconds(timer, 90_000), 0);
});

test("End of track never asks for a ticking label", () => {
  const timer = { type: "endOfTrack" } as const;
  assert.equal(sleepTimerLabelSeconds(timer, 0), null);
  assert.equal(sleepTimerLabelSeconds(timer, 60_000), null);
});
