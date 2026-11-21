import type { MagicQueueSeed } from "@wave/core";
import * as Effect from "effect/Effect";

import { recommendationTurnEffect } from "@/lib/recommendationWork";
import { LibraryStore } from "@/library/LibraryStore";
import { libraryQuery, useLibraryQuery } from "@/library/sharedQueries";
import { tasteProfileForRecommendation } from "@/playback/TasteProfile";
import { useDontPlayExplicit } from "@/settings/dontPlayExplicit";
import type { PlayableSongRow } from "@wave/client";

import { lookedUpProfileOf } from "./artistGenres";
import { readDiscoveries } from "./discoveriesRead";
import { recommendationSnapshot } from "./recommendationSnapshot";

const NONE: readonly MagicQueueSeed<PlayableSongRow>[] = [];

const read = (explicit: boolean) =>
  libraryQuery(
    `home:discoveries:${explicit ? "clean" : "all"}`,
    { tracks: true, plays: true },
    Effect.gen(function* () {
      const store = yield* LibraryStore;
      const library = yield* recommendationSnapshot.library;
      const catalog = yield* recommendationSnapshot.catalog;
      return yield* readDiscoveries(store, {
        now: Date.now(),
        library,
        catalog,
        taste: yield* tasteProfileForRecommendation(library),
        profileOf: lookedUpProfileOf,
        dontPlayExplicit: explicit,
        turn: recommendationTurnEffect,
      });
    }).pipe(
      // A failed read leaves the page out; the other pages never wait on it.
      Effect.orElseSucceed(() => NONE),
    ),
  );

const queries = { clean: read(true), all: read(false) };

/**
 * The carousel's Discoveries page (`readDiscoveries`): its songs, none when
 * the page is left out or isn't read yet (and while [enabled] is off). Built
 * from what the phone keeps (the recommendation snapshot's Library and
 * candidate catalog, the Taste profile and the play history), with no
 * network. It keeps what it last read while Home is out of sight, so coming
 * back from another screen repaints the same songs, and it re-reads only
 * when plays or songs changed: a song played leaves the page then.
 */
export const useDiscoveries = (enabled: boolean): readonly MagicQueueSeed<PlayableSongRow>[] => {
  const explicit = useDontPlayExplicit();
  return useLibraryQuery<readonly MagicQueueSeed<PlayableSongRow>[]>(
    enabled ? queries[explicit ? "clean" : "all"] : null,
    NONE,
  );
};
