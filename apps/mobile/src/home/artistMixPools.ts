/**
 * What Artist mixes' seeds are picked from (docs/spec.md, "Artist mixes"):
 * the owner's most played artists and the Library's, as Core's
 * `ArtistMixPools` takes them. A build picks its seeds from them
 * (`artistMixSeeds`); the harvest reads every one it may pick
 * (`harvestSeedPool`).
 */
import type { ArtistMixPools, MixRefreshAvoid } from "@wave/core";
import * as Effect from "effect/Effect";

import type { MixIndexes } from "./mixKnown";

/**
 * The pools of [library]'s artists and the owner's all-time most played
 * ones (similar artists not read yet), with a refresh's [avoid].
 */
export const artistMixPools = (
  library: Pick<MixIndexes, "artists" | "topArtists">,
  avoid?: MixRefreshAvoid,
) =>
  Effect.sync(() => {
    return {
      played: library.topArtists,
      library: library.artists.map((artist) => ({ ...artist, songCount: artist.trackCount })),
      ...(avoid === undefined ? {} : { avoid }),
    } satisfies ArtistMixPools;
  });
