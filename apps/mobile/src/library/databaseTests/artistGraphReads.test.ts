/**
 * The artist graph reads its sources whole, like the rest of Home's build (#1351): the same
 * read count for a Library of 1,000 songs and one of 12,000, and the same graph as the paged
 * walk it replaced.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import * as Effect from "effect/Effect";
import {
  createArtistGraphBuild,
  creditSplitter,
  type ArtistGraph,
  type ArtistGraphCatalogEntry,
  type PlayEvent,
  type YtAlbumSong,
} from "@wave/core";
import { sql } from "drizzle-orm";
import { addCandidates } from "@wave/client/db/candidateCatalog";
import { recordPlay } from "@wave/client/db/playHistory";
import type { GraphPlayCursor, graphPlayPage, graphSimilarPage } from "@wave/client/db/artistGraph";
import type { mixCreditNamesPage } from "@wave/client/db/mixInputs";
import { traceQueries } from "@wave/client/testing";
import {
  createFastAgainFixture,
  type FastAgainFixture,
  type FastAgainSize,
} from "@wave/client/testing/fastAgainFixture";
import { loadLibraryStore } from "../../../bench/fastAgain/store.ts";
import { readArtistGraph } from "../../home/artistGraph.ts";
import { readMixCatalog } from "../../home/readMixCatalog.ts";
import { runSteps } from "../../lib/stepped.ts";

const root = fileURLToPath(new URL("../../../../../", import.meta.url));

const online = (i: number): YtAlbumSong => ({
  videoId: `yt-${String(i).padStart(8, "0")}`,
  title: `Streamed ${i}`,
  artists: [`Online Artist ${i % 30} & Guest ${i % 7}`],
  album: `Online Album ${i % 50}`,
  albumId: null,
  durationMs: 200_000,
  artworkUrl: null,
  explicit: false,
});
const play = (trackId: string, startedAt: number): PlayEvent => ({
  trackId,
  context: null,
  startedAt,
  listenedMs: 180_000,
  durationMs: 200_000,
  endReason: "completed",
  counted: true,
  source: "phone",
});

/** Streamed plays, catalog songs and saved artist pages, a tenth of the Library each. */
const seed = (fixture: FastAgainFixture): void => {
  const extra = fixture.size / 10;
  const songs = Array.from({ length: extra }, (_, i) => online(i));
  songs.forEach((song, i) =>
    recordPlay(fixture.db, play(`yt:${song.videoId}`, fixture.now - 1000 * (i + 1)), false, song),
  );
  for (let at = 0; at < extra; at += 100)
    addCandidates(
      fixture.db,
      { seed: `Online Artist ${at % 30}`, songs: songs.slice(at, at + 100) },
      fixture.now,
    );
  const artists = fixture.db
    .all<{ name: string }>(sql`SELECT name FROM artists ORDER BY id LIMIT ${extra}`)
    .map((row) => row.name);
  artists.forEach((name, i) => {
    const similar = [1, 2, 3].map((step) => ({
      name: artists[(i + step) % artists.length],
      browseId: `b${(i + step) % artists.length}`,
      audience: null,
    }));
    const outcome = i % 9 === 0 ? "missing" : "found";
    fixture.db.run(
      sql`INSERT INTO yt_artists (artist_key,outcome,checked_at,page) VALUES (${`k-${String(i).padStart(6, "0")}`},${outcome},0,${JSON.stringify({ name, similar })})`,
    );
  });
};

/** [store], counting each read it is asked for by name. */
const counting = <S extends object>(store: S) => {
  const reads: string[] = [];
  const counted = (key: PropertyKey, value: unknown) =>
    Effect.isEffect(value)
      ? Effect.tap(value, () => Effect.sync(() => void reads.push(String(key))))
      : value;
  const proxy = new Proxy(store, {
    get(target, key) {
      const value = Reflect.get(target, key);
      return typeof value === "function"
        ? (...args: unknown[]) => counted(key, value.apply(target, args))
        : counted(key, value);
    },
  });
  return { store: proxy, reads };
};

type Store = Awaited<ReturnType<typeof loadLibraryStore>>;

/** The paged walk the graph read before (#1351's fix), kept as the reference for its picks. */
const pagedArtistGraph = (store: Store, catalog: readonly ArtistGraphCatalogEntry[]) =>
  Effect.gen(function* () {
    const build = createArtistGraphBuild();
    yield* runSteps(build.catalog(catalog), Effect.void);
    for (let similar: string | null = null; ;) {
      const page: ReturnType<typeof graphSimilarPage> = yield* store.graphSimilarPage(similar);
      yield* runSteps(build.pages(page.rows), Effect.void);
      if (page.next === null) break;
      similar = page.next;
    }
    let split: ((credit: readonly string[]) => string[]) | null = null;
    for (let plays: GraphPlayCursor = [-Number.MAX_VALUE, 0]; ;) {
      const page: ReturnType<typeof graphPlayPage> = yield* store.graphPlayPage(plays);
      if (split === null && page.rows.some((row) => row.streamed)) {
        const credits: string[] = [];
        for (let after: number | null = 0; after !== null;) {
          const names: ReturnType<typeof mixCreditNamesPage> =
            yield* store.mixCreditNamesPage(after);
          credits.push(...names.rows);
          after = names.next;
        }
        split = creditSplitter(credits);
      }
      const splitBy = split;
      yield* runSteps(
        build.plays(
          splitBy === null
            ? page.rows
            : page.rows.map((row) =>
                row.streamed ? { ...row, artists: [...new Set(splitBy(row.artists))] } : row,
              ),
        ),
        Effect.void,
      );
      if (page.next === null) break;
      plays = page.next;
    }
    return yield* runSteps(build.finish(), Effect.void);
  });

const serialise = (graph: ArtistGraph) =>
  JSON.stringify({
    names: [...graph.names],
    edges: [...graph.edges].map(([key, edges]) => [key, [...edges]]),
  });

const measure = async (size: FastAgainSize) => {
  const fixture = await createFastAgainFixture(size);
  try {
    seed(fixture);
    const raw = await loadLibraryStore(root, fixture.db);
    const catalog = Effect.runSync(readMixCatalog(raw, Effect.void));
    const { store, reads } = counting(raw);
    const traced = traceQueries(fixture.db, () =>
      Effect.runSync(readArtistGraph(store, Effect.void, catalog)),
    );
    const paged = Effect.runSync(pagedArtistGraph(raw, catalog));
    return {
      reads,
      statements: traced.queries.length,
      graph: serialise(traced.result),
      paged: serialise(paged),
    };
  } finally {
    fixture.close();
  }
};

test("the artist graph reads as often for 12,000 songs as for 1,000, and picks the same", async () => {
  const small = await measure(1000);
  const large = await measure(12000);
  console.log(
    `Artist graph: ${small.reads.length} reads (${small.statements} statements) at 1,000 songs, ` +
      `${large.reads.length} reads (${large.statements} statements) at 12,000; ` +
      `reads: ${small.reads.join(", ")}`,
  );
  assert.equal(small.graph, small.paged, "the same graph as the paged walk at 1,000 songs");
  assert.equal(large.graph, large.paged, "the same graph as the paged walk at 12,000 songs");
  assert.deepEqual(large.reads, small.reads);
  assert.equal(large.statements, small.statements);
  assert.ok(small.reads.length <= 3, `${small.reads.length} reads: ${small.reads.join(", ")}`);
  for (const name of ["graphSimilarPage", "graphPlayPage", "mixCreditNamesPage"])
    assert.ok(!small.reads.includes(name), `${name} is read page by page`);
});
