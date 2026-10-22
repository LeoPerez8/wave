import assert from "node:assert/strict";
import test from "node:test";
import { stepNowPlayingSheet, type SheetPhase } from "@wave/core";

import { followNowPlayingLink } from "./linkClose.ts";

test("a Now Playing link starts closing and pushes before the tap handler returns", () => {
  let phase: SheetPhase = "open";
  const events: string[] = [];
  followNowPlayingLink({
    close: () => {
      const next = stepNowPlayingSheet(phase, { type: "linkClose" });
      phase = next.phase;
      events.push(next.spring!);
      return next;
    },
    navigate: () => events.push("push"),
  });
  assert.deepEqual(events, ["closed", "push"]);
  assert.equal(phase, "closing");
});
