/** Mix index source versions: a minute's answer, read again once the songs, plays, playlists or streams change. */
import type { LibraryChange } from "@wave/core";
import * as Effect from "effect/Effect";
import { sharedRead } from "../lib/sharedRead.ts";

/** The Library changes a mix build's indexes (`MixIndexes`) are read from. */
const SOURCES: readonly LibraryChange["kind"][] = ["tracks", "plays", "playlists", "streamed"];

/**
 * [read], shared by the builds that start within a minute ([now] tells the
 * time). A source change forgets it: a build, re-rank or harvest waiting on
 * the read under way gets the read after the change.
 */
export const createMixIndexesRead = <A, E, R>(
  read: Effect.Effect<A, E, R>,
  now: () => number = Date.now,
) => {
  const shared = sharedRead(read, { keepMs: 60_000, now });
  return {
    get: shared.get,
    change: (change: LibraryChange) => {
      if (SOURCES.includes(change.kind)) shared.forget();
    },
    dispose: shared.dispose,
  };
};
