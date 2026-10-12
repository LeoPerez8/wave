/**
 * The rule between the entries of an overlay card. The separator token is
 * tuned for opaque screens and all but vanishes on glass, whose ground
 * depends on what's behind it. A see-through wash of the text colour always
 * moves whatever lies under it toward the text, so it stays visible on any
 * backdrop, theme or glass setting while staying far from text contrast.
 */

/** How much of the text colour the divider lays down, 0–1. */
const STRENGTH = 0.24;

/** The divider of an overlay card: `foreground` (`#rrggbb`) as `#rrggbbaa`. */
export const overlayDivider = (foreground: string): string =>
  `${foreground.slice(0, 7)}${Math.round(STRENGTH * 255)
    .toString(16)
    .padStart(2, "0")}`;
