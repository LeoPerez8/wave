/**
 * The played album and artist totals while the kept totals settle (#1451): summed
 * from the history, replayed off the JS thread. Before, the summing ran in the read's
 * last pass, one step; now the read replays its statements and the summing runs in
 * Core's steps, in slices of a replay step. For each: the JS held and the longest step
 * (a pass, a step of mapping rows or a slice), which the app names "Library read
 * replay". The totals are checked the same, and the same as the synchronous read.
 *
 * Desktop numbers: Node with sql.js (SQLite compiled to WebAssembly), not the phone's
 * SQLite or Hermes. Run from the repo root:
 *
 *   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON apps/mobile/bench/playedTotalsFallback.ts [--quick]
 */
import { finishSteps, statsWindow } from "@wave/core";
import assert from "node:assert/strict";

import type { LibraryDatabase } from "@wave/client/db/database";
import { keptTotalsSettled } from "@wave/client/db/keptPlayTotals";
import * as offThread from "@wave/client/db/offThreadReads";
import {
  playedEntityTotals,
  playedTotalsRead,
  playedTotalsSteps,
} from "@wave/client/db/playedEntities";
import { addStreamedPlays, createFastAgainFixture } from "@wave/client/testing/fastAgainFixture";
import { sql } from "drizzle-orm";
import { median, printMeta } from "./measure.ts";
import { timedReplays } from "./replaySteps.ts";

const quick = process.argv.includes("--quick");
const runs = quick ? 3 : 7;
const size = quick ? 1000 : 12000;
/** Streamed songs, four plays each. */
const videos = quick ? 500 : 4000;

const fixture = await createFastAgainFixture(size);
const { db } = fixture;
addStreamedPlays(db, videos, fixture.now);
db.run(sql`UPDATE played_songs SET state = 1`);
assert.equal(keptTotalsSettled(db), false, "the kept totals still settle");
const window = statsWindow("all", fixture.now);

const { steps, connection, now } = timedReplays(db);

const expected = playedEntityTotals(db, window);
const read = (d: LibraryDatabase) => playedTotalsRead(d, window, true);
const ways = {
  // The whole summing in the replayed read, as before #1451.
  whole: async () => {
    const replayed = await offThread.replayRead(
      connection,
      (d) => finishSteps(playedTotalsSteps(read(d))),
      now,
    );
    return { value: replayed.value, heldMs: replayed.heldMs };
  },
  // The statements replayed, the summing in slices (`LibraryStore`'s `attemptStepped`).
  stepped: async () => {
    const replayed = await offThread.replayRead(connection, read, now);
    const worked = await offThread.finishReplaySteps(playedTotalsSteps(replayed.value), now);
    return { value: worked.value, heldMs: replayed.heldMs + worked.heldMs };
  },
};

const round = (ms: number) => Number(ms.toFixed(1));

printMeta({
  runs,
  songs: size,
  streamedSongs: videos,
  albums: expected.albums.length,
  artists: expected.artists.length,
});
for (const [way, run] of Object.entries(ways)) {
  const held: number[] = [];
  const longest: number[] = [];
  let count = 0;
  for (let index = 0; index < runs; index++) {
    steps.length = 0;
    const { value, heldMs } = await run();
    assert.deepEqual(value, expected, `${way}: the same totals`);
    held.push(heldMs);
    longest.push(Math.max(...steps));
    count = steps.length;
  }
  console.log(
    JSON.stringify({
      kind: "read",
      way,
      heldMs: round(median(held)),
      longestStepMs: round(median(longest)),
      steps: count,
    }),
  );
}
fixture.close();
