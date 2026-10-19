/**
 * The candidate catalog as Home's mix builds read it (docs/spec.md,
 * "Candidate catalog"): read once from the library database and shared by
 * the builds that start within a minute (Home's sections build on the same
 * visit), and forgotten when the harvest grew it.
 */
import type { CatalogSong } from "@wave/core";
import * as Effect from "effect/Effect";

import { sharedRead } from "@/lib/sharedRead";
import { LibraryStore } from "@/library/LibraryStore";

/** The catalog, read once, then shared for a minute. */
const shared = sharedRead(
  Effect.gen(function* () {
    return yield* (yield* LibraryStore).candidateCatalog;
  }),
  { keepMs: 60_000 },
);

/** The catalog for a mix build: read once, then shared for a minute. A failed read isn't kept. */
export const mixCatalog: Effect.Effect<readonly CatalogSong[], unknown, LibraryStore> = shared.get;

/** Forgets the shared catalog: the next build reads it again (after a harvest grew it). */
export const forgetMixCatalog = (): void => shared.forget();
