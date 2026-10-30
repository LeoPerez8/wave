/**
 * Theme colours chosen in Settings: a background for each scheme, a primary
 * (accent) and a secondary (highlight), each from preset swatches. Every other
 * colour is derived from the background so contrast and spacing hold.
 */

import { en, type Catalogue } from "./catalogueEn.ts";
import { readStoredRecord } from "./storedJson.ts";
import { luminance, mix, parseHexColour, toOklch, withLuminance } from "./colour.ts";
import { contrastRatio } from "./palette.ts";
import {
  CONTRAST_REQUIREMENTS,
  DEFAULT_THEME,
  NIGHT_SLATE,
  type Theme,
  type ThemeColors,
} from "./theme.ts";

export type Scheme = "light" | "dark";

/** A background preset. */
export interface BackgroundSwatch {
  readonly id: string;
  readonly label: string;
  readonly colour: string;
}

/** A primary or secondary preset, with a tone for each scheme. */
export interface InkSwatch {
  readonly id: string;
  readonly label: string;
  readonly light: string;
  readonly dark: string;
}

/** The id of the Default swatch that leads Primary and Secondary: white in dark mode. */
export const WHITE_INK = "white";

/**
 * The Default swatch of Primary and Secondary. Its light tone is the text
 * colour of the light ground it sits on (this hex is fog's), so it reads.
 */
const DEFAULT_INK: InkSwatch = {
  id: WHITE_INK,
  label: en.settings.swatches.white,
  light: DEFAULT_THEME.light.foreground,
  dark: "#ffffff",
};

/**
 * The presets of each group; the first of each is the shipped theme. Primary
 * and Secondary offer only Default; saved and custom colours do the rest.
 */
export const THEME_SWATCHES: {
  readonly light: readonly BackgroundSwatch[];
  readonly dark: readonly BackgroundSwatch[];
  readonly primary: readonly InkSwatch[];
  readonly secondary: readonly InkSwatch[];
} = {
  light: [
    { id: "fog", label: en.settings.swatches.fog, colour: DEFAULT_THEME.light.background },
    { id: "sand", label: en.settings.swatches.sand, colour: "#ede6da" },
    { id: "sage", label: en.settings.swatches.sage, colour: "#e1eadc" },
    { id: "blush", label: en.settings.swatches.blush, colour: "#f1e3e3" },
    { id: "lilac", label: en.settings.swatches.lilac, colour: "#e6e3f1" },
    { id: "paper", label: en.settings.swatches.paper, colour: "#f5f5f3" },
  ],
  dark: [
    { id: "black", label: en.settings.swatches.black, colour: DEFAULT_THEME.dark.background },
    { id: "slate", label: en.settings.swatches.slate, colour: NIGHT_SLATE.background },
    { id: "graphite", label: en.settings.swatches.graphite, colour: "#141414" },
    { id: "navy", label: en.settings.swatches.navy, colour: "#0a0f1f" },
    { id: "forest", label: en.settings.swatches.forest, colour: "#0a130d" },
    { id: "plum", label: en.settings.swatches.plum, colour: "#140c17" },
  ],
  primary: [DEFAULT_INK],
  secondary: [DEFAULT_INK],
};

/**
 * The primary and secondary presets Settings offered before saved colours
 * (#794). A stored choice of one reads as its dark tone, custom and saved;
 * the icon palette keeps their inks in place.
 */
