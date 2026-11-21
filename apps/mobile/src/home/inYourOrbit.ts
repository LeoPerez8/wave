import type { PlayedArtist } from "@wave/client/db/playedEntities";
import { inYourOrbit, inYourOrbitWindow } from "@wave/core";
import * as Effect from "effect/Effect";
import { useMemo } from "react";

import { libraryQuery, useLibraryQuery } from "@/library/hooks";
import { LibraryStore } from "@/library/LibraryStore";
import { useLastDefined, useLocalDay } from "./useLocalDay";

const readInYourOrbit = (day: string) =>
  libraryQuery(
    `home:inYourOrbit:${day}`,
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
 * loads. Re-read as `useMostPlayedOfAllTime` is, and when the local day
 * changes, so the 14 days move on with nothing played.
 */
export const useInYourOrbit = (): readonly PlayedArtist[] | undefined => {
  const day = useLocalDay();
  const query = useMemo(() => readInYourOrbit(day), [day]);
  return useLastDefined(useLibraryQuery<readonly PlayedArtist[] | undefined>(query, undefined));
};
