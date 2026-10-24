/** All a row's artist radios start together; each mix keeps its own ordered pages. */
import { mixSeedArtists, type DiscoverMixSeed, type RadioRankingPage } from "@wave/core";
import * as Effect from "effect/Effect";
import type { SongRadioPage } from "../playback/songRadioSession.ts";
import { artistRadioCacheId } from "./cachedArtistRadio.ts";

type Artist = Pick<DiscoverMixSeed, "name" | "browseId">;

export const readMixRadios = <E, R>(
  seeds: readonly DiscoverMixSeed[],
  read: (artist: Artist) => Effect.Effect<SongRadioPage | null, E, R>,
): Effect.Effect<RadioRankingPage[][], never, R> =>
  Effect.forEach(
    seeds,
    (seed) =>
      Effect.forEach(
        mixSeedArtists(seed),
        (artist) =>
          read(artist).pipe(
            Effect.orElseSucceed(() => null),
            Effect.map((page) =>
              page === null
                ? []
                : [
                    {
                      id: artistRadioCacheId(artist.name),
                      artists: [artist.name],
                      songs: page.songs,
                    },
                  ],
            ),
          ),
        { concurrency: "unbounded" },
      ).pipe(Effect.map((pages) => pages.flat())),
    { concurrency: "unbounded" },
  );