export const FORMER_INK_SWATCHES: {
  readonly primary: readonly InkSwatch[];
  readonly secondary: readonly InkSwatch[];
} = {
  primary: [
    {
      id: "teal",
      label: en.settings.swatches.teal,
      light: DEFAULT_THEME.light.accent,
      dark: DEFAULT_THEME.dark.accent,
    },
    { id: "blue", label: en.settings.swatches.blue, light: "#1f5fb8", dark: "#7aaef5" },
    { id: "violet", label: en.settings.swatches.violet, light: "#5b4bb7", dark: "#a99af0" },
    { id: "green", label: en.settings.swatches.green, light: "#2f6b1f", dark: "#8fcf6e" },
    { id: "rose", label: en.settings.swatches.rose, light: "#a8325e", dark: "#f08cb0" },
    { id: "lime", label: en.settings.swatches.lime, light: "#8cc63f", dark: "#b5e36b" },
  ],
  secondary: [
    {
      id: "ember",
      label: en.settings.swatches.ember,
      light: DEFAULT_THEME.light.highlight,
      dark: DEFAULT_THEME.dark.highlight,
    },
    { id: "gold", label: en.settings.swatches.gold, light: "#866600", dark: "#e8c454" },
    { id: "coral", label: en.settings.swatches.coral, light: "#b2402c", dark: "#f5917e" },
    { id: "magenta", label: en.settings.swatches.magenta, light: "#9c2d8a", dark: "#e78fd6" },
    { id: "sky", label: en.settings.swatches.sky, light: "#1b6a93", dark: "#7cc4ea" },
    { id: "lemon", label: en.settings.swatches.lemon, light: "#f2d22e", dark: "#f5d742" },
  ],
};

/** A row of Settings › Theme. */
export type ThemeGroup = "light" | "dark" | "primary" | "secondary";

/** The rows that also take a custom colour. */
export type InkGroup = "primary" | "secondary";

/** The id a primary or secondary takes while its custom colour applies. */
export const CUSTOM_INK = "custom";

/**
 * The chosen swatch id of each group, the custom primary and secondary
 * (`#rrggbb`, or null when none was picked), and each group's saved colours.
 * A custom colour is kept while Default or a saved colour is chosen, so its
 * swatch can be picked again. A saved colour applies as the custom colour,
 * which a Wave from before saved colours shows too, and the custom swatch's
 * own colour then waits in `unsavedPrimary` or `unsavedSecondary`.
 */
export interface ThemeChoice {
  readonly light: string;
  readonly dark: string;
  /** `WHITE_INK` (Default), or `CUSTOM_INK` for `customPrimary`. */
  readonly primary: string;
  /** `WHITE_INK` (Default), or `CUSTOM_INK` for `customSecondary`. */
  readonly secondary: string;
  readonly customPrimary: string | null;
  readonly customSecondary: string | null;
  /** Up to `MAX_SAVED_INKS` primaries, `#rrggbb`, in the order saved. */
  readonly savedPrimary: readonly string[];
  /** Up to `MAX_SAVED_INKS` secondaries, `#rrggbb`, in the order saved. */
  readonly savedSecondary: readonly string[];
  /**
   * The custom primary that isn't saved, kept for the custom swatch while a
   * saved colour applies (`customPrimary` holds that one); null otherwise.
   */
  readonly unsavedPrimary: string | null;
  /** As `unsavedPrimary`, for the secondary. */
  readonly unsavedSecondary: string | null;
}

/** How many colours Primary and Secondary each keep. */
export const MAX_SAVED_INKS = 4;

const GROUPS: readonly ThemeGroup[] = ["light", "dark", "primary", "secondary"];

/** Where each ink group keeps its custom colour. */
const CUSTOM_FIELD = { primary: "customPrimary", secondary: "customSecondary" } as const;

/** Where each ink group keeps its saved colours. */
const SAVED_FIELD = { primary: "savedPrimary", secondary: "savedSecondary" } as const;

/** Where each ink group keeps its custom colour while a saved one applies. */
const UNSAVED_FIELD = { primary: "unsavedPrimary", secondary: "unsavedSecondary" } as const;

const defaultId = (group: ThemeGroup): string => THEME_SWATCHES[group][0]?.id ?? "";

export const DEFAULT_THEME_CHOICE: ThemeChoice = {
  light: defaultId("light"),
  dark: defaultId("dark"),
  primary: defaultId("primary"),
  secondary: defaultId("secondary"),
  customPrimary: null,
  customSecondary: null,
  savedPrimary: [],
  savedSecondary: [],
  unsavedPrimary: null,
  unsavedSecondary: null,
};

