/**
 * What Artist mixes' seeds are picked from (docs/spec.md, "Artist mixes"):
 * the owner's most played artists and the Library's, as Core's
 * `ArtistMixPools` takes them. A build picks its seeds from them
 * (`artistMixSeeds`).
 */
import { mapSteps, type ArtistMixPools, type MixRefreshAvoid } from "@wave/core";
import * as Effect from "effect/Effect";
import { runSteps } from "@/lib/stepped";
import { recommendationTurnEffect } from "@/lib/recommendationWork";

import type { MixIndexes } from "./mixKnown";

/**
 * The pools of [library]'s artists and the owner's all-time most played
 * ones (similar artists not read yet), with a refresh's [avoid].
 */
export const artistMixPools = (
  library: Pick<MixIndexes, "artists" | "topArtists">,
  avoid?: MixRefreshAvoid,
) =>
  Effect.gen(function* () {
    const artists = yield* runSteps(
      mapSteps(library.artists, (artist) => ({ ...artist, songCount: artist.trackCount })),
      recommendationTurnEffect,
    );
    return {
      played: library.topArtists,
      library: artists,
      ...(avoid === undefined ? {} : { avoid }),
    } satisfies ArtistMixPools;
  });
