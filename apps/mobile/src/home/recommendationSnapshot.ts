/**
 * The app's recommendation snapshot (docs/spec.md, "Recommendation
 * snapshot"; `shareRecommendationSnapshot`): the Library as Home's mixes
 * index it, the candidate catalog and the artist graph, read once from the
 * library database and shared by every recommendation until a write reaches
 * them. Every Library change and catalog or saved-page write is counted here;
 * a write never cancels a read under way, it goes into the next one.
 */
import { namedWork } from "@/lib/stepped";
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
import { homeTurnOf, homeWork } from "./homeWork";

/** The snapshot's reads are Home's build: they take Home's turns (#1351). */
const homeTurn = homeTurnOf(recommendationTurnEffect);

let versions: SnapshotVersions = {};
const written = (source: SnapshotSource): void => {
  versions = snapshotVersionsAfter(versions, source);
};
onLibraryChange((change) => written(change.kind));
onArtistGraphSourcesChanged(written);

/**
 * The snapshot, as Home's mixes and Magic Queue carousel ask for it. Its
 * reads give the JavaScript thread back between steps
 * (`recommendationTurnEffect`, when a frame is due) so Home stays smooth, and
 * take no step while Home is out of sight and nobody else waits for them
 * (`homeWork`); the graph waits for Home to settle first.
 */
export const homeRecommendationSnapshot = shareRecommendationSnapshot({
  library: Effect.gen(function* () {
    const indexes: MixIndexes = yield* readMixInputs(yield* LibraryStore, homeTurn, Date.now());
    return indexes;
  }).pipe(namedWork("Home mix inputs")),
  catalog: Effect.gen(function* () {
    return yield* readMixCatalog(yield* LibraryStore, homeTurn);
  }).pipe(namedWork("Home mix catalog")),
  graph: {
    store: Effect.service(LibraryStore),
    start: homeTurnOf(settledTurnEffect),
    between: homeTurn,
  },
  versions: () => versions,
});

/**
 * The snapshot, as everyone off Home asks for it (a Magic Queue, DJ, a
 * playlist's suggestions): waiting for a part opens Home's gate until it comes.
 */
export const recommendationSnapshot = {
  ...homeRecommendationSnapshot,
  library: homeWork.wanted(homeRecommendationSnapshot.library),
  catalog: homeWork.wanted(homeRecommendationSnapshot.catalog),
  graph: homeWork.wanted(homeRecommendationSnapshot.graph),
  get: homeWork.wanted(homeRecommendationSnapshot.get),
};

/**
 * The snapshot's stars part, for playlist suggestions: which songs are
 * starred or downloaded. Kept apart from the Library so a star doesn't make
 * Home's mixes read the Library again.
 */
export const recommendationFavorites = snapshotRead(
  Effect.gen(function* () {
    return yield* readRecommendationFavorites(yield* LibraryStore, recommendationTurnEffect);
  }).pipe(namedWork("recommendation favorites")),
  { part: RECOMMENDATION_SNAPSHOT.favorites, versions: () => versions },
);
