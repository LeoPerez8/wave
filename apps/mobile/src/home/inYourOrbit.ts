import type { PlayedArtist } from "@wave/client/db/playedEntities";
import { inYourOrbit, inYourOrbitWindow } from "@wave/core";
import * as Effect from "effect/Effect";

import { libraryQuery, useLibraryQuery } from "@/library/hooks";
import { LibraryStore } from "@/library/LibraryStore";

const readInYourOrbit = libraryQuery(
  "home:inYourOrbit",
  { tracks: true, plays: true },
  // oxlint-disable-next-line react/rules-of-hooks -- Effect Service.use resolves a service; it is not a React Hook.
  LibraryStore.use((store) =>
    Effect.map(
      Effect.suspend(() => store.playedArtistTotals(inYourOrbitWindow(Date.now()))),
      (totals): readonly PlayedArtist[] => inYourOrbit(totals).map(({ item }) => item),
    ),
  ),
);

/**
 * Home's In your orbit: the artists played most in the last 14 days (Core's
 * `inYourOrbit`), credited as Stats credits them, or undefined while it first
 * loads. Re-read as `useMostPlayedOfAllTime` is.
 */
export const useInYourOrbit = (): readonly PlayedArtist[] | undefined =>
  useLibraryQuery<readonly PlayedArtist[] | undefined>(readInYourOrbit, undefined);
