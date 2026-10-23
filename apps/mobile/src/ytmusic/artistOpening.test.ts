import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import * as Effect from "effect/Effect";
import { createFastAgainFixture } from "../library/db/fastAgainFixture.ts";
import { traceQueries } from "../library/db/testDatabase.ts";
import { loadArtistOpening } from "../../bench/fastAgain/artistOpeningReplay.ts";

const root =
  process.env.ARTIST_OPENING_ROOT ?? fileURLToPath(new URL("../../../../", import.meta.url));
const songRows = (queries: ReturnType<typeof traceQueries>["queries"]) =>
  queries
    .filter((q) => /(?:"tracks"|tracks)\.(?:"title"|title)/.test(q.sql))
    .reduce((sum, q) => sum + q.rows, 0);

test("real-store artist openings read only their 20/300 song rows, including integrated openings", async () => {
  const fixture = await createFastAgainFixture();
  try {
    const opening = await loadArtistOpening(root, fixture.db);
    for (const target of [fixture.targets.small, fixture.targets.large]) {
      for (const integrated of [false, true]) {
        const { result, queries } = traceQueries(fixture.db, () =>
          opening.open(target.artistId, fixture.now, integrated),
        );
        assert.equal(result.detail.songs.length, target.songIds.length);
        assert.equal(
          songRows(queries),
          target.songIds.length,
          "song rows must stay artist scoped, not grow with the Library",
        );
        assert.equal(result.find, null, "no finder until settled online additions");
        assert.deepEqual(new Set(result.detail.songs.map((s) => s.id)), new Set(target.songIds));
      }
    }
    // The count observes real decoded song rows, and would catch the old follower.
    const whole = traceQueries(fixture.db, () => Effect.runSync(opening.store.listSongs));
    assert.equal(songRows(whole.queries), 1000);
  } finally {
    fixture.close();
  }
});

test("saved Popular stays local before settlement; integrated additions wait, then keep the same counts and appearances", async () => {
  const fixture = await createFastAgainFixture();
  try {
    const opening = await loadArtistOpening(root, fixture.db);
    const { seedArtistOpening } = await import("../../bench/fastAgain/artistOpeningFixture.ts");
    const restore = seedArtistOpening(fixture, opening);
    try {
      for (const target of [fixture.targets.small, fixture.targets.large]) {
        const first = traceQueries(fixture.db, () =>
          opening.open(target.artistId, fixture.now, true),
        );
        assert.equal(songRows(first.queries), target.songIds.length);
        assert.equal(first.result.detail.appearsOn.length, 1);
        assert.equal(first.result.detail.albums.length, target.albumIds.length - 1);
        assert.deepEqual(
          first.result.songs.map((s) => s.popularRank),
          Array.from({ length: target.songIds.length }, (_, i) => i + 1),
        );
        const local = traceQueries(fixture.db, () =>
          opening.settle(first.result, fixture.now, false),
        );
        assert.equal(
          songRows(local.queries),
          0,
          "settled Library mode never asks the whole finder",
        );
        assert.equal(local.result.counts.songs, target.songIds.length);
        const online = traceQueries(fixture.db, () =>
          opening.settle(first.result, fixture.now, true),
        );
        assert.equal(
          songRows(online.queries),
          1000,
          "only the settled online additions acquire the cold finder",
        );
        assert.deepEqual(
          online.result.view?.songs.map((s) => s.videoId),
          ["remote-only"],
        );
        assert.equal(online.result.counts.songs, target.songIds.length + 1);
        assert.equal(online.result.counts.albums, target.albumIds.length + 1);
        assert.equal(online.result.integrated, true);
      }
    } finally {
      restore();
    }
  } finally {
    fixture.close();
  }
});

test("the artist section checks Android connectivity when its deferred request actually runs", async () => {
  const { artistOpeningRequest } = await import("./artistOpeningRequest.ts");
  let online = true;
  let requests = 0;
  // Network and Android connectivity are system boundaries; Library reads above stay real.
  const request = artistOpeningRequest(
    () => online,
    Effect.sync(() => ++requests),
  );
  online = false;
  assert.deepEqual(Effect.runSync(Effect.flip(request)), { reason: "offline" });
  assert.equal(requests, 0);
  online = true;
  assert.equal(Effect.runSync(request), 1);
  assert.equal(requests, 1);
});
