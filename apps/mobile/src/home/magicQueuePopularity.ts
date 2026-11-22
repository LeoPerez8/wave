/**
 * How much of a hit each song of the Magic Queue row's pool is (Core's
 * `magicQueuePopularitySteps`), from the recommendation snapshot's catalog
 * and Library, which the phone keeps.
 */
import {
  magicQueuePopularitySteps,
  type CatalogSong,
  type MagicQueueSeedId,
  type YtAlbumSong,
} from "@wave/core";
import * as Effect from "effect/Effect";

import { type BackgroundWorkName, runSteps, type Turn } from "../lib/stepped.ts";

/** A pool song's popularity, from 0 (a deep cut) to 1. */
export type PopularityLookup = (id: MagicQueueSeedId) => number;

/** The part of the snapshot's Library the lookup reads: which catalog songs it holds. */
export interface PopularityLibrary {
  readonly known: {
    readonly inLibrary: (song: YtAlbumSong) => { readonly id: number } | null;
  };
}

/** What the lookup reads: the snapshot's two parts, and what runs between its steps. */
export interface PopularitySources<L extends PopularityLibrary, R> {
  readonly library: Effect.Effect<L, unknown, R>;
  readonly catalog: Effect.Effect<readonly CatalogSong[], unknown, R>;
  readonly between: Turn;
}

const deepCuts: PopularityLookup = () => 0;

/**
 * The lookup over [sources], kept for each Library and catalog read it was
 * built from, so a redraw doesn't walk the catalog again while neither
 * changed; a new read of either (a song added to the Library) builds it
 * again. Every song a deep cut when they can't be read.
 */
export const magicQueuePopularity = <L extends PopularityLibrary, R = never>(
  sources: PopularitySources<L, R>,
): Effect.Effect<PopularityLookup, never, R | BackgroundWorkName> => {
  const built = new WeakMap<object, WeakMap<object, PopularityLookup>>();
  return Effect.gen(function* () {
    const library = yield* sources.library;
    const catalog = yield* sources.catalog;
    const byCatalog = built.get(library) ?? new WeakMap<object, PopularityLookup>();
    built.set(library, byCatalog);
    const known = byCatalog.get(catalog);
    if (known !== undefined) return known;
    const lookup = yield* runSteps(
      magicQueuePopularitySteps(catalog, library.known.inLibrary),
      sources.between,
    );
    byCatalog.set(catalog, lookup);
    return lookup;
  }).pipe(Effect.orElseSucceed(() => deepCuts));
};
