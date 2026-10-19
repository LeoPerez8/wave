/**
 * The app's artist graph (docs/spec.md, "Artist graph"), derived from the
 * library database once per session (`readArtistGraph`), the first time a
 * build asks for it. Whatever grows its sources in the background (a
 * harvest) calls `forgetArtistGraph` so the next build derives it again.
 */
import type { ArtistGraph } from "@wave/core";
import * as Effect from "effect/Effect";

import { freeTurnEffect } from "@/lib/backgroundWork";
import { LibraryStore } from "@/library/LibraryStore";
import { appRuntime } from "@/library/runtime";

import { artistGraphOnce, readArtistGraph } from "./artistGraph";

const once = artistGraphOnce(() =>
  appRuntime.runPromise(
    Effect.gen(function* () {
      return yield* readArtistGraph(yield* LibraryStore, freeTurnEffect);
    }),
  ),
);

/** The artist graph, derived once per session; null while it can't be read. */
export const artistGraphNow: Effect.Effect<ArtistGraph | null> = once.now;

/** Forgets the artist graph: the next ask derives it again (after a harvest grew the catalog). */
export const forgetArtistGraph: () => void = once.forget;
