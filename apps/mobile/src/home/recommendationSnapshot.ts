/**
 * The app's recommendation snapshot (docs/spec.md, "Recommendation
 * snapshot"; `shareRecommendationSnapshot`): the Library as Home's mixes
 * index it, the candidate catalog and the artist graph, read once from the
 * library database and shared by every recommendation until a write reaches
 * them. Every Library change and catalog or saved-page write is counted here;
 * a write never cancels a read under way, it goes into the next one.
 */
import {
  RECOMMENDATION_SNAPSHOT,
  snapshotVersionsAfter,
  type SnapshotSource,
  type SnapshotVersions,
} from "@wave/core";
import * as Effect from "effect/Effect";

import { settledTurnEffect } from "@/lib/backgroundWork";
import { recommendationTurnEffect } from "@/lib/recommendationWork";
import { snapshotRead } from "@/lib/snapshotRead";
import { onLibraryChange } from "@/library/libraryChanges";
import { LibraryStore } from "@/library/LibraryStore";
import { readRecommendationFavorites } from "@/library/playlistRecommendationInputs";

import { onArtistGraphSourcesChanged } from "./graphSources";
import type { MixIndexes } from "./mixKnown";
import { readMixInputs } from "./mixInputs";
import { readMixCatalog } from "./readMixCatalog";
import { shareRecommendationSnapshot } from "./sharedRecommendationSnapshot";

let versions: SnapshotVersions = {};
const written = (source: SnapshotSource): void => {
  versions = snapshotVersionsAfter(versions, source);
};
onLibraryChange((change) => written(change.kind));
onArtistGraphSourcesChanged(written);

/**
 * The snapshot. Its reads give the JavaScript thread back between steps
 * (`recommendationTurnEffect`, when a frame is due) so Home stays smooth; the graph waits for Home to
 * settle first.
 */
export const recommendationSnapshot = shareRecommendationSnapshot({
  library: Effect.gen(function* () {
    const indexes: MixIndexes = yield* readMixInputs(
      yield* LibraryStore,
      recommendationTurnEffect,
      Date.now(),
    );
    return indexes;
  }),
  catalog: Effect.gen(function* () {
    return yield* readMixCatalog(yield* LibraryStore, recommendationTurnEffect);
  }),
  graph: {
    store: Effect.service(LibraryStore),
    start: settledTurnEffect,
    between: recommendationTurnEffect,
  },
  versions: () => versions,
});

/**
 * The snapshot's stars part, for playlist suggestions: which songs are
 * starred or downloaded. Kept apart from the Library so a star doesn't make
 * Home's mixes read the Library again.
 */
export const recommendationFavorites = snapshotRead(
  Effect.gen(function* () {
    return yield* readRecommendationFavorites(yield* LibraryStore, recommendationTurnEffect);
  }),
  { part: RECOMMENDATION_SNAPSHOT.favorites, versions: () => versions },
);