const has = (group: ThemeGroup, id: unknown): id is string =>
  THEME_SWATCHES[group].some((swatch) => swatch.id === id);

const isInk = (group: ThemeGroup): group is InkGroup =>
  group === "primary" || group === "secondary";

/** A stored colour as `#rrggbb`, or null when it isn't one. */
const storedHex = (value: unknown): string | null =>
  typeof value === "string" ? parseHexColour(value) : null;

/** Each colour once, in order, at most `MAX_SAVED_INKS`. */
const savedList = (colours: readonly (string | null)[]): readonly string[] =>
  [...new Set(colours.filter((colour) => colour !== null))].slice(0, MAX_SAVED_INKS);

/**
 * `choice` keeping `unsaved` as the group's unsaved colour where it has a
 * place: a saved colour other than it applies, and it isn't saved itself.
 */
const withUnsaved = (choice: ThemeChoice, group: InkGroup, unsaved: string | null): ThemeChoice => {
  const custom = choice[CUSTOM_FIELD[group]];
  const saved = choice[SAVED_FIELD[group]];
  const kept =
    unsaved !== null &&
    choice[group] === CUSTOM_INK &&
    custom !== null &&
    custom !== unsaved &&
    saved.includes(custom) &&
    !saved.includes(unsaved);
  return { ...choice, [UNSAVED_FIELD[group]]: kept ? unsaved : null };
};

/** The colour the group's custom swatch holds, or null with none picked. */
const customSwatchColour = (choice: ThemeChoice, group: InkGroup): string | null =>
  choice[UNSAVED_FIELD[group]] ?? choice[CUSTOM_FIELD[group]];

/** The group's saved colours as `record` stores them; null when it has no list. */
const storedSaved = (
  record: Readonly<Record<string, unknown>>,
  group: InkGroup,
): readonly (string | null)[] | null => {
  const listed = record[SAVED_FIELD[group]];
  return Array.isArray(listed) ? listed.map(storedHex) : null;
};

/**
 * The theme choice from a stored record, each group's saved colours from
 * `saved` (given the custom colour a former preset kept, else null). A former
 * preset (`FORMER_INK_SWATCHES`) reads as its dark tone, custom and saved first.
 */
const readRecord = (
  record: Readonly<Record<string, unknown>>,
  saved: (group: InkGroup, kept: string | null) => readonly (string | null)[],
): ThemeChoice => {
  const read = (group: InkGroup) => {
    const kept = storedHex(record[CUSTOM_FIELD[group]]);
    const former = FORMER_INK_SWATCHES[group].find((swatch) => swatch.id === record[group]);
    if (former !== undefined)
      return {
        id: CUSTOM_INK,
        custom: former.dark,
        saved: savedList([former.dark, ...saved(group, kept)]),
      };
    const id = record[group];
    const custom = id === CUSTOM_INK && kept !== null;
    return {
      id: custom ? CUSTOM_INK : has(group, id) ? id : DEFAULT_THEME_CHOICE[group],
      custom: kept,
      saved: savedList(saved(group, null)),
    };
  };
  const background = (group: "light" | "dark"): string => {
    const id = record[group];
    return has(group, id) ? id : DEFAULT_THEME_CHOICE[group];
  };
  const primary = read("primary");
  const secondary = read("secondary");
  const choice: ThemeChoice = {
    light: background("light"),
    dark: background("dark"),
    primary: primary.id,
    secondary: secondary.id,
    customPrimary: primary.custom,
    customSecondary: secondary.custom,
    savedPrimary: primary.saved,
    savedSecondary: secondary.saved,
    unsavedPrimary: null,
    unsavedSecondary: null,
  };
  return withUnsaved(
    withUnsaved(choice, "primary", storedHex(record[UNSAVED_FIELD.primary])),
    "secondary",
    storedHex(record[UNSAVED_FIELD.secondary]),
  );
};

