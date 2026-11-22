/** #1348: the store's reads leave the JS thread and keep their results, order and snapshots. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import { sql } from "drizzle-orm";

import { loadLibraryStore, loadWorktreeModule } from "../../../bench/fastAgain/store.ts";
import { keptTotalsSettled } from "@wave/client/db/keptPlayTotals";
import { addStreamedPlays, createFastAgainFixture } from "@wave/client/testing/fastAgainFixture";
import { traceQueries } from "@wave/client/testing";

const root = fileURLToPath(new URL("../../../../../", import.meta.url));

/** Argument-free members that write: left out of the read sweep. */
const WRITES = new Set([
  "linkPlaylistEntries",
  "clearRecentSearches",
  "takeDeletedPlaylistImages",
  "clearArtistPhotos",
  "leaveAccount",
  "keptTotalsSteps",
  // The startup job runs it once the first screen settles, before these reads (`app/_layout.tsx`).
  "startupUpkeep",
]);

const appLog = async () => {
  const module = await loadWorktreeModule<typeof import("../../log/slowLibraryReads.ts")>(
    root,
    "apps/mobile/src/log/slowLibraryReads.ts",
  );
  const lines: string[] = [];
  const flush = module.connectLibraryReadLog({ route: () => "/test", write: (l) => lines.push(l) });
  return { lines, flush };
};

test("every read gives what the synchronous store gives, without a statement on the main connection", async () => {
  const fixture = await createFastAgainFixture();
  try {
    const log = await appLog();
    const here = await loadLibraryStore(root, fixture.db);
    const away = await loadLibraryStore(root, fixture.db, { offThreadReads: true });
    await Effect.runPromise(here.startupUpkeep);
    await Effect.runPromise(away.startupUpkeep);
    const window = { from: fixture.now - 30 * 86_400_000, to: fixture.now };
    const artist = fixture.targets.large.artistId;
    const ids = fixture.songIds.slice(0, 40);
    const reads: [string, (store: typeof here) => Effect.Effect<unknown, unknown>][] = [
      ...Object.keys(here)
        .filter((key) => !WRITES.has(key) && Effect.isEffect(here[key as keyof typeof here]))
        .map(
          (key) =>
            [key, (store: typeof here) => store[key as keyof typeof here] as never] as [
              string,
              (store: typeof here) => Effect.Effect<unknown, unknown>,
            ],
        ),
      ["getAlbum", (s) => s.getAlbum(fixture.albumId)],
      ["getArtist", (s) => s.getArtist(artist)],
      ["getPlaylist", (s) => s.getPlaylist(fixture.playlistId)],
      ["songsByIds", (s) => s.songsByIds(ids)],
      ["listArtistSongsPage", (s) => s.listArtistSongsPage(artist, { offset: 0, limit: 25 })],
      ["home", (s) => s.home()],
      ["trackPlayTotals", (s) => s.trackPlayTotals(window)],
      ["playedEntityTotals", (s) => s.playedEntityTotals(window)],
      ["recapPlays", (s) => s.recapPlays(window)],
      ["artistPlays", (s) => s.artistPlays(artist, fixture.now)],
      ["listeningHistory", (s) => s.listeningHistory()],
      ["mixSongsPage", (s) => s.mixSongsPage(0)],
    ];
    assert.ok(reads.length > 60);
    for (const [name, read] of reads) {
      const expected = Effect.runSync(read(here));
      const traced = await traceAsync(fixture.db, () => Effect.runPromise(read(away)));
      assert.deepEqual(traced.result, expected, name);
      assert.equal(traced.mainStatements, 0, `${name} read on the main connection`);
    }
    log.flush();
    assert.deepEqual(
      log.lines.filter((line) => line.includes("runs on the JS thread")),
      [],
      "every read replays",
    );
  } finally {
    fixture.close();
  }
});

