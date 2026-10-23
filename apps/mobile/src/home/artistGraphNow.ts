import { onArtistGraphSourcesChanged } from "./graphSources";
/**
 * The app's artist graph (docs/spec.md, "Artist graph"), derived from the
 * library database once per session (`readArtistGraph`), the first time a
 * build asks for it. Whatever grows its sources in the background (a
 * harvest) calls `forgetArtistGraph` so the next build derives it again.
 */
import type { ArtistGraph } from "@wave/core";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";

import { freeTurnEffect, settledTurnEffect } from "@/lib/backgroundWork";

import { onLibraryChange } from "@/library/libraryChanges";
import { LibraryStore } from "@/library/LibraryStore";

import { shareArtistGraph } from "./sharedArtistGraph";

const shared = shareArtistGraph(Effect.service(LibraryStore), settledTurnEffect, freeTurnEffect);

/** The shared graph wasn't read: its read failed, timed out or kept being forgotten ([cause]). */
export class ArtistGraphUnavailable extends Data.TaggedError("ArtistGraphUnavailable")<{
  readonly cause: unknown;
}> {}

/** The shared graph; failed or timed-out reads fail their callers and are retried on the next ask. */
export const artistGraphNow: Effect.Effect<ArtistGraph, ArtistGraphUnavailable, LibraryStore> =
  shared.get.pipe(Effect.mapError((cause) => new ArtistGraphUnavailable({ cause })));

/** Forgets the artist graph: the next ask derives it again (after a harvest grew the catalog). */
export const forgetArtistGraph = (): void => shared.forget();

// The graph has no favorite/playlist input. Harvests and saved-page writers invalidate explicitly.
onLibraryChange((change) => {
  if (change.kind === "tracks" || change.kind === "plays") shared.forget();
});

onArtistGraphSourcesChanged(shared.forget);
