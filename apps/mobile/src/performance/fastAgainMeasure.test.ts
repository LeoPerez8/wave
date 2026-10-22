import assert from "node:assert/strict";
import test from "node:test";
import { createFastAgainFixture } from "../library/db/fastAgainFixture.ts";
import { selectArtistDetail } from "../library/db/artists.ts";
import { measureRead, percentiles } from "../../bench/fastAgain/measure.ts";

test("measurements report actual SQL work separately from timed runs", async () => {
  const fixture = await createFastAgainFixture();
  try {
    let notifications = 0;
    const measurement = measureRead(
      fixture.db,
      "small artist",
      () => {
        notifications++;
        return selectArtistDetail(fixture.db, fixture.targets.small.artistId);
      },
      { runs: 3, notifications: () => notifications },
    );
    assert.equal(measurement.read, "small artist");
    assert.equal(measurement.notifications, 1);
    assert.equal(measurement.statements, 3);
    assert.equal(measurement.rowsRead, 23); // artist + 20 songs + 2 albums
    assert.ok(measurement.p90Ms >= measurement.medianMs);
    assert.ok(measurement.longestSyncTaskMs >= measurement.p90Ms);
  } finally {
    fixture.close();
  }
});

test("timing summaries use the average middle pair and nearest-rank p90", () => {
  assert.deepEqual(percentiles([40, 10, 30, 20]), { medianMs: 25, p90Ms: 40 });
  assert.deepEqual(percentiles([4]), { medianMs: 4, p90Ms: 4 });
  assert.throws(() => percentiles([]), /empty/);
});
