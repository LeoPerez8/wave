/**
 * The sliders of a Home section's level card (docs/spec.md, "Artist mixes",
 * Magic Queue section): beside the new-music level (`DISCOVER_MIX_LEVELS`),
 * Genre faithfulness and Popularity tune Wave's engine (`recommend`) for the
 * section's mixes, or for every Magic Queue. Each is five steps, the middle
 * one the default, which ranks as the engine does without sliders. Core
 * says what each step does to the engine and how a section keeps them.
 */

import type { DiscoverMixLevel } from "./discoverMixLevels.ts";
import { GENRE_AFFINITY_THRESHOLD } from "./genreAffinity.ts";
import type { StyleLevel } from "./genreMixes.ts";
import { RECOMMEND_WEIGHTS, type RecommendOptions } from "./recommend.ts";
import { readStoredRecord } from "./storedJson.ts";

/** A slider's step, from its left end (1) to its right one (5): the new-music level's steps too. */
export type MixSliderStep = DiscoverMixLevel;

/** A section's two engine sliders. */
export interface MixSliders {
  /** From staying with the seed's genres (1) to wandering into neighbouring ones (5). */
  readonly faithfulness: MixSliderStep;
  /** From hits (1) to deep cuts (5). */
  readonly popularity: MixSliderStep;
}

/** Both in the middle: the engine as it ranks without sliders. */
export const DEFAULT_MIX_SLIDERS: MixSliders = { faithfulness: 3, popularity: 3 };

/**
 * Genre faithfulness's steps: the genre affinity a song's artist needs to
 * the seed's profile to match (`GENRE_AFFINITY_THRESHOLD` in the middle).
 * Staying close leaves out songs whose genres only half match; wandering
 * lets in those that share a minor genre. Same genres and Close compare the
 * styles instead (`styles`, `styleAffinity`): their threshold is then unused.
 */
export const GENRE_FAITHFULNESS_STEPS: readonly {
  readonly step: MixSliderStep;
  readonly label: string;
  readonly threshold: number;
  readonly styles?: StyleLevel;
}[] = [
  { step: 1, label: "Same genres", threshold: 0.8, styles: "same" },
  { step: 2, label: "Close", threshold: 0.65, styles: "close" },
  { step: 3, label: "Balanced", threshold: GENRE_AFFINITY_THRESHOLD },
  { step: 4, label: "Neighbours", threshold: 0.35 },
  { step: 5, label: "Wander", threshold: 0.2 },
];

/**
 * Popularity's steps: the engine's popularity weight (how many catalog
 * radios carry a song), neutral in the middle (`RECOMMEND_WEIGHTS`), for
 * hits towards the left and deep cuts (negative) towards the right.
 */
export const POPULARITY_STEPS: readonly {
  readonly step: MixSliderStep;
  readonly label: string;
  readonly weight: number;
}[] = [
  { step: 1, label: "Hits", weight: 1 },
  { step: 2, label: "Popular", weight: 0.5 },
  { step: 3, label: "Balanced", weight: RECOMMEND_WEIGHTS.popularity },
  { step: 4, label: "Lesser known", weight: -0.5 },
  { step: 5, label: "Deep cuts", weight: -1 },
];

const stepOf = <T extends { readonly step: MixSliderStep }>(steps: readonly T[], step: number): T =>
  steps.find((entry) => entry.step === step) ?? steps[2]!;

/**
 * What [sliders] tune in the engine: its affinity threshold, the style level
 * Same genres and Close compare at (`styles`), and its popularity weight.
 */
export const mixSlidersEngine = (
  sliders: MixSliders,
): Required<Pick<RecommendOptions, "threshold">> &
  Pick<RecommendOptions, "styles"> & {
    readonly weights: { readonly popularity: number };
  } => {
  const faithful = stepOf(GENRE_FAITHFULNESS_STEPS, sliders.faithfulness);
  return {
    threshold: faithful.threshold,
    ...(faithful.styles === undefined ? {} : { styles: faithful.styles }),
    weights: { popularity: stepOf(POPULARITY_STEPS, sliders.popularity).weight },
  };
};

/**
 * The style level Genre faithfulness compares at (`styleAffinity`): Same
 * genres and Close compare styles, the other steps compare families by
 * their threshold; null for those.
 */
export const faithfulnessStyles = (sliders: MixSliders): StyleLevel | null =>
  stepOf(GENRE_FAITHFULNESS_STEPS, sliders.faithfulness).styles ?? null;

/**
 * The genre affinity a Magic Queue's Library songs need to the seed's
 * profile at [sliders]' Genre faithfulness (`magicLibraryCandidates`): its
 * step's threshold, as for YouTube Music's candidates (not used at Same
 * genres and Close, which compare styles: `faithfulnessStyles`); null (any
 * genre) at the loosest step, Wander, where the Library keeps every genre as
 * it did before Library songs were held to the seed's genres.
 */
export const magicLibraryThreshold = (sliders: MixSliders): number | null => {
  const loosest = GENRE_FAITHFULNESS_STEPS[GENRE_FAITHFULNESS_STEPS.length - 1]!;
  const { step, threshold } = stepOf(GENRE_FAITHFULNESS_STEPS, sliders.faithfulness);
  return step === loosest.step ? null : threshold;
};

const readStep = (value: unknown): MixSliderStep | null =>
  value === 1 || value === 2 || value === 3 || value === 4 || value === 5 ? value : null;

/** A level card slider at [value] (where a drag left it) as the nearest of its five steps. */
export const sliderStep = (value: number): MixSliderStep =>
  readStep(Math.min(5, Math.max(1, Math.round(value)))) ?? DEFAULT_MIX_SLIDERS.faithfulness;

/** The label of the step of [steps] a slider at [value] is on ("Same genres", "Deep cuts"). */
export const sliderStepLabel = (
  steps: readonly { readonly step: MixSliderStep; readonly label: string }[],
  value: number,
): string => stepOf(steps, sliderStep(value)).label;

/** A section's sliders as kept on the phone ([stored], null for none): the middle for any that isn't a step. */
export const readMixSliders = (stored: string | null): MixSliders => {
  const { faithfulness, popularity } = readStoredRecord(stored);
  return {
    faithfulness: readStep(faithfulness) ?? DEFAULT_MIX_SLIDERS.faithfulness,
    popularity: readStep(popularity) ?? DEFAULT_MIX_SLIDERS.popularity,
  };
};

/** What to keep for [sliders]: null (nothing) at the defaults. */
export const storedMixSliders = (sliders: MixSliders): string | null =>
  sliders.faithfulness === DEFAULT_MIX_SLIDERS.faithfulness &&
  sliders.popularity === DEFAULT_MIX_SLIDERS.popularity
    ? null
    : JSON.stringify({ faithfulness: sliders.faithfulness, popularity: sliders.popularity });