test("while the kept totals settle, the played totals sum off the thread with the same totals", async () => {
  const fixture = await createFastAgainFixture();
  try {
    addStreamedPlays(fixture.db, 300, fixture.now);
    const log = await appLog();
    const here = await loadLibraryStore(root, fixture.db);
    const away = await loadLibraryStore(root, fixture.db, { offThreadReads: true });
    // Every song owed, as after an upgrade: the totals are summed from the history (#1451).
    fixture.db.run(sql`UPDATE played_songs SET state = 1`);
    assert.equal(keptTotalsSettled(fixture.db), false);
    for (const window of [
      { from: null, to: fixture.now },
      { from: fixture.now - 30 * 86_400_000, to: fixture.now },
    ]) {
      const reads: [string, (store: typeof here) => Effect.Effect<unknown, unknown>][] = [
        ["playedEntityTotals", (s) => s.playedEntityTotals(window)],
        ["playedArtistTotals", (s) => s.playedArtistTotals(window)],
      ];
      for (const [name, read] of reads) {
        const expected = Effect.runSync(read(here));
        const traced = await traceAsync(fixture.db, () => Effect.runPromise(read(away)));
        assert.deepEqual(traced.result, expected, name);
        assert.equal(traced.mainStatements, 0, `${name} read on the main connection`);
      }
    }
    const totals = Effect.runSync(here.playedEntityTotals({ from: null, to: fixture.now }));
    assert.ok(
      totals.artists.some((artist) => typeof artist.id === "string"),
      "online artists",
    );
    log.flush();
    assert.deepEqual(
      log.lines.filter((line) => line.includes("runs on the JS thread")),
      [],
      "both reads replay",
    );
  } finally {
    fixture.close();
  }
});

/**
 * Runs [read] and counts the statements the main connection ran synchronously
 * for it. The test's read connection runs on the same sql.js client a turn
 * later, from inside `setImmediate`, so only statements in [read]'s own
 * synchronous slices are the main connection's.
 */
const traceAsync = async <A>(
  db: Parameters<typeof traceQueries>[0],
  read: () => Promise<A>,
): Promise<{ result: A; mainStatements: number }> => {
  let promise!: Promise<A>;
  const { queries } = traceQueries(db, () => {
    promise = read();
  });
  return { result: await promise, mainStatements: queries.length };
};

test("a read after a write sees it, and reads stay in the order they were asked", async () => {
  const fixture = await createFastAgainFixture();
  try {
    const away = await loadLibraryStore(root, fixture.db, { offThreadReads: true });
    const before = await Effect.runPromise(away.listFavorites);
    const target = fixture.songIds.find((id) => !before.some((song) => song.id === id))!;
    Effect.runSync(away.setFavorites([target], true));
    const after = await Effect.runPromise(away.favoriteTrackIds);
    assert.ok([...after].includes(target));

    const order: string[] = [];
    await Promise.all(
      ["first", "second", "third"].map((name) =>
        Effect.runPromise(Effect.tap(away.countTracks, () => Effect.sync(() => order.push(name)))),
      ),
    );
    assert.deepEqual(order, ["first", "second", "third"]);
  } finally {
    fixture.close();
  }
});

test("an effect that must finish in its task still reads synchronously", async () => {
  const fixture = await createFastAgainFixture();
  try {
    const { withSyncLibraryReads } = await loadWorktreeModule<
      typeof import("../syncLibraryReads.ts")
    >(root, "apps/mobile/src/library/syncLibraryReads.ts");
    const away = await loadLibraryStore(root, fixture.db, { offThreadReads: true });
    assert.ok(Exit.isFailure(Effect.runSyncExit(away.countTracks)), "off the thread by default");
    const exit = Effect.runSyncExit(withSyncLibraryReads(away.countTracks));
    assert.ok(Exit.isSuccess(exit));
    assert.equal(exit.value, fixture.size);
  } finally {
    fixture.close();
  }
});
