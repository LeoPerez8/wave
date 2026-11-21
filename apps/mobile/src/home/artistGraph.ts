/** The graph's database adapter; every read and CPU slice yields through the supplied scheduler. */
import {
  createArtistGraphBuild,
  creditSplitter,
  type ArtistGraph,
  type ArtistGraphCatalogEntry,
} from "@wave/core";
import * as Effect from "effect/Effect";
import type { LibraryStore, LibraryStoreError } from "@/library/LibraryStore";

import { readCatalogInputs } from "./catalogInputs.ts";
import { runSteps } from "../lib/stepped.ts";

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
  between: Effect.Effect<void> = Effect.void,
  catalog?: readonly ArtistGraphCatalogEntry[],
): Effect.Effect<ArtistGraph, LibraryStoreError> =>
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
    if (plays.some((play) => play.streamed)) {
      yield* between;
      split = creditSplitter(yield* store.mixCreditNames);
    }
    const splitBy = split;
    yield* between;
    yield* runSteps(
      build.plays(
        splitBy === null
          ? plays
          : plays.map((play) =>
              play.streamed ? { ...play, artists: [...new Set(splitBy(play.artists))] } : play,
            ),
      ),
      between,
    );
    yield* between;
    return yield* runSteps(build.finish(), between);
  });
