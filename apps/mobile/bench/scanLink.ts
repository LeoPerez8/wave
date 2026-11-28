/**
 * The end of a rescan that changed nothing, on the reference phone's Library
 * (3,000 songs, 60 playlists, 26,700 entries; `referenceSeed.ts`), once per
 * launch of Wave (#1529). Before, the scan kept the revision its link left in
 * memory only, so the first scan of every process linked the whole Library's
 * entries again (`linkPlaylistEntries`); now the revision is kept in the
 * database and that scan reads two numbers (`playlistLinkRevisions`).
 * Each launch gets a new store on the same Library, as a new process does.
 *
 * Desktop numbers: Node with sql.js, not the phone's SQLite or Hermes. Run
 * from the repo root:
 *
 *   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON apps/mobile/bench/scanLink.ts [--quick]
 */
import { scanEnd } from "@wave/core";
import * as Effect from "effect/Effect";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";

import { referenceCatalogue, seedReferenceLibrary } from "@wave/client/db/referenceSeed";
import { closeTestDatabase, openTestDatabase } from "@wave/client/testing";
import { loadLibraryStore } from "./fastAgain/store.ts";
import { median } from "./measure.ts";

const quick = process.argv.includes("--quick");
const LAUNCHES = quick ? 3 : 7;
const root = fileURLToPath(new URL("../../../", import.meta.url));
const now = Date.UTC(2026, 10, 28);

const db = await openTestDatabase();
const catalogue = referenceCatalogue();
seedReferenceLibrary(db, catalogue, {
  root: "/storage/emulated/0/Music/Wave Seed",
  facts: (song) => ({
    sizeBytes: 1_000 + song.durationMs / 1_000,
    modifiedAt: now - 400 * 86_400_000,
  }),
  now,
});

const timed = async (run: () => Promise<unknown>): Promise<number> => {
  const start = performance.now();
  await run();
  return performance.now() - start;
};

const before: number[] = [];
const after: number[] = [];
let linksAfter = 0;
for (let launch = 0; launch < LAUNCHES; launch++) {
  const store = await loadLibraryStore(root, db);
  // Before: the revision read, then the link a process's first scan always ran.
  before.push(
    await timed(async () => {
      await Effect.runPromise(store.playlistLinkRevisions);
      await Effect.runPromise(store.linkPlaylistEntries);
    }),
  );
  const next = await loadLibraryStore(root, db);
  after.push(
    await timed(async () => {
      const { entries, linked } = await Effect.runPromise(next.playlistLinkRevisions);
      const end = scanEnd({
        saved: 0,
        gone: 0,
        entriesRevision: entries,
        linkedRevision: linked,
        firstScan: false,
      });
      if (end.linkEntries) {
        linksAfter++;
        await Effect.runPromise(next.linkPlaylistEntries);
      }
    }),
  );
}
closeTestDatabase(db);

const entries = catalogue.playlists.reduce((sum, playlist) => sum + playlist.entries.length, 0);
console.log("Desktop numbers (Node, sql.js), not the phone's.");
console.log(
  `Library: ${catalogue.songs.length} songs, ${catalogue.playlists.length} playlists, ${entries} entries; ${LAUNCHES} launches each`,
);
console.log(
  `Before, a no-change scan's end per launch: median ${median(before)} ms (link ran every launch)`,
);
console.log(
  `After, a no-change scan's end per launch: median ${median(after)} ms (link ran ${linksAfter} of ${LAUNCHES})`,
);
