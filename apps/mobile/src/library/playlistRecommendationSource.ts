/**
 * Playlist suggestions' inputs over the recommendation snapshot; no read
 * starts until a settled, visible visit asks. They take each part's last
 * completed read and warm a newer one in the background, so they never wait
 * for a derivation once one has completed.
 */
import * as Effect from "effect/Effect";
import { settledTurnEffect } from "@/lib/backgroundWork";
import { recommendationTurnEffect } from "@/lib/recommendationWork";
import { recommendationFavorites, recommendationSnapshot } from "@/home/recommendationSnapshot";
import { LibraryStore } from "./LibraryStore";
import { sharePlaylistRecommendationInputs } from "./playlistRecommendationInputs";

/** [peek]'s last completed value at once, [read] meanwhile warming a newer one; a cold part waits for [read]. */
const latest = <A, R>(peek: () => A | null, read: Effect.Effect<A, unknown, R>) =>
  Effect.gen(function* () {
    const last = peek();
    if (last === null) return yield* read;
    yield* Effect.forkDetach(Effect.ignore(read));
    return last;
  });

const inputs = sharePlaylistRecommendationInputs(
  {
    library: latest(() => recommendationSnapshot.peek().library, recommendationSnapshot.library),
    favorites: latest(recommendationFavorites.peek, recommendationFavorites.get),
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

/** The artist graph's last derivation (null before the first), warming a newer one meanwhile. */
export const playlistRecommendationGraph = Effect.gen(function* () {
  yield* Effect.forkDetach(Effect.ignore(recommendationSnapshot.graph));
  return recommendationSnapshot.peek().graph;
});