/**
 * The theme choice from its stored JSON; anything missing or unknown is its
 * default. A former preset (`FORMER_INK_SWATCHES`) reads as its dark tone,
 * custom and first saved, ahead of the custom colour it kept, so nothing on
 * screen changes and the colour can be picked again.
 */
export const readThemeChoice = (stored: string | null): ThemeChoice => {
  const record = readStoredRecord(stored);
  return readRecord(record, (group, kept) => [kept, ...(storedSaved(record, group) ?? [])]);
};

/**
 * A theme choice pulled from the Wave account, read over this phone's
 * `current` one. A Wave from before saved colours pushes none: where the
 * pulled record has no saved list, the group keeps this phone's, after a
 * former preset's colour as on an update, rather than losing them.
 */
export const pulledThemeChoice = (stored: string | null, current: ThemeChoice): ThemeChoice => {
  const record = readStoredRecord(stored);
  return readRecord(record, (group, kept) => {
    const saved = storedSaved(record, group);
    return saved === null ? current[SAVED_FIELD[group]] : [kept, ...saved];
  });
};

/** What this phone holds when Wave starts, for `storedThemeOnStart`. */
export interface StartingThemeState {
  /** The stored theme choice (`settings.theme`); null when none was ever stored. */
  readonly storedTheme: string | null;
  /** The stored launcher icon's id; null until this Wave first applied a theme. */
  readonly storedIcon: string | null;
  /** Whether an earlier Wave saved a launch theme natively, as it did on every start. */
  readonly launchThemeSaved: boolean;
}

/**
 * The theme to store before the first read, or null to leave it. Teal over
 * Ember was the default before white, and an install from then with nothing
 * stored shows it: it keeps it, stored as those former presets read now
 * (custom and saved), while a fresh install starts on white. Once this Wave
 * has stored the icon, nothing stored means white was kept.
 */
export const storedThemeOnStart = ({
  storedTheme,
  storedIcon,
  launchThemeSaved,
}: StartingThemeState): string | null =>
  storedTheme === null && storedIcon === null && launchThemeSaved
    ? JSON.stringify(
        readThemeChoice(
          JSON.stringify({ ...DEFAULT_THEME_CHOICE, primary: "teal", secondary: "ember" }),
        ),
      )
    : null;

/**
 * Whether `choice` is the shipped theme with no custom colour kept (nothing to
 * reset). Saved colours don't count: Reset keeps them.
 */
export const isDefaultThemeChoice = (choice: ThemeChoice): boolean =>
  GROUPS.every((group) => choice[group] === DEFAULT_THEME_CHOICE[group]) &&
  choice.customPrimary === null &&
  choice.customSecondary === null &&
  choice.unsavedPrimary === null &&
  choice.unsavedSecondary === null;

/** The shipped theme with `choice`'s saved colours (Reset to defaults). */
export const resetThemeChoice = (choice: ThemeChoice): ThemeChoice => ({
  ...DEFAULT_THEME_CHOICE,
  savedPrimary: choice.savedPrimary,
  savedSecondary: choice.savedSecondary,
});

const sameList = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((entry, index) => entry === b[index]);

/** Whether two choices pick and keep the same swatches and colours and save the same colours, in order. */
export const sameThemeChoice = (a: ThemeChoice, b: ThemeChoice): boolean =>
  GROUPS.every((group) => a[group] === b[group]) &&
  a.customPrimary === b.customPrimary &&
  a.customSecondary === b.customSecondary &&
  a.unsavedPrimary === b.unsavedPrimary &&
  a.unsavedSecondary === b.unsavedSecondary &&
  sameList(a.savedPrimary, b.savedPrimary) &&
  sameList(a.savedSecondary, b.savedSecondary);

/**
 * How close two colours look, in OKLCH. Hue counts in full; lightness and
 * chroma count for half. Used by the launcher and splash ink palette.
 */
