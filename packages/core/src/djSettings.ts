/**
 * DJ's ranking choices (docs/spec.md, DJ): how far a DJ session strays from
 * the picked artists, how much of it is new, and its filters. They are DJ's
 * own: a session started from DJ carries them and ranks with them, whatever
 * Discover's sliders say.
 */
import { en, type Catalogue } from "./catalogueEn.ts";
import { DEFAULT_MIX_SLIDERS, type MixSliders, type MixSliderStep } from "./mixSliders.ts";
import { isRecord } from "./storedJson.ts";

/** Artist variety: how far a batch may stray from the selected artists. */
export type DjVariety = "low" | "medium" | "high";

/** Music discovery: how much of the queue is new to the owner. */
export type DjDiscovery = "familiar" | "blend" | "discover";

/** The popularity filters: Trending, neither, or Lesser-known songs. */
export type DjPopularity = "trending" | "balanced" | "lesserKnown";

/** A sound profile; a session with none leaves the radio order alone. */
export type DjMood = "energetic" | "relaxing" | "upbeat";

/** The choices a DJ session ranks with. */
export interface DjSettings {
  readonly variety: DjVariety;
  readonly discovery: DjDiscovery;
  readonly popularity: DjPopularity;
  /**
   * Whether songs on a recent release are favoured: one whose year is the
   * current or the previous one (`djNewReleasesRanked`; saved artist pages
   * give a year and no date).
   */
  readonly newReleases: boolean;
  /**
   * The sound profiles a batch takes turns among, each once, in the order
   * they were picked; none leaves the radio order alone. Saved as
   * `storedDjSettings` says.
   */
  readonly mood: readonly DjMood[];
}

/** DJ's choices before the owner adjusts any. */
export const DEFAULT_DJ_SETTINGS: DjSettings = {
  variety: "medium",
  discovery: "blend",
  popularity: "balanced",
  newReleases: false,
  mood: [],
};

const VARIETIES: { readonly [K in DjVariety]: true } = { low: true, medium: true, high: true };
const MOODS: { readonly [K in DjMood]: true } = {
  energetic: true,
  relaxing: true,
  upbeat: true,
};

/** Mood chips in the order Adjust shows them. */
export const DJ_MOOD_FILTERS: readonly DjMood[] = ["energetic", "relaxing", "upbeat"];

/** Artist variety's steps as Adjust offers them, from its left end to its right one. */
export const DJ_VARIETIES: readonly DjVariety[] = ["low", "medium", "high"];

/** Music discovery's steps as Adjust offers them, from its left end to its right one. */
export const DJ_DISCOVERIES: readonly DjDiscovery[] = ["familiar", "blend", "discover"];

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

/** A filter of Adjust: a chip that is on or off. */
export type DjFilter = "trending" | "lesserKnown" | "newReleases";

/** Adjust's filters, in the order their chips stand. */
export const DJ_FILTERS: readonly DjFilter[] = ["trending", "lesserKnown", "newReleases"];

/** Whether [filter] is on in [settings]. */
export const djFilterOn = (settings: DjSettings, filter: DjFilter): boolean =>
  filter === "newReleases" ? settings.newReleases : settings.popularity === filter;

/**
 * [settings] after a tap on [filter]'s chip. Trending and Lesser-known songs
 * are the two ends of one choice, so turning one on turns the other off and
 * a tap on the one that's on leaves popularity balanced. New releases turns
 * on and off by itself.
 */
export const djToggleFilter = (settings: DjSettings, filter: DjFilter): DjSettings =>
  filter === "newReleases"
    ? { ...settings, newReleases: !settings.newReleases }
    : { ...settings, popularity: settings.popularity === filter ? "balanced" : filter };

/**
 * A tap turns [mood] on, after the moods already on, or off, leaving the
 * others as they are. Any moods may be on together, opposites included.
 */
export const djToggleMood = (settings: DjSettings, mood: DjMood): DjSettings => ({
  ...settings,
  mood: settings.mood.includes(mood)
    ? settings.mood.filter((each) => each !== mood)
    : [...settings.mood, mood],
});

const isMood = (value: unknown): value is DjMood =>
  typeof value === "string" && Object.hasOwn(MOODS, value);

/**
 * The saved moods: `moods` when it's a list (`storedDjSettings`), else
 * `mood`, one mood as older builds saved it or a list.
 */
const savedMoods = (saved: Readonly<Record<string, unknown>>): readonly DjMood[] => {
  const moods = saved["moods"];
  const mood = saved["mood"];
  const listed = Array.isArray(moods) ? moods : Array.isArray(mood) ? mood : [mood];
  return [...new Set(listed.filter(isMood))];
};

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
    mood: savedMoods(saved),
  };
};

/**
 * [settings] as they're saved, the JSON `parseDjSettings` reads. `mood`
 * holds the first mood picked, or null, as an older build reads it (one
 * mood at most), and `moods` the whole list when there are several. So an
 * older build keeps the first of them.
 */
export const storedDjSettingsRecord = (settings: DjSettings): Readonly<Record<string, unknown>> => {
  const { mood, ...rest } = settings;
  return { ...rest, mood: mood[0] ?? null, ...(mood.length > 1 ? { moods: mood } : {}) };
};

/** `storedDjSettingsRecord` as JSON. */
export const storedDjSettings = (settings: DjSettings): string =>
  JSON.stringify(storedDjSettingsRecord(settings));

/**
 * The line DJ's bottom bar sums Adjust up in: the Artist variety and Music
 * discovery steps, then each filter that's on in Adjust's order, then the
 * moods that are on in the order they were picked ("Medium variety · Blend ·
 * Trending · Energetic + Relaxing").
 */
export const djSettingsSummary = (settings: DjSettings, strings: Catalogue = en): string =>
  [
    strings.dj.varietySummary[settings.variety],
    strings.dj.discoverySteps[settings.discovery],
    ...DJ_FILTERS.filter((filter) => djFilterOn(settings, filter)).map(
      (filter) => strings.dj.filterNames[filter],
    ),
    ...(settings.mood.length === 0
      ? []
      : [settings.mood.map((mood) => strings.dj.moodNames[mood]).join(strings.dj.moodsJoiner)]),
  ].join(" · ");
