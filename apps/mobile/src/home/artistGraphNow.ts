/**
 * The app's artist graph (docs/spec.md, "Artist graph"): the recommendation
 * snapshot's graph part, derived from its catalog, the saved artist pages and
 * the play history the first time a recommendation asks for it, and derived
 * again for the ask after one of those is written. A write never rebuilds
 * the graph while it's built.
 */
import type { ArtistGraph } from "@wave/core";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";

import type { LibraryStore } from "@/library/LibraryStore";

import { recommendationSnapshot } from "./recommendationSnapshot";

/** The shared graph wasn't read: its read failed or timed out ([cause]). */
class ArtistGraphUnavailable extends Data.TaggedError("ArtistGraphUnavailable")<{
  readonly cause: unknown;
}> {}

/** The shared graph; failed or timed-out reads fail their callers and are retried on the next ask. */
export const artistGraphNow: Effect.Effect<ArtistGraph, ArtistGraphUnavailable, LibraryStore> =
  recommendationSnapshot.graph.pipe(
    Effect.mapError((cause) => new ArtistGraphUnavailable({ cause })),
  );