export const inkDistance = (a: string, b: string): number => {
  const [x, y] = [toOklch(a), toOklch(b)];
  const hue = 2 * Math.sqrt(x.c * y.c) * Math.sin((x.h - y.h) / 2);
  return Math.hypot(0.5 * (x.l - y.l), 0.5 * (x.c - y.c), hue);
};

const background = (scheme: Scheme, id: string): string =>
  THEME_SWATCHES[scheme].find((swatch) => swatch.id === id)?.colour ??
  DEFAULT_THEME[scheme].background;

/** The token each ink group colours. */
const INK_TOKEN = { primary: "accent", secondary: "highlight" } as const satisfies Record<
  InkGroup,
  keyof ThemeColors
>;

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

/** A former preset's light tone, by its dark tone (the colour it reads as now). */
const FORMER_LIGHT_TONE: ReadonlyMap<string, string> = new Map(
  [...FORMER_INK_SWATCHES.primary, ...FORMER_INK_SWATCHES.secondary].map((swatch) => [
    swatch.dark,
    swatch.light,
  ]),
);

/**
 * The ink a group asks for before readability: its custom colour (a former
 * preset's colour keeps that preset's light tone), or its swatch's tone for
 * `scheme`; null for the Default swatch in light mode, which takes the
 * ground's text colour.
 */
const ink = (choice: ThemeChoice, group: InkGroup, scheme: Scheme): string | null => {
  const custom = choice[CUSTOM_FIELD[group]];
  if (choice[group] === CUSTOM_INK && custom !== null)
    return scheme === "light" ? (FORMER_LIGHT_TONE.get(custom) ?? custom) : custom;
  if (choice[group] === WHITE_INK && scheme === "light") return null;
  const swatch =
    THEME_SWATCHES[group].find((candidate) => candidate.id === choice[group]) ??
    THEME_SWATCHES[group][0];
  return swatch?.[scheme] ?? DEFAULT_THEME[scheme][INK_TOKEN[group]];
};

/** The neutral tokens, laid out from the background. */
const NEUTRALS = [
  "grouped",
  "surface",
  "fill",
  "separator",
  "foreground",
  "secondary",
  "tertiary",
] as const;

/** Text-like neutrals keep at most this chroma, so a strongly tinted ground doesn't tint the text. */
const MAX_NEUTRAL_CHROMA = 0.05;

/**
 * The hand-tuned schemes of each mode. The last is the reference the other
 * grounds are derived from: fog in light, Night Slate in dark (true black has
 * no hue to carry over to a tinted ground).
 */
const TUNED: Record<Scheme, readonly ThemeColors[]> = {
  light: [DEFAULT_THEME.light],
  dark: [DEFAULT_THEME.dark, NIGHT_SLATE],
};

/**
 * A hand-tuned scheme on `ground` if there is one; otherwise each neutral
 * keeps the contrast it has against the reference ground, on the same side
 * (lighter or darker), in the new ground's hue. Contrast rather than fixed
 * lightness steps, so cards stand off a very dark ground as well as a pale one.
 */
const deriveNeutrals = (scheme: Scheme, ground: string): Mutable<ThemeColors> => {
  const tuned = TUNED[scheme].find((colours) => colours.background === ground.toLowerCase());
  if (tuned !== undefined) return { ...tuned };
  const base = TUNED[scheme].at(-1) ?? DEFAULT_THEME[scheme];
  const groundY = luminance(ground);
  const groundTone = toOklch(ground);
  const baseTone = toOklch(base.background);
  const result: Mutable<ThemeColors> = { ...base, background: ground };
  for (const token of NEUTRALS) {
    const reference = base[token];
    if (reference === base.background) {
      result[token] = ground;
      continue;
    }
    const ratio = contrastRatio(reference, base.background);
    const lighter = luminance(reference) > luminance(base.background);
    const target = lighter ? ratio * (groundY + 0.05) - 0.05 : (groundY + 0.05) / ratio - 0.05;
    const chromaShare = baseTone.c === 0 ? 1 : toOklch(reference).c / baseTone.c;
    const chroma = Math.min(MAX_NEUTRAL_CHROMA, groundTone.c * chromaShare);
    result[token] = withLuminance(target, groundTone.h, chroma);
  }
  return result;
};

