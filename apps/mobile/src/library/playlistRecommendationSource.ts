/** Playlist suggestions' inputs over the recommendation snapshot; no read starts until a settled, visible visit asks. */
import * as Effect from "effect/Effect";
import { settledTurnEffect } from "@/lib/backgroundWork";
import { recommendationTurnEffect } from "@/lib/recommendationWork";
import { recommendationFavorites, recommendationSnapshot } from "@/home/recommendationSnapshot";
import { LibraryStore } from "./LibraryStore";
import { sharePlaylistRecommendationInputs } from "./playlistRecommendationInputs";

const inputs = sharePlaylistRecommendationInputs(
  {
    library: recommendationSnapshot.library,
    catalog: recommendationSnapshot.catalog,
    favorites: recommendationFavorites.get,
    store: Effect.service(LibraryStore),
  },
  recommendationTurnEffect,
);

/** Only the deferred playlist visit/refill invokes this whole-source capability. */
export const playlistRecommendationInput = (id: number) =>
  Effect.gen(function* () {
    yield* settledTurnEffect;
    return yield* inputs.get(id);
  });
