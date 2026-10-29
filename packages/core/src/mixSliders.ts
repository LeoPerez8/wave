import { en } from "./catalogueEn.ts";
/**
 * The sliders of a Home section's level card (docs/spec.md, "Artist mixes",
 * Magic Queue section): beside the new-music level (`DISCOVER_MIX_LEVELS`),
 * Genre faithfulness and Popularity tune the shared radio ranking for the
 * section's mixes, or for every Magic Queue. Each is five steps, the middle
 * one the default, which ranks as the engine does without sliders. Core
 * says what each step does to the engine and how a section keeps them.
 */

import type { DiscoverMixLevel } from "./discoverMixLevels.ts";
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

/** Genre faithfulness penalizes known incompatible genres; unknown genre stays neutral. */
export const GENRE_FAITHFULNESS_STEPS: readonly {
  readonly step: MixSliderStep;
  readonly label: string;
}[] = ([1, 2, 3, 4, 5] as const).map((step) => ({
  step,
  label: en.discover.faithfulnessSteps[step],
}));

/** Popularity shifts the ranking from hits to deep cuts. */
export const POPULARITY_STEPS: readonly { readonly step: MixSliderStep; readonly label: string }[] =
  ([1, 2, 3, 4, 5] as const).map((step) => ({ step, label: en.discover.popularitySteps[step] }));

const stepOf = <T extends { readonly step: MixSliderStep }>(steps: readonly T[], step: number): T =>
  steps.find((entry) => entry.step === step) ?? steps[2]!;

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
