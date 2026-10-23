/** Shared version lifetime for every graph consumer, independent of React/native modules. */
import * as Effect from "effect/Effect";
import { sharedRead } from "../lib/sharedRead.ts";
import { readArtistGraph, type ArtistGraphReads } from "./artistGraph.ts";

/**
 * The longest the shared graph read may run: past it, its callers get an
 * error and a later read tries again.
 */
const GRAPH_READ_TIMEOUT = "15 seconds";

export const shareArtistGraph = <R>(
  store: Effect.Effect<ArtistGraphReads, never, R>,
  start: Effect.Effect<void>,
  between: Effect.Effect<void>,
) =>
  sharedRead(
    Effect.gen(function* () {
      yield* start;
      return yield* readArtistGraph(yield* store, between);
    }).pipe(Effect.timeout(GRAPH_READ_TIMEOUT)),
  );
