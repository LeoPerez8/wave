/**
 * A playlist recommendation's Add (#608), as the app runs it: the tap
 * publishes the slot's placeholder, the write and its announcement
 * (`acceptPlaylistRecommendation`, then `playlistsChanged`'s remembered list,
 * `selectPlaylists`) run in one task, the open playlist's own query re-reads
 * on a later task (`selectPlaylist`, as `sharedQueries` schedules it), then the
 * session reads the recommendation input and ranks the slot's replacement.
 * Prints the median of each measure over the timed runs, after a warm-up, and
 * one traced write's statements and rows.
 *
 * Desktop numbers: Node with sql.js (SQLite compiled to WebAssembly), not the
 * phone's SQLite, Hermes or frames. The session's host turns ("paint",
 * "free") are each a 0 ms timer here: an event-loop opportunity, never
 * evidence of a native frame. `longestTaskMs` is the largest gap a 1 ms
 * heartbeat saw (a blocking proxy that includes timer jitter). Run from the
 * repo root:
 *
 *   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON apps/mobile/bench/playlistRecommendationTap.ts [--db <dir>] [--session <file>]
 *
 * `--db` runs it against another copy of `src/library/db` (an older commit's,
 * from `git archive <commit> apps/mobile/src/library/db`) placed under
 * `apps/mobile` so its imports resolve; `--session` against another copy of
 * Core's `playlistRecommendationSession.ts` beside its `playlistRecommendations.ts`.
 */
import { playlistRecommendations, playlistRecommendationSession } from "@wave/core";
import { eq } from "drizzle-orm";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";

import * as current from "../src/library/db/playlistRecommendations.ts";
import { createPlaylist, selectPlaylist, selectPlaylists } from "../src/library/db/playlists.ts";
import * as schema from "../src/library/db/schema.ts";
import {
  addHistory,
  addTrack,
  openTestDatabase,
  traceQueries,
} from "../src/library/db/testDatabase.ts";
import { median, printMeta } from "./measure.ts";

const flag = (name: string): string | undefined => {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
};
const dbDir = flag("--db");
const sessionFile = flag("--session");
const store: typeof current =
  dbDir === undefined
    ? current
    : await import(pathToFileURL(resolve(dbDir, "playlistRecommendations.ts")).href);
const makeSession: typeof playlistRecommendationSession =
  sessionFile === undefined
    ? playlistRecommendationSession
    : (await import(pathToFileURL(resolve(sessionFile)).href)).playlistRecommendationSession;

const runs = 7;
const libraryCount = 5_000;
const playlistCount = 1_500;
const db = await openTestDatabase();
const seed = addTrack(db, { title: "Seed", artist: "Fixture", genre: "Rock" });
addHistory(db, { artist: "Fixture", tracks: libraryCount - 1, plays: 1 });
// Every song shares the seed's genre, so all of them stay eligible and ranking sees them all.
const genreId = db
  .select({ id: schema.tracks.genreId })
  .from(schema.tracks)
  .where(eq(schema.tracks.id, seed))
  .get()!.id;
db.update(schema.tracks).set({ genreId }).run();
const ids = db.select({ id: schema.tracks.id }).from(schema.tracks).all();
const { playlistId } = createPlaylist(
  db,
  "Long playlist",
  ids.slice(0, playlistCount).map(({ id }) => ({ source: "library", trackId: id })),
  0,
);

