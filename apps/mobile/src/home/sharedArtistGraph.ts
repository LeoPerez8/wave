/** Shared version lifetime for every graph consumer, independent of React/native modules. */
import {
  RECOMMENDATION_SNAPSHOT,
  type ArtistGraphCatalogEntry,
  type SnapshotVersions,
} from "@wave/core";
import * as Effect from "effect/Effect";
import { withRecommendationDeadline } from "../lib/recommendationTimeout.ts";
import { snapshotRead } from "../lib/snapshotRead.ts";
import { readArtistGraph, type ArtistGraphReads } from "./artistGraph.ts";

/**
 * The longest the shared graph read may run, from its initial wait on: past
 * it, its callers get an error and a later read tries again. The shared
 * catalog it's derived from has its own deadline.
 */
const GRAPH_READ_TIMEOUT = 15_000;

/**
 * The artist graph, read as the recommendation snapshot's graph part: kept
 * until a source it's derived from is written (`versions`, Core's
 * `snapshotAsk`), never rebuilt while it's built. Derived from [catalog]
 * when given (the snapshot's catalog part), else from the catalog's pages.
 */
export const shareArtistGraph = <R, RC = never>(
  store: Effect.Effect<ArtistGraphReads, never, R>,
  start: Effect.Effect<void>,
  between: Effect.Effect<void>,
  {
    catalog,
    versions = () => ({}),
  }: {
    readonly catalog?: Effect.Effect<readonly ArtistGraphCatalogEntry[], unknown, RC>;
    readonly versions?: () => SnapshotVersions;
  } = {},
) =>
  snapshotRead(
    Effect.gen(function* () {
      const entries = catalog === undefined ? undefined : yield* catalog;
      return yield* Effect.gen(function* () {
        yield* start;
        return yield* readArtistGraph(yield* store, between, entries);
      }).pipe((graph) => withRecommendationDeadline(graph, GRAPH_READ_TIMEOUT));
    }),
    { part: RECOMMENDATION_SNAPSHOT.graph, versions },
  );
