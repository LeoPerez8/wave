/**
 * The candidate catalog as Home's mix builds read it (docs/spec.md,
 * "Candidate catalog"): read once from the library database and shared by
 * the builds that start within a minute (Home's sections build on the same
 * visit), and forgotten when the harvest grew it.
 */
import type { CatalogSong } from "@wave/core";
import * as Effect from "effect/Effect";

import { LibraryStore } from "@/library/LibraryStore";
import { appRuntime } from "@/library/runtime";

/** A catalog this recent serves another section's build. */
const SHARED_FOR_MS = 60_000;
let shared: { readonly at: number; readonly catalog: Promise<readonly CatalogSong[]> } | null =
  null;

/** The catalog for a mix build: read once, then shared for a minute. A failed read isn't kept. */
export const mixCatalog: Effect.Effect<readonly CatalogSong[], unknown> = Effect.suspend(() => {
  const now = Date.now();
  if (shared === null || now - shared.at > SHARED_FOR_MS) {
    const catalog = appRuntime.runPromise(
      Effect.gen(function* () {
        return yield* (yield* LibraryStore).candidateCatalog;
      }),
    );
    shared = { at: now, catalog };
    catalog.catch(() => {
      if (shared?.catalog === catalog) shared = null;
    });
  }
  const { catalog } = shared;
  return Effect.tryPromise({ try: () => catalog, catch: (cause) => cause });
});

/** Forgets the shared catalog: the next build reads it again (after a harvest grew it). */
export const forgetMixCatalog = (): void => {
  shared = null;
};
