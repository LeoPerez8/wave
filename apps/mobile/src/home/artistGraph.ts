/** The graph's database adapter; every page and CPU slice yields through the supplied scheduler. */
import {
  createArtistGraphBuild,
  creditSplitter,
  type ArtistGraph,
  type ArtistGraphCatalogEntry,
} from "@wave/core";
import * as Effect from "effect/Effect";
import type { LibraryStore, LibraryStoreError } from "@/library/LibraryStore";
import type { GraphPlayCursor } from "../library/db/artistGraph.ts";
import { readCatalogInputs } from "./catalogInputs.ts";
import { runSteps } from "../lib/stepped.ts";

export type ArtistGraphReads = Pick<
  LibraryStore["Service"],
  | "graphRadioPage"
  | "graphCatalogPage"
  | "graphSimilarPage"
  | "graphPlayPage"
  | "mixCreditNamesPage"
>;
/**
 * The graph from [store]'s pages. Given the [catalog] already read (the
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
    let similar: string | null = null;
    for (;;) {
      yield* between;
      const page: Effect.Success<ReturnType<ArtistGraphReads["graphSimilarPage"]>> =
        yield* store.graphSimilarPage(similar);
      yield* between;
      yield* runSteps(build.pages(page.rows), between);
      if (page.next === null) break;
      similar = page.next;
    }
    // Streamed credits split as Stats splits them (`streamedCredits`), with
    // the Library's credits, read the first time a streamed play needs them.
    let split: ((credit: readonly string[]) => string[]) | null = null;
    let plays: GraphPlayCursor = [-Number.MAX_VALUE, 0];
    for (;;) {
      yield* between;
      const page = yield* store.graphPlayPage(plays);
      if (split === null && page.rows.some((play) => play.streamed)) {
        const credits: string[] = [];
        for (let after: number | null = 0; after !== null;) {
          yield* between;
          const names: Effect.Success<ReturnType<ArtistGraphReads["mixCreditNamesPage"]>> =
            yield* store.mixCreditNamesPage(after);
          for (const name of names.rows) credits.push(name);
          after = names.next;
        }
        split = creditSplitter(credits);
      }
      const splitBy = split;
      yield* between;
      yield* runSteps(
        build.plays(
          splitBy === null
            ? page.rows
            : page.rows.map((play) =>
                play.streamed ? { ...play, artists: [...new Set(splitBy(play.artists))] } : play,
              ),
        ),
        between,
      );
      if (page.next === null) break;
      plays = page.next;
    }
    yield* between;
    return yield* runSteps(build.finish(), between);
  });
