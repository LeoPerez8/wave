/**
 * Opening Library › Songs on a large Library (#310): what the screen read
 * before (every song row, then Core's sort in JavaScript) against what it
 * reads now (the order as ids, then the rows of the first page), per sort.
 * Then a scroll through the whole list as the screen reads it now (Core's
 * paged rows over the summaries), what Play and Select All read when they
 * run (every playable song's full row, every song's full row), and the
 * statements' plans.
 *
 * For each read it prints the median time, the JavaScript heap it allocates
 * (garbage included; the young generation is made big enough that no GC runs
 * during one read) and what it leaves retained once collected.
 *
 * Desktop numbers: Node with sql.js (SQLite compiled to WebAssembly), not the
 * phone's SQLite or Hermes. Run from the repo root:
 *
 *   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON apps/mobile/bench/songsList.ts [--quick] [--tracks=10000]
 */
import {
  createPagedRows,
  PAGED_ROWS_LIMITS,
  SONG_SORTS,
  sortSongs,
  type LibrarySongSort,
  type PagedRowsStats,
} from "@wave/core";
import { spawnSync } from "node:child_process";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

import {
  selectSongOrder,
  selectSongSummaries,
  selectSongsWithIds,
} from "../src/library/db/songOrder.ts";
import { addLibrary, openTestDatabase, traceQueries } from "../src/library/db/testDatabase.ts";
import { BY_TITLE, selectPlayableSongs, trackQuery } from "../src/library/db/tracks.ts";

declare const gc: (() => void) | undefined;

// Re-run with the flags the heap measurements need.
if (typeof gc === "undefined") {
  const result = spawnSync(
    process.execPath,
    [
      "--expose-gc",
      "--max-semi-space-size=512",
      "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",
      fileURLToPath(import.meta.url),
      ...process.argv.slice(2),
    ],
    { stdio: "inherit" },
  );
  process.exit(result.status ?? 1);
}
const collect = gc!;

const quick = process.argv.includes("--quick");
const tracks = Number(
  process.argv.find((arg) => arg.startsWith("--tracks="))?.slice("--tracks=".length) ?? 10_000,
);
const RUNS = quick ? 5 : 21;
/** Rows the first page holds: a screen and a half of the S24+'s list. */
const FIRST_PAGE = 50;

const db = await openTestDatabase();
addLibrary(db, { tracks, artists: Math.ceil(tracks / 25), albums: Math.ceil(tracks / 10) });

const median = (values: number[]): number => {
  // oxlint-disable-next-line unicorn/no-array-sort -- sorts its own copy
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
};

const round = (value: number, places = 2): number => Number(value.toFixed(places));

/** Median ms of [read], the heap it allocates (median) and the heap its result retains. */
const measure = <A>(read: () => A) => {
  read();
  const times: number[] = [];
  const allocated: number[] = [];
  for (let run = 0; run < RUNS; run++) {
    collect();
    const heap = process.memoryUsage().heapUsed;
    const start = performance.now();
    read();
    times.push(performance.now() - start);
    allocated.push(process.memoryUsage().heapUsed - heap);
  }
  // Twice: what the timed runs left for a second pass is collected before the baseline.
  collect();
  collect();
  const heap = process.memoryUsage().heapUsed;
  let kept: A | null = read();
  collect();
  collect();
  const retained = process.memoryUsage().heapUsed - heap;
  if (kept === null) throw new Error("unreachable");
  kept = null;
  return {
    ms: round(median(times)),
    allocatedKb: round(median(allocated) / 1024, 0),
    retainedKb: round(retained / 1024, 0),
  };
};

const label = (sort: LibrarySongSort): string =>
  `${sort.key} ${sort.descending ? "descending" : "ascending"}`;

console.log(
  JSON.stringify({
    kind: "meta",
    tracks,
    runtime: process.version,
    platform: `${process.platform}-${process.arch}`,
    note: "Desktop Node with sql.js; not phone timings. allocatedKb includes garbage.",
  }),
);

const sorts = SONG_SORTS as readonly LibrarySongSort[];
for (const sort of quick ? sorts.slice(0, 2) : sorts) {
  const before = measure(() =>
    sortSongs(
      trackQuery(db)
        .orderBy(...BY_TITLE)
        .all(),
      sort,
    ),
  );
  const order = measure(() => selectSongOrder(db, sort));
  const after = measure(() => {
    const { ids, spine, missing } = selectSongOrder(db, sort);
    return { ids, spine, missing, rows: selectSongSummaries(db, ids.slice(0, FIRST_PAGE)) };
  });
  console.log(JSON.stringify({ kind: "open", sort: label(sort), before, order, after }));
}

const { ids, missing } = selectSongOrder(db, { key: "title", descending: false });
const missingIds = new Set(missing);
const playable = ids.filter((id) => !missingIds.has(id));
console.log(
  JSON.stringify({
    kind: "page",
    rows: FIRST_PAGE,
    ...measure(() => selectSongSummaries(db, ids.slice(5_000, 5_000 + FIRST_PAGE))),
  }),
);
/** Rows on the S24+'s screen at once, and how far one scroll step moves. */
const SCREEN = 15;

/**
 * Scrolls the whole list top to bottom, a screen at a time, reading pages as
 * the screen does (synchronously here); returns the paged rows' counters and
 * the most rows held at once.
 */
const scrollThrough = (): PagedRowsStats & { readonly mostHeld: number } => {
  const pages = createPagedRows<number, { readonly id: number }>({
    read: (keys, settle) => settle(selectSongSummaries(db, keys)),
    keyOf: (row) => row.id,
  });
  pages.setOrder(ids);
  let mostHeld = 0;
  for (let start = 0; start < ids.length; start += SCREEN) {
    // The list renders a screen's buffer past what is on screen, as LegendList does.
    pages.view(start, Math.min(ids.length, start + SCREEN * 2));
    mostHeld = Math.max(mostHeld, pages.stats().held);
    if (pages.row(start) === undefined) throw new Error(`row ${start} not read`);
  }
  return { ...pages.stats(), mostHeld };
};
const scrolled = scrollThrough();
console.log(
  JSON.stringify({
    kind: "scroll",
    rows: ids.length,
    limits: PAGED_ROWS_LIMITS,
    reads: scrolled.reads,
    rowsRead: scrolled.rowsRead,
    mostHeld: scrolled.mostHeld,
    ...measure(scrollThrough),
  }),
);
console.log(
  JSON.stringify({
    kind: "play-all",
    songs: playable.length,
    ...measure(() => selectPlayableSongs(db, playable)),
  }),
);
console.log(
  JSON.stringify({
    kind: "select-all",
    songs: ids.length,
    ...measure(() => selectSongsWithIds(db, ids)),
  }),
);

for (const sort of quick ? [] : sorts.filter((each) => !each.descending)) {
  const { queries } = traceQueries(db, () => selectSongOrder(db, sort));
  console.log(
    JSON.stringify({ kind: "plan", sort: label(sort), plan: queries.map((q) => q.plan) }),
  );
}
const { queries } = traceQueries(db, () => selectSongSummaries(db, ids.slice(0, FIRST_PAGE)));
console.log(JSON.stringify({ kind: "plan", read: "page", plan: queries.map((q) => q.plan) }));
