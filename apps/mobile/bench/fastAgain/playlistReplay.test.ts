/** Run with WAVE_BENCH_BEFORE pointing to an actual v0.19.0-ti source checkout. */
import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createFastAgainFixture } from "../../src/library/db/fastAgainFixture.ts";
import { createPlaylistReplay } from "./playlistReplay.ts";

const before = process.env.WAVE_BENCH_BEFORE;
const current = fileURLToPath(new URL("../../../../", import.meta.url));

for (const variant of ["before", "after"] as const) {
  test(
    `${variant} desktop burst counts executed ranks rather than coalesced renewal requests`,
    { skip: variant === "before" && before === undefined ? "Set WAVE_BENCH_BEFORE" : false },
    async () => {
      const fixture = await createFastAgainFixture();
      const replay = await createPlaylistReplay(variant === "before" ? before! : current, fixture);
      assert.ok(replay);
      try {
        await replay.mount();
        replay.begin();
        for (let i = 0; i < 12; i++) {
          replay.publish("tracks");
          replay.publish("favorites");
        }
        await replay.end();
        // Ti finishes one renewal and one queued catch-up; the deferred visit coalesces first.
        const renewals = variant === "before" ? 2 : 1;
        assert.equal(replay.work.reads, renewals);
        assert.equal(replay.work.notifications, 3 * renewals);
        assert.equal(replay.work.ranks, renewals);
        assert.equal(replay.sessions[0]!.get().slots.filter((slot) => slot !== null).length, 5);
      } finally {
        replay.close();
        fixture.close();
      }
    },
  );
}
