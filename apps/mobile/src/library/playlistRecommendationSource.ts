/**
 * Playlist suggestions' inputs over the recommendation snapshot; no read
 * starts until a settled, visible visit asks. They take each part's last
 * completed read and warm a newer one in the background, so they never wait
 * for a derivation, including on a cold start.
 */
import * as Effect from "effect/Effect";
import { recommendationTurnEffect } from "@/lib/recommendationWork";
import { recommendationFavorites, recommendationSnapshot } from "@/home/recommendationSnapshot";
import { LibraryStore } from "./LibraryStore";
import { sharePlaylistRecommendationInputs } from "./playlistRecommendationInputs";

const inputs = sharePlaylistRecommendationInputs(
  {
    library: recommendationSnapshot.library,
    favorites: recommendationFavorites.get,
    peek: () => ({
      library: recommendationSnapshot.peek().library,
      favorites: recommendationFavorites.peek(),
    }),
    store: Effect.service(LibraryStore),
  },
  recommendationTurnEffect,
);

/**
 * Only the deferred playlist visit/refill invokes this whole-source capability.
 * Its askers wait for their turn first (a visit for the app to settle, a refill
 * for a free turn), so it adds no wait of its own.
 */
export const playlistRecommendationInput = (id: number) => inputs.latest(id);

/** The artist graph's last derivation (null before the first), warming a newer one meanwhile. */
export const playlistRecommendationGraph = Effect.gen(function* () {
  yield* Effect.forkDetach(Effect.ignore(recommendationSnapshot.graph));
  return recommendationSnapshot.peek().graph;
});
