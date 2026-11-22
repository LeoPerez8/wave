/**
 * A rescan's JavaScript work on a 3,000-song Library (#1436): 200 changed
 * files saved in Core's save slices (`SCAN_SAVE_SLICE`) against other slice
 * sizes, the first save of a session (which reads the Library's whole credits
 * to split by), and the scan's end (`filesGone`: prune, credits re-filed,
 * artist images) when the session hasn't re-filed the Library yet against
 * when it has. Prints each step's median and, for the saves, the longest
 * single transaction, which is what a tap waits behind.
 *
 * Desktop numbers: Node with sql.js, not the phone's SQLite or Hermes. Run
 * from the repo root:
 *
 *   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON apps/mobile/bench/scanEnd.ts [--quick]
 */
import { SCAN_SAVE_SLICE, reconcileScan } from "@wave/core";
import { performance } from "node:perf_hooks";

import type { IndexedTrack } from "@wave/client";
import { creditSplits, relinkCredits } from "@wave/client/db/credits";
import { filesGone } from "@wave/client/db/missingSongs";
import { saveBatch } from "@wave/client/db/save";
import { openTestDatabase } from "@wave/client/testing";
import { median } from "./measure.ts";
import { scannedFile } from "./scannedFile.ts";

const quick = process.argv.includes("--quick");
const LIBRARY = 3_000;
const CHANGED = 200;
const RUNS = quick ? 3 : 7;
const SLICES = [SCAN_SAVE_SLICE, 50, 25, 10];

const time = (run: () => unknown): number => {
  const start = performance.now();
  run();
  return performance.now() - start;
};

const db = await openTestDatabase();
const library: IndexedTrack[] = Array.from({ length: LIBRARY }, (_, n) => scannedFile(n));
{
  const splits = creditSplits();
  for (let i = 0; i < LIBRARY; i += 100)
    saveBatch(db, splits, library.slice(i, i + 100), [], [], 0, { linkEntries: false });
  relinkCredits(db, splits);
}

let edit = 0;
/** [CHANGED] indexed files read again with a new modified time. */
const changed = (): IndexedTrack[] => {
  edit++;
  return Array.from({ length: CHANGED }, (_, i) => {
    const file = library[(edit * 37 + i * 13) % LIBRARY]!;
    return { ...file, modifiedAt: file.modifiedAt + edit, sizeBytes: file.sizeBytes + edit };
  });
};

const rows: string[] = [];
const splits = creditSplits();
const first = time(() =>
  saveBatch(db, splits, changed().slice(0, SCAN_SAVE_SLICE), [], [], 0, { linkEntries: false }),
);
for (const size of SLICES) {
  const totals: number[] = [];
  const longest: number[] = [];
  for (let run = 0; run < RUNS; run++) {
    const batch = reconcileScan({ missing: [], read: changed(), isIndexed: () => true });
    const saved = [...batch.added, ...batch.updated];
    const blocks: number[] = [];
    for (let i = 0; i < saved.length; i += size)
      blocks.push(
        time(() =>
          saveBatch(db, splits, saved.slice(i, i + size), [], [], 0, { linkEntries: false }),
        ),
      );
    totals.push(blocks.reduce((sum, ms) => sum + ms, 0));
    longest.push(Math.max(...blocks));
  }
  rows.push(`| ${CHANGED} changed files in slices of ${size}, total | ${median(totals)} |`);
  rows.push(`| … the longest slice | ${median(longest)} |`);
}

const staleEnd: number[] = [];
const freshEnd: number[] = [];
for (let run = 0; run < RUNS; run++) {
  const session = creditSplits();
  saveBatch(db, session, changed().slice(0, 10), [], [], 0, { linkEntries: false });
  staleEnd.push(time(() => filesGone(db, session, [], 0)));
  freshEnd.push(time(() => filesGone(db, session, [], 0)));
}

console.log(`Desktop (sql.js), Library ${LIBRARY}, ${RUNS} runs, medians:`);
console.log(`| Step | ms |`);
console.log(`| --- | ---: |`);
console.log(
  `| A session's first save (${SCAN_SAVE_SLICE} files, reads every credit) | ${first.toFixed(1)} |`,
);
for (const row of rows) console.log(row);
console.log(`| Scan end, first of the session (credits re-filed) | ${median(staleEnd)} |`);
console.log(`| Scan end, Library already re-filed | ${median(freshEnd)} |`);