const BLACK = "#000000";
const WHITE = "#ffffff";

/** How finely an ink is pushed toward black or white until it reads. */
const READABLE_STEPS = 40;

/** `colour`, moved the least way toward black (light) or white (dark) that meets `minimum` on every ground. */
const readable = (
  colour: string,
  grounds: readonly string[],
  minimum: number,
  scheme: Scheme,
): string => {
  const extreme = scheme === "light" ? BLACK : WHITE;
  for (let step = 0; step <= READABLE_STEPS; step++) {
    const candidate = mix(colour, extreme, step / READABLE_STEPS);
    if (grounds.every((ground) => contrastRatio(candidate, ground) >= minimum)) return candidate;
  }
  return extreme;
};

/** One scheme's colours for a background, primary and secondary (null: the text colour). */
const deriveScheme = (
  scheme: Scheme,
  ground: string,
  accent: string | null,
  highlight: string | null,
): ThemeColors => {
  const neutrals = deriveNeutrals(scheme, ground);
  const colours: Mutable<ThemeColors> = {
    ...neutrals,
    accent: accent ?? neutrals.foreground,
    highlight: highlight ?? neutrals.foreground,
    destructive: DEFAULT_THEME[scheme].destructive,
  };
  for (const { ink: token, on, minimum } of CONTRAST_REQUIREMENTS) {
    if (token === "on-accent") continue;
    colours[token] = readable(
      colours[token],
      on.map((under) => colours[under]),
      minimum,
      scheme,
    );
  }
  // Text on an accent fill is the lightest ground (light) or the ground itself (dark).
  colours["on-accent"] = scheme === "light" ? colours.surface : colours.background;
  // The dialog veil darkens: with the text colour in light mode, the ground in dark.
  colours.scrim = scheme === "light" ? colours.foreground : colours.background;
  return colours;
};

/** The full theme for a choice: both schemes, everything derived and readable. */
export const themeFor = (choice: ThemeChoice): Theme => {
  const scheme = (name: Scheme): ThemeColors =>
    deriveScheme(
      name,
      background(name, choice[name]),
      ink(choice, "primary", name),
      ink(choice, "secondary", name),
    );
  return { light: scheme("light"), dark: scheme("dark") };
};

const markOn = (colour: string): string =>
  contrastRatio(BLACK, colour) >= contrastRatio(WHITE, colour) ? BLACK : WHITE;

/**
 * `choice` with `hex` (`#rrggbb` or `#rgb`, as `parseHexColour` reads it) as
 * the group's custom colour, chosen (Done in the picker): it replaces the
 * custom swatch's colour. Unchanged when `hex` isn't a colour.
 */
export const chooseCustomInk = (choice: ThemeChoice, group: InkGroup, hex: string): ThemeChoice => {
  const colour = parseHexColour(hex);
  if (colour === null) return choice;
  return {
    ...choice,
    [group]: CUSTOM_INK,
    [CUSTOM_FIELD[group]]: colour,
    [UNSAVED_FIELD[group]]: null,
  };
};

/**
 * `choice` with the saved colour `hex` chosen (a tap on its swatch). The
 * custom swatch keeps its colour, as it does when Default is chosen. A colour
 * that isn't saved applies as `chooseCustomInk` would.
 */
export const chooseSavedInk = (choice: ThemeChoice, group: InkGroup, hex: string): ThemeChoice => {
  const colour = parseHexColour(hex);
  if (colour === null || !choice[SAVED_FIELD[group]].includes(colour))
    return chooseCustomInk(choice, group, hex);
  const custom = customSwatchColour(choice, group);
  return withUnsaved(chooseCustomInk(choice, group, colour), group, custom);
};

