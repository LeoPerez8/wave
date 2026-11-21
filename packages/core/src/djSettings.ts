/**
 * DJ's ranking choices (docs/spec.md, DJ): how far a DJ session strays from
 * the picked artists, how much of it is new, and its filters. They are DJ's
 * own: a session started from DJ carries them and ranks with them, whatever
 * Discover's sliders say.
 */
import { DEFAULT_MIX_SLIDERS, type MixSliders, type MixSliderStep } from "./mixSliders.ts";
import { isRecord } from "./storedJson.ts";

/** Artist variety: how far a batch may stray from the selected artists. */
export type DjVariety = "low" | "medium" | "high";

/** Music discovery: how much of the queue is new to the owner. */
export type DjDiscovery = "familiar" | "blend" | "discover";

/** The popularity filters: Trending, neither, or Lesser-known songs. */
export type DjPopularity = "trending" | "balanced" | "lesserKnown";

/** The choices a DJ session ranks with. */
export interface DjSettings {
  readonly variety: DjVariety;
  readonly discovery: DjDiscovery;
  readonly popularity: DjPopularity;
  /** Whether songs released in the last 12 months are favoured. */
  readonly newReleases: boolean;
}

/** DJ's choices before the owner adjusts any. */
export const DEFAULT_DJ_SETTINGS: DjSettings = {
  variety: "medium",
  discovery: "blend",
  popularity: "balanced",
  newReleases: false,
};

const VARIETIES: { readonly [K in DjVariety]: true } = { low: true, medium: true, high: true };

const NEW_MUSIC_SHARE: { readonly [K in DjDiscovery]: number } = {
  familiar: 0.2,
  blend: 0.6,
  discover: 1,
};

/** The New music share a DJ session starts at; signals then move it as in any session. */
export const djNewMusicShare = (settings: DjSettings): number =>
  NEW_MUSIC_SHARE[settings.discovery];

const POPULARITY_STEP: { readonly [K in DjPopularity]: MixSliderStep } = {
  trending: 1,
  balanced: DEFAULT_MIX_SLIDERS.popularity,
  lesserKnown: 5,
};

/**
 * The shared radio ranking's sliders for a DJ session: Popularity where its
 * filter puts it, Genre faithfulness at its middle step (DJ doesn't offer it).
 */
export const djMixSliders = (settings: DjSettings): MixSliders => ({
  faithfulness: DEFAULT_MIX_SLIDERS.faithfulness,
  popularity: POPULARITY_STEP[settings.popularity],
});

const oneOf = <T extends string>(
  value: unknown,
  choices: { readonly [K in T]: unknown },
  fallback: T,
): T => (typeof value === "string" && Object.hasOwn(choices, value) ? (value as T) : fallback);

/** DJ's choices as saved ([value], `JSON.parse` of them): the default for any that isn't one. */
export const parseDjSettings = (value: unknown): DjSettings => {
  const saved = isRecord(value) ? value : {};
  return {
    variety: oneOf(saved["variety"], VARIETIES, DEFAULT_DJ_SETTINGS.variety),
    discovery: oneOf(saved["discovery"], NEW_MUSIC_SHARE, DEFAULT_DJ_SETTINGS.discovery),
    popularity: oneOf(saved["popularity"], POPULARITY_STEP, DEFAULT_DJ_SETTINGS.popularity),
    newReleases: saved["newReleases"] === true,
  };
};
