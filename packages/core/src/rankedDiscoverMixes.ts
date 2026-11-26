/** Both apps build Discover's rows from the same ranked, ordered radio pages. */
import { finishSteps } from "./buildSteps.ts";
import type { DiscoverLibrarySong, DiscoverMixSeed } from "./discoverMixes.ts";
import type { DiscoverMixPoolSources } from "./discoverMixLevels.ts";
import { discoverMixesOfRadiosSteps } from "./discoverMixRadios.ts";
import type { MixSliders } from "./mixSliders.ts";
import { rankedDiscoverMixRead } from "./radioMixes.ts";
import type { RadioRankingPage, RadioRankingSources } from "./radioRanking.ts";

export interface DiscoverSeedPages {
  readonly seed: DiscoverMixSeed;
  readonly pages: readonly RadioRankingPage[];
}

export const rankedDiscoverMixes = <L extends DiscoverLibrarySong>(
  reads: readonly DiscoverSeedPages[],
  sources: Pick<DiscoverMixPoolSources<L>, "known" | "library"> &
    Pick<RadioRankingSources, "taste" | "profileOf" | "popularityOf" | "disliked">,
  sliders: MixSliders,
  avoid?: ReadonlySet<string>,
) => finishSteps(rankedDiscoverMixesSteps(reads, sources, sliders, avoid));

export function* rankedDiscoverMixesSteps<L extends DiscoverLibrarySong>(
  reads: readonly DiscoverSeedPages[],
  sources: Pick<DiscoverMixPoolSources<L>, "known" | "library"> &
    Pick<RadioRankingSources, "taste" | "profileOf" | "popularityOf" | "disliked">,
  sliders: MixSliders,
  avoid?: ReadonlySet<string>,
) {
  const ranked = reads.flatMap(({ seed, pages }) =>
    pages.length === 0
      ? []
      : [
          rankedDiscoverMixRead(
            seed,
            { ...sources, pages },
            {
              ...sliders,
              ...(seed.kind === "artist"
                ? { profile: sources.profileOf?.(seed.name) ?? null }
                : {}),
            },
          ),
        ],
  );
  return yield* discoverMixesOfRadiosSteps(ranked, {
    known: sources.known,
    library: {
      ...sources.library,
      ...(sources.profileOf === undefined ? {} : { profileOf: sources.profileOf }),
    },
    ...(avoid === undefined ? {} : { avoid }),
  });
}