/**
 * `choice` with the swatch `id` chosen for `group` (an unknown id lands on
 * the default). Default keeps the custom swatch's colour, so it can be
 * picked again.
 */
export const chooseThemeSwatch = (
  choice: ThemeChoice,
  group: ThemeGroup,
  id: string,
): ThemeChoice => {
  const kept = isInk(group)
    ? {
        [CUSTOM_FIELD[group]]: customSwatchColour(choice, group),
        [UNSAVED_FIELD[group]]: null,
      }
    : {};
  return readThemeChoice(JSON.stringify({ ...choice, ...kept, [group]: id }));
};

/** What Save would do with a colour: save it, or why not. */
export type InkSaveState = "ready" | "saved" | "full" | "invalid";

/** Whether `hex` can join the group's saved colours: not when it isn't a colour, is saved or the row is full. */
export const inkSaveState = (choice: ThemeChoice, group: InkGroup, hex: string): InkSaveState => {
  const colour = parseHexColour(hex);
  const saved = choice[SAVED_FIELD[group]];
  if (colour === null) return "invalid";
  if (saved.includes(colour)) return "saved";
  return saved.length >= MAX_SAVED_INKS ? "full" : "ready";
};

/**
 * `choice` with `hex` saved after the group's saved colours, without applying
 * it (Save in the picker). Unchanged unless `inkSaveState` is ready.
 */
export const saveInk = (choice: ThemeChoice, group: InkGroup, hex: string): ThemeChoice => {
  const colour = parseHexColour(hex);
  if (colour === null || inkSaveState(choice, group, colour) !== "ready") return choice;
  const saved = { ...choice, [SAVED_FIELD[group]]: [...choice[SAVED_FIELD[group]], colour] };
  return withUnsaved(saved, group, choice[UNSAVED_FIELD[group]]);
};

/**
 * `choice` without `hex` among the group's saved colours. The colours in use
 * stay: a removed colour that applies goes on as the custom colour, in place
 * of an unsaved one the custom swatch kept.
 */
export const removeSavedInk = (choice: ThemeChoice, group: InkGroup, hex: string): ThemeChoice => {
  const colour = parseHexColour(hex);
  const saved = choice[SAVED_FIELD[group]];
  if (colour === null || !saved.includes(colour)) return choice;
  const removed = { ...choice, [SAVED_FIELD[group]]: saved.filter((entry) => entry !== colour) };
  return withUnsaved(removed, group, choice[UNSAVED_FIELD[group]]);
};

/** A custom colour as it would apply in one mode. */
export interface CustomInkPreview {
  /** The colour that applies, readability adjustments included. */
  readonly colour: string;
  /** The mode's background, the colour it has to read on. */
  readonly ground: string;
  /** Whether `colour` was deepened or brightened from the pick to read. */
  readonly adjusted: boolean;
}

/**
 * What a custom colour would apply as in each mode, so the picker shows that
 * rather than the raw pick. A colour that isn't one previews the current theme.
 */
export const customInkPreview = (
  choice: ThemeChoice,
  group: InkGroup,
  hex: string,
): { readonly light: CustomInkPreview; readonly dark: CustomInkPreview } => {
  const theme = themeFor(chooseCustomInk(choice, group, hex));
  const pick = parseHexColour(hex);
  const preview = (scheme: Scheme): CustomInkPreview => {
    const colour = theme[scheme][INK_TOKEN[group]];
    return { colour, ground: theme[scheme].background, adjusted: pick !== null && colour !== pick };
  };
  return { light: preview("light"), dark: preview("dark") };
};

/** A swatch as Settings shows it: the colour it gives, and whether it's chosen. */
export interface ThemeSwatchOption {
  readonly id: string;
  readonly label: string;
  readonly colour: string;
  readonly selected: boolean;
  /** The check mark drawn on it when chosen: black or white, whichever reads better. */
  readonly mark: string;
}

