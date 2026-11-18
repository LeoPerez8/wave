import assert from "node:assert/strict";
import test from "node:test";

import { selectArtistDetail } from "./artists.ts";
import { libraryCounts, libraryScale } from "./counts.ts";
import { tasteHistory } from "./taste.ts";
import { createFastAgainFixture } from "./fastAgainFixture.ts";

test("the shared 1,000-song fixture has the specified history and 20/300-song artists", async () => {
  const fixture = await createFastAgainFixture();
  try {
    assert.equal(libraryCounts(fixture.db).songs, 1000);
    assert.equal(libraryCounts(fixture.db).albums, 100);
    assert.equal(libraryCounts(fixture.db).artists, 40);
    assert.equal(libraryScale(fixture.db).playEvents, 10000);
    assert.equal(selectArtistDetail(fixture.db, fixture.targets.small.artistId)?.songs.length, 20);
    assert.equal(selectArtistDetail(fixture.db, fixture.targets.large.artistId)?.songs.length, 300);
    assert.equal(fixture.targets.small.albumIds.length, 2);
    assert.equal(fixture.targets.large.albumIds.length, 30);
    const history = tasteHistory(fixture.db);
    assert.equal(history.plays.length, 10000);
    assert.ok(history.favorites.length > 0);
    assert.ok(history.downloads.length > 0);
    assert.ok(history.plays.some((play) => play.endReason === "skipped"));
    assert.ok(history.plays.some((play) => play.endReason === "completed"));
  } finally {
    fixture.close();
  }
});
