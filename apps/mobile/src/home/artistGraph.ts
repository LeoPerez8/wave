/** The graph's database adapter; every read and CPU slice yields through the supplied scheduler. */
import {
  createArtistGraphBuild,
  creditSplitterSteps,
  type ArtistGraph,
  type ArtistGraphCatalogEntry,
} from "@wave/core";
import * as Effect from "effect/Effect";
import type { LibraryStore, LibraryStoreError } from "@/library/LibraryStore";

import { readCatalogInputs } from "./catalogInputs.ts";
import { type BackgroundWorkName, runSteps, type Turn } from "../lib/stepped.ts";

export type ArtistGraphReads = Pick<
  LibraryStore["Service"],
  "graphRadioPage" | "graphCatalogPage" | "ytArtistSimilar" | "graphPlays" | "mixCreditNames"
>;
/**
 * The graph from [store]'s sources, each read whole. Given the [catalog] already read (the
 * recommendation snapshot's), it doesn't read the catalog's pages again.
 */
export const readArtistGraph = (
  store: ArtistGraphReads,
  between: Turn = Effect.void,
  catalog?: readonly ArtistGraphCatalogEntry[],
): Effect.Effect<ArtistGraph, LibraryStoreError, BackgroundWorkName> =>
  Effect.gen(function* () {
    const build = createArtistGraphBuild();
    if (catalog === undefined)
      catalog = yield* readCatalogInputs(
        store.graphCatalogPage,
        store.graphRadioPage,
        between,
        (entry) => entry.videoId,
      );
    yield* runSteps(build.catalog(catalog), between);
    // Each source whole, one read off the JS thread, whatever the Library's size (#1351);
    // the rows go in the paged walk's order, so the graph is the same.
    yield* between;
    const similar = yield* store.ytArtistSimilar;
    yield* between;
    yield* runSteps(build.pages(similar), between);
    yield* between;
    const plays = yield* store.graphPlays;
    // Streamed credits split as Stats splits them (`streamedCredits`), with
    // the Library's credits, read only when a streamed play needs them.
    let split: ((credit: readonly string[]) => string[]) | null = null;
    // Both run in steps: a big Library's credits and plays never take one task (#1487).
    if (plays.some((play) => play.streamed)) {
      yield* between;
      const credits = yield* store.mixCreditNames;
      split = yield* runSteps(creditSplitterSteps(credits), between);
    }
    const splitBy = split;
    yield* between;
    yield* runSteps(
      build.plays(
        splitBy === null
          ? plays
          : (function* () {
              for (const play of plays)
                yield play.streamed
                  ? { ...play, artists: [...new Set(splitBy(play.artists))] }
                  : play;
            })(),
      ),
      between,
    );
    yield* between;
    return yield* runSteps(build.finish(), between);
  });
