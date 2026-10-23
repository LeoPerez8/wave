/** Shared version lifetime for every graph consumer, independent of React/native modules. */
import * as Effect from "effect/Effect";
import { sharedRead } from "../lib/sharedRead.ts";
import { readArtistGraph, type ArtistGraphReads } from "./artistGraph.ts";
export const shareArtistGraph = <R>(
  store: Effect.Effect<ArtistGraphReads, never, R>,
  start: Effect.Effect<void>,
  between: Effect.Effect<void>,
) =>
  sharedRead(
    Effect.gen(function* () {
      yield* start;
      return yield* readArtistGraph(yield* store, between);
    }),
  );
