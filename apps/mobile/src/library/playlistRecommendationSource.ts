/** App lifetime source cache; no read starts until a settled, visible visit asks. */
import * as Effect from "effect/Effect";
import { freeTurnEffect, settledTurnEffect } from "@/lib/backgroundWork";
import { onArtistGraphSourcesChanged } from "@/home/graphSources";
import { LibraryStore } from "./LibraryStore";
import { onLibraryChange } from "./libraryChanges";
import { observePlaylistRecommendationInputs } from "./playlistRecommendationInputs";

// One store and one source version are retained for this app runtime.
let current:
  | {
      store: LibraryStore["Service"];
      source: ReturnType<typeof observePlaylistRecommendationInputs>;
    }
  | undefined;

/** Only the deferred playlist visit/refill invokes this whole-source capability. */
export const playlistRecommendationInput = (id: number) =>
  Effect.gen(function* () {
    yield* settledTurnEffect;
    const store = yield* LibraryStore;
    if (current?.store !== store) {
      current?.source.dispose();
      current = {
        store,
        source: observePlaylistRecommendationInputs(
          store,
          freeTurnEffect,
          onLibraryChange,
          (listener) =>
            onArtistGraphSourcesChanged((kind) => {
              if (kind === "catalog") listener();
            }),
        ),
      };
    }
    return yield* current.source.get(id);
  });
