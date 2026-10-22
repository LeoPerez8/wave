import assert from "node:assert/strict";
import test from "node:test";
import { lostTapLine } from "./index.ts";

test("lost link warnings name the tap, its source and each actionable reason", () => {
  for (const reason of [
    "link not ready",
    "close taken over by Back",
    "close taken over by chevron",
    "close taken over by card",
    "target gone",
    "unknown",
  ] as const) {
    assert.equal(
      lostTapLine({ kind: "artistLink", from: "Now Playing", to: "Björk", reason }),
      `Lost artist link to Björk from Now Playing: no navigation after 1 s; ${reason}`,
    );
  }
  assert.equal(
    lostTapLine({ kind: "albumLink", from: "Now Playing", to: "Debut", reason: "unknown" }),
    "Lost album link to Debut from Now Playing: no navigation after 1 s; unknown",
  );
});
