/**
 * The candidate catalog as recommendations read it (docs/spec.md,
 * "Candidate catalog"): the recommendation snapshot's catalog part, read once
 * from the library database and shared until a radio or artist page adds to
 * it.
 */
import type { CatalogSong } from "@wave/core";
import type * as Effect from "effect/Effect";

import type { LibraryStore } from "@/library/LibraryStore";

import { recommendationSnapshot } from "./recommendationSnapshot";

/** The catalog for a recommendation: the snapshot's. A failed read isn't kept. */
export const mixCatalog: Effect.Effect<readonly CatalogSong[], unknown, LibraryStore> =
  recommendationSnapshot.catalog;