/** A saved colour in the Primary or Secondary row. */
export interface SavedSwatchOption {
  /** The colour as saved, `#rrggbb`: what a tap applies and Remove takes out. */
  readonly hex: string;
  /** The colour as it would apply in the scheme. */
  readonly colour: string;
  /** Whether it's the group's colour now. */
  readonly selected: boolean;
  /** The check mark's colour on `colour`. */
  readonly mark: string;
}

/** The custom swatch that ends the Primary and Secondary rows. */
export interface CustomSwatchOption {
  /** The kept custom colour as picked, where the picker opens; null until one is picked. */
  readonly picked: string | null;
  /**
   * The kept custom colour as it would apply in the scheme; null until one is
   * picked, and while it's a saved colour, whose swatch shows it.
   */
  readonly colour: string | null;
  readonly selected: boolean;
  /** The check mark's colour on `colour`; null with no colour. */
  readonly mark: string | null;
}

export interface ThemeSwatchRow {
  readonly group: ThemeGroup;
  readonly swatches: readonly ThemeSwatchOption[];
  /** The saved colours, after the swatches; none for the background rows. */
  readonly saved: readonly SavedSwatchOption[];
  /** The custom swatch; null for the background rows. */
  readonly custom: CustomSwatchOption | null;
}

/** The custom colour a group applies now, or null while it's on Default. */
const chosenCustom = (choice: ThemeChoice, group: InkGroup): string | null =>
  choice[group] === CUSTOM_INK ? choice[CUSTOM_FIELD[group]] : null;

const savedSwatches = (
  choice: ThemeChoice,
  group: InkGroup,
  scheme: Scheme,
): readonly SavedSwatchOption[] =>
  choice[SAVED_FIELD[group]].map((hex) => {
    const colour = customInkPreview(choice, group, hex)[scheme].colour;
    return { hex, colour, selected: chosenCustom(choice, group) === hex, mark: markOn(colour) };
  });

const customSwatch = (choice: ThemeChoice, group: InkGroup, scheme: Scheme): CustomSwatchOption => {
  const kept = customSwatchColour(choice, group);
  const saved = kept !== null && choice[SAVED_FIELD[group]].includes(kept);
  const colour =
    kept === null || saved ? null : customInkPreview(choice, group, kept)[scheme].colour;
  return {
    picked: kept,
    colour,
    selected: choice[group] === CUSTOM_INK && kept === choice[CUSTOM_FIELD[group]] && !saved,
    mark: colour === null ? null : markOn(colour),
  };
};

/** A swatch's name in [catalogue]'s language; a swatch Wave no longer offers keeps its stored label. */
const swatchLabel = (
  swatch: { readonly id: string; readonly label: string },
  catalogue: Catalogue = en,
): string =>
  Object.hasOwn(catalogue.settings.swatches, swatch.id)
    ? catalogue.settings.swatches[swatch.id as keyof Catalogue["settings"]["swatches"]]
    : swatch.label;

/**
 * The four swatch rows for Settings. Primary and Secondary show Default, the
 * saved colours and the custom swatch, each in the colour it would actually
 * take in `scheme`, readability adjustments included, named in [catalogue]'s language.
 */
export const themeSwatchRows = (
  choice: ThemeChoice,
  scheme: Scheme,
  catalogue: Catalogue = en,
): readonly ThemeSwatchRow[] =>
  GROUPS.map((group) => ({
    group,
    swatches: THEME_SWATCHES[group].map((swatch) => {
      const theme = themeFor({ ...choice, [group]: swatch.id });
      const colour = isInk(group) ? theme[scheme][INK_TOKEN[group]] : theme[group].background;
      return {
        id: swatch.id,
        label: swatchLabel(swatch, catalogue),
        colour,
        selected: choice[group] === swatch.id,
        mark: markOn(colour),
      };
    }),
    saved: isInk(group) ? savedSwatches(choice, group, scheme) : [],
    custom: isInk(group) ? customSwatch(choice, group, scheme) : null,
  }));
