/** The shared inks of the launcher icon and native splash. */
import { toOklch } from "./colour.ts";
import {
  CUSTOM_INK,
  DEFAULT_THEME_CHOICE,
  THEME_SWATCHES,
  WHITE_INK,
  chooseCustomInk,
  inkDistance,
  themeFor,
  type InkGroup,
  type InkSwatch,
  type ThemeChoice,
} from "./themeChoice.ts";

export interface PaletteInk {
  /** Stable Android resource/alias name component, e.g. `teal` or `vivid209`. */
  readonly id: string;
  readonly kind: "preset" | "vivid";
  readonly light: string;
  /** The icon's ink on black, also available to the splash. */
  readonly dark: string;
}

export interface InkPair {
  /** `<primary id>_<secondary id>`, preserving existing preset pair ids. */
  readonly id: string;
  readonly primary: PaletteInk;
  readonly secondary: PaletteInk;
}

const SHIPPED_ICON_INK: Readonly<Record<string, string>> = {
  teal: "#14b7a6",
  ember: "#f5b83d",
};

/**
 * Nearest 8-bit sRGB colours to OKLCH hues 29°, 59°, … 359°, among all
 * 1,530 colours with HSV saturation and value both 1 (one channel 255, one 0).
 * Freeze the source hexes so resource ids and colours stay reproducible.
 */
const VIVID_SOURCES = [
  [29, "#ff0004"],
  [59, "#ff8e00"],
  [89, "#ffc900"],
  [119, "#ddff00"],
  [149, "#00ff71"],
  [179, "#00ffdf"],
  [209, "#00e5ff"],
  [239, "#00b1ff"],
  [269, "#2b00ff"],
  [299, "#9000ff"],
  [329, "#ff00fc"],
  [359, "#ff008b"],
] as const;

const presetInk = (swatch: InkSwatch): PaletteInk => ({
  id: swatch.id,
  kind: "preset",
  light: swatch.light,
  dark: SHIPPED_ICON_INK[swatch.id] ?? swatch.dark,
});

const whiteSwatch = THEME_SWATCHES.primary.find((swatch) => swatch.id === WHITE_INK)!;

/**
 * All 25 inks; both waves can use either group's presets, any vivid tone or
 * the Default swatch's white. White comes last, so the 24 inks before it keep
 * the positions splash style names count.
 */
export const INK_PALETTE: readonly PaletteInk[] = [
  ...[...THEME_SWATCHES.primary, ...THEME_SWATCHES.secondary]
    .filter((swatch) => swatch.id !== WHITE_INK)
    .map(presetInk),
  ...VIVID_SOURCES.map(([hue, hex]) => {
    const theme = themeFor(chooseCustomInk(DEFAULT_THEME_CHOICE, "primary", hex));
    return {
      id: `vivid${hue}`,
      kind: "vivid" as const,
      light: theme.light.accent,
      dark: theme.dark.accent,
    };
  }),
  presetInk(whiteSwatch),
];

/** Both waves choose independently: 25 × 25 stable pairs. */
export const INK_PAIRS: readonly InkPair[] = INK_PALETTE.flatMap((primary) =>
  INK_PALETTE.map((secondary) => ({
    id: `${primary.id}_${secondary.id}`,
    primary,
    secondary,
  })),
);

/** Below the soft presets' roughly 0.12 chroma, a custom ink must stay a preset. */
export const PASTEL_CHROMA_THRESHOLD = 0.12;

/**
 * A colour at least this light and at most this chromatic in OKLCH reads as
 * white: cream, ivory, beige and light greys take the white ink rather than a
 * pale preset, while peach, pastel pink and yellow keep their hue.
 */
const NEAR_WHITE = { lightness: 0.9, chroma: 0.06 } as const;

const white = INK_PALETTE.at(-1)!;

/**
 * A preset keeps its ink; a custom colour matches its corrected ink on the
 * icon's black ground: white when it's close to white, else the nearest other ink.
 */
export const inkPairFor = (choice: ThemeChoice): InkPair => {
  const theme = themeFor({ ...choice, dark: "black" });
  const pick = (group: InkGroup): PaletteInk => {
    const presets = THEME_SWATCHES[group];
    const custom = group === "primary" ? choice.customPrimary : choice.customSecondary;
    if (choice[group] !== CUSTOM_INK || custom === null) {
      const id = presets.find((swatch) => swatch.id === choice[group])?.id ?? presets[0]!.id;
      return INK_PALETTE.find((ink) => ink.id === id)!;
    }
    const hex = theme.dark[group === "primary" ? "accent" : "highlight"];
    const tone = toOklch(hex);
    if (tone.l >= NEAR_WHITE.lightness && tone.c <= NEAR_WHITE.chroma) return white;
    const candidates = INK_PALETTE.filter(
      (ink) => ink.id !== WHITE_INK && (tone.c >= PASTEL_CHROMA_THRESHOLD || ink.kind === "preset"),
    );
    return candidates.reduce((best, ink) =>
      inkDistance(hex, ink.dark) < inkDistance(hex, best.dark) ? ink : best,
    );
  };
  const primary = pick("primary");
  const secondary = pick("secondary");
  return INK_PAIRS.find((pair) => pair.primary === primary && pair.secondary === secondary)!;
};
