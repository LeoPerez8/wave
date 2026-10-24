/** Shared version lifetime for every graph consumer, independent of React/native modules. */
import {
  RECOMMENDATION_SNAPSHOT,
  type ArtistGraphCatalogEntry,
  type SnapshotVersions,
} from "@wave/core";
import * as Effect from "effect/Effect";
import { snapshotRead } from "../lib/snapshotRead.ts";
import { readArtistGraph, type ArtistGraphReads } from "./artistGraph.ts";

/**
 * The artist graph, read as the recommendation snapshot's graph part: kept
 * until a source it's derived from is written (`versions`, Core's
 * `snapshotAsk`), never rebuilt while it's built. Derived from [catalog]
 * when given (the snapshot's catalog part), else from the catalog's pages;
 * `derived` also gives the catalog it was derived from, so a snapshot can
 * take both from one read.
 */
export const shareArtistGraph = <R, C extends ArtistGraphCatalogEntry = never, RC = never>(
  store: Effect.Effect<ArtistGraphReads, never, R>,
  start: Effect.Effect<void>,
  between: Effect.Effect<void>,
  {
    catalog,
    versions = () => ({}),
  }: {
    readonly catalog?: Effect.Effect<readonly C[], unknown, RC>;
    readonly versions?: () => SnapshotVersions;
  } = {},
) => {
  const part = snapshotRead(
    Effect.gen(function* () {
      const entries = catalog === undefined ? undefined : yield* catalog;
      yield* start;
      return { graph: yield* readArtistGraph(yield* store, between, entries), catalog: entries };
    }),
    { part: RECOMMENDATION_SNAPSHOT.graph, versions },
  );
  return {
    /** The graph. */
    get: Effect.map(part.get, ({ graph }) => graph),
    peek: () => part.peek()?.graph ?? null,
    /** The graph with the catalog it was derived from (undefined when read from the pages). */
    derived: part.get,
    dispose: part.dispose,
  };
};
