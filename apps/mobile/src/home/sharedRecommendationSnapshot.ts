/**
 * The recommendation snapshot (docs/spec.md, "Recommendation snapshot"): the
 * Library, the candidate catalog and the artist graph, each read once and
 * shared by Home's mixes, the Magic Queue radio, playlist suggestions and the
 * harvest until one of its sources is written (Core's `snapshotAsk`). The
 * graph is derived from the catalog part, so the catalog is paged once for
 * both. Kept free of Expo so it runs under plain Node tests.
 */
import {
  RECOMMENDATION_SNAPSHOT,
  type ArtistGraph,
  type CatalogSong,
  type SnapshotVersions,
} from "@wave/core";
import * as Effect from "effect/Effect";
import { snapshotRead } from "../lib/snapshotRead.ts";
import type { ArtistGraphReads } from "./artistGraph.ts";
import { shareArtistGraph } from "./sharedArtistGraph.ts";

/** The snapshot's parts, as one recommendation reads them together. */
interface RecommendationSnapshot<L> {
  readonly library: L;
  readonly catalog: readonly CatalogSong[];
  readonly graph: ArtistGraph;
}

/**
 * The snapshot over its reads: [library] (Home's mix indexes), [catalog], and
 * the graph's other pages ([graph]: its store, its initial wait, what it
 * yields between steps), kept while [versions] (the writes counted so far)
 * leave each part as it was read.
 */
export const shareRecommendationSnapshot = <L, R>({
  library,
  catalog,
  graph,
  versions,
  now = Date.now,
}: {
  readonly library: Effect.Effect<L, unknown, R>;
  readonly catalog: Effect.Effect<readonly CatalogSong[], unknown, R>;
  readonly graph: {
    readonly store: Effect.Effect<ArtistGraphReads, never, R>;
    readonly start: Effect.Effect<void>;
    readonly between: Effect.Effect<void>;
  };
  readonly versions: () => SnapshotVersions;
  readonly now?: () => number;
}) => {
  const libraryPart = snapshotRead(library, {
    part: RECOMMENDATION_SNAPSHOT.library,
    versions,
    now,
  });
  const catalogPart = snapshotRead(catalog, {
    part: RECOMMENDATION_SNAPSHOT.catalog,
    versions,
    now,
  });
  const graphPart = shareArtistGraph(graph.store, graph.start, graph.between, {
    catalog: catalogPart.get,
    versions,
  });
  return {
    /** The Library part: songs, artists and plays (Home's mix indexes). */
    library: libraryPart.get,
    /** The candidate catalog part. */
    catalog: catalogPart.get,
    /** The artist graph part, derived from the catalog part. */
    graph: graphPart.get,
    /** Every part, for a recommendation that reads them all once. */
    get: Effect.gen(function* () {
      const indexes = yield* libraryPart.get;
      // The catalog the graph was derived from, so a write between two catalog asks can't split them.
      const derived = yield* graphPart.derived;
      const read: RecommendationSnapshot<L> = {
        library: indexes,
        catalog: derived.catalog ?? (yield* catalogPart.get),
        graph: derived.graph,
      };
      return read;
    }),
    dispose: () => {
      graphPart.dispose();
      catalogPart.dispose();
      libraryPart.dispose();
    },
  };
};
