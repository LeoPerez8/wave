import assert from "node:assert/strict";
import test from "node:test";
import { stepNowPlayingSheet } from "@wave/core";
import { LINK_SEQUENCES, replayLinks } from "../../bench/fastAgain/nowPlayingLinksReplay.ts";
import { followNowPlayingLink } from "../nowPlaying/linkClose.ts";
import { createFastAgainFixture } from "../library/db/fastAgainFixture.ts";

test("at 1,000 songs every Now Playing link survives Back, drag, card dismissal and a second link", async () => {
  const fixture = await createFastAgainFixture();
  try {
    assert.equal(fixture.songIds.length, 1000);
    for (const sequence of LINK_SEQUENCES) {
      const result = replayLinks(stepNowPlayingSheet, sequence, 650, followNowPlayingLink);
      assert.equal(result.lost, 0, sequence.name);
      assert.deepEqual(
        result.pushes.map((p) => p.tap),
        sequence.name === "two links" ? [1, 2] : [1],
      );
      assert.ok(
        result.pushes.every((p) => p.waitMs === 0),
        sequence.name,
      );
      assert.equal(result.phase, sequence.name === "link then a drag" ? "open" : "hidden");
    }
  } finally {
    fixture.close();
  }
});
