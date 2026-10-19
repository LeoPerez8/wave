/**
 * The app's artist graph (docs/spec.md, "Artist graph"), derived from the
 * library database once per session (`readArtistGraph`), the first time a
 * build asks for it. Whatever grows its sources in the background (a
 * harvest) calls `forgetArtistGraph` so the next build derives it again.
 */
import type { ArtistGraph } from "@wave/core";
import * as Effect from "effect/Effect";

import { freeTurnEffect } from "@/lib/backgroundWork";
import { sharedRead } from "@/lib/sharedRead";
import { LibraryStore } from "@/library/LibraryStore";

import { readArtistGraph } from "./artistGraph";

const shared = sharedRead(
  Effect.gen(function* () {
    return yield* readArtistGraph(yield* LibraryStore, freeTurnEffect);
  }),
);

/** The artist graph, derived once per session; null while it can't be read (derived again next time). */
export const artistGraphNow: Effect.Effect<ArtistGraph | null, never, LibraryStore> =
  shared.get.pipe(Effect.orElseSucceed(() => null));

/** Forgets the artist graph: the next ask derives it again (after a harvest grew the catalog). */
export const forgetArtistGraph = (): void => shared.forget();