/** A later task of the event loop: the desktop stand-in for a frame or a free turn. */
const task = () => new Promise<void>((done) => setTimeout(done, 0));
let nextId = 0;
const samples: Record<string, number>[] = [];
let trace: object | undefined;
for (let run = 0; run <= runs; run++) {
  const phases: Record<string, number> = {};
  const timed = <T>(name: string, action: () => T): T => {
    const start = performance.now();
    const result = action();
    phases[name] = (phases[name] ?? 0) + performance.now() - start;
    return result;
  };
  let lastInput: ReturnType<typeof store.selectPlaylistRecommendationInput> | undefined;
  let detailRead: Promise<void> = Promise.resolve();
  const session = makeSession({
    newId: () => `bench-${++nextId}`,
    yieldTurn: () => task(),
    read: async () =>
      timed("sourceReadMs", () => {
        const input = store.selectPlaylistRecommendationInput(db, playlistId);
        lastInput = input;
        return { playlist: input.playlist, sources: { ...input, graph: null, now: 1 } };
      }),
    dismiss: async () => {},
    accept: async (offer) => {
      const added = timed("writeMs", () =>
        store.acceptPlaylistRecommendation(db, playlistId, offer, 2),
      );
      if (added) {
        // `playlistsChanged`: the remembered list is read in the same task…
        timed("listRefreshMs", () => selectPlaylists(db));
        // …and the open playlist's query on its own task.
        detailRead = task().then(() => {
          timed("detailRefreshMs", () => selectPlaylist(db, playlistId));
        });
      }
      return added;
    },
  });
  await session.renew();
  for (const name of Object.keys(phases)) delete phases[name];
  const offer = session.get().slots[2]!;
  let feedbackAt = -1;
  let placeholderAt = -1;
  let longestTaskMs = 0;
  let lastTick = performance.now();
  await task();
  const heartbeat = setInterval(() => {
    const now = performance.now();
    longestTaskMs = Math.max(longestTaskMs, now - lastTick);
    lastTick = now;
  }, 1);
  const start = performance.now();
  lastTick = start;
  const stop = session.subscribe(() => {
    // `pending` was one key (or null) before #650, and is every running action's key since.
    const state = session.get() as {
      pending: string | readonly string[] | null;
      pendingSlots?: readonly number[];
    };
    const acting = Array.isArray(state.pending) ? state.pending.length > 0 : state.pending !== null;
    if (feedbackAt < 0 && acting) feedbackAt = performance.now() - start;
    if (placeholderAt < 0 && state.pendingSlots?.includes(2) === true)
      placeholderAt = performance.now() - start;
  });
  const adding = session.accept(offer.key);
  const tapReturnMs = performance.now() - start;
  await adding;
  const replacementMs = performance.now() - start;
  await detailRead;
  stop();
  await task();
  clearInterval(heartbeat);
  // The replacement's ranking alone, on the same input (the session runs it inside `replacementMs`).
  const input = lastInput!;
  const rankStart = performance.now();
  playlistRecommendations(input.playlist, { ...input, graph: null });
  const rankMs = performance.now() - rankStart;
  if (session.get().slots[2] === null) throw new Error("the slot was not refilled");
  if (run > 0)
    samples.push({
      tapReturnMs,
      feedbackPublishedMs: feedbackAt,
      placeholderPublishedMs: placeholderAt,
      longestTaskMs,
      replacementMs,
      rankMs,
      ...phases,
    });
  if (run === runs) {
    // Trace one more new acceptance; EXPLAIN's overhead stays out of the timed samples.
    const next = session.get().slots[2]!;
    const { queries } = traceQueries(db, () =>
      store.acceptPlaylistRecommendation(db, playlistId, next, 3),
    );
    trace = {
      statements: queries.length,
      rowsReturned: queries.reduce((n, query) => n + query.rows, 0),
    };
  }
}

printMeta({
  runs,
  libraryCount,
  playlistCount,
  catalogCount: 0,
  units: "ms",
  db: dbDir ?? "current",
  session: sessionFile ?? "current",
  feedback: "session publication only; no React render or native frame",
  turns: "each host turn is a 0 ms timer",
  longestTask: "largest gap of a 1 ms heartbeat (includes timer jitter)",
});
console.log(
  JSON.stringify({
    kind: "median",
    ...Object.fromEntries(
      Object.keys(samples[0]!).map((key) => [key, median(samples.map((sample) => sample[key]!))]),
    ),
  }),
);
console.log(JSON.stringify({ kind: "writeTrace", ...trace }));
