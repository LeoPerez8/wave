import assert from "node:assert/strict";
import test from "node:test";
import { stepNowPlayingSheet, type SheetPhase } from "@wave/core";

import { followNowPlayingLink } from "./linkClose.ts";

test("a Now Playing link starts closing and pushes before the tap handler returns", () => {
  let phase: SheetPhase = "open";
  const events: string[] = [];
  followNowPlayingLink({
    step: (event) => {
      const next = stepNowPlayingSheet(phase, event);
      phase = next.phase;
      events.push(next.spring!);
      return next;
    },
    navigate: () => events.push("push"),
  });
  assert.deepEqual(events, ["closed", "push"]);
  assert.equal(phase, "closing");
});

test("the app link action chooses immediate navigation itself from every sheet phase", () => {
  for (const initial of ["hidden", "opening", "open", "drag", "closing"] as const) {
    let phase: SheetPhase = initial;
    let pushes = 0;
    followNowPlayingLink({
      step: (event) => {
        const next = stepNowPlayingSheet(phase, event);
        phase = next.phase;
        return next;
      },
      navigate: () => pushes++,
    });
    assert.equal(pushes, 1, initial);
    assert.equal(phase, initial === "hidden" ? "hidden" : "closing");
  }
});
