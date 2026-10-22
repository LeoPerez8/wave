/** The graph's database adapter; every page and CPU slice yields through the supplied scheduler. */
import { createArtistGraphBuild, type ArtistGraph } from "@wave/core";
import * as Effect from "effect/Effect";
import type { LibraryStore, LibraryStoreError } from "@/library/LibraryStore";
import type { GraphPlayCursor } from "../library/db/artistGraph.ts";
import { readCatalogInputs } from "./catalogInputs.ts";
import { runSteps } from "../lib/stepped.ts";

export type ArtistGraphReads = Pick<
  LibraryStore["Service"],
  "graphRadioPage" | "graphCatalogPage" | "graphSimilarPage" | "graphPlayPage"
>;
export const readArtistGraph = (
  store: ArtistGraphReads,
  between: Effect.Effect<void> = Effect.void,
): Effect.Effect<ArtistGraph, LibraryStoreError> =>
  Effect.gen(function* () {
    const build = createArtistGraphBuild();
    const catalog = yield* readCatalogInputs(
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
    let plays: GraphPlayCursor = [-Number.MAX_VALUE, 0];
    for (;;) {
      yield* between;
      const page = yield* store.graphPlayPage(plays);
      yield* between;
      yield* runSteps(build.plays(page.rows), between);
      if (page.next === null) break;
      plays = page.next;
    }
    yield* between;
    return yield* runSteps(build.finish(), between);
  });
