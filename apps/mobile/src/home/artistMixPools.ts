/**
 * What Artist mixes' seeds are picked from (docs/spec.md, "Artist mixes"):
 * the owner's most played artists and the Library's, as Core's
 * `ArtistMixPools` takes them. A build picks its seeds from them
 * (`artistMixSeeds`); the harvest reads every one it may pick
 * (`harvestSeedPool`).
 */
import type { ArtistMixPools, MixRefreshAvoid } from "@wave/core";
import * as Effect from "effect/Effect";

import { Stats } from "@/stats/Stats";

import type { MixIndexes } from "./mixKnown";

/** How many of the most played artists Artist mixes' seeds are picked from. */
const SEED_POOL = 20;

/**
 * The pools of [library]'s artists and the owner's all-time most played
 * ones (similar artists not read yet), with a refresh's [avoid].
 */
export const artistMixPools = (library: Pick<MixIndexes, "artists">, avoid?: MixRefreshAvoid) =>
  Effect.gen(function* () {
    const top = yield* (yield* Stats).topArtists("all", SEED_POOL);
    return {
      played: top.map(({ item, countedPlays }) => ({ id: item.id, name: item.name, countedPlays })),
      library: library.artists.map((artist) => ({ ...artist, songCount: artist.trackCount })),
      ...(avoid === undefined ? {} : { avoid }),
    } satisfies ArtistMixPools;
  });
