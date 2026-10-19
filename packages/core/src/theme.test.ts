import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  DEFAULT_THEME,
  NIGHT_SLATE,
  RECAP_COLOURS,
  RECAP_INK,
  SETTINGS_PAGES,
  SETTINGS_TILE_COLOURS,
  SETTINGS_TILE_GLYPH,
  TONES,
  contrastRatio,
  themeContrastIssues,
} from "./index.ts";

describe("DEFAULT_THEME", () => {
  test("light mode keeps the fog theme it shipped with", () => {
    assert.deepEqual(DEFAULT_THEME.light, {
      background: "#e0ecef",
      grouped: "#d3dfe2",
      surface: "#eff4f6",
      foreground: "#121b1d",
      secondary: "#454f52",
      tertiary: "#778385",
      separator: "#c1cdd0",
      fill: "#d3dfe2",
      accent: "#006a5f",
      "on-accent": "#eff4f6",
      highlight: "#a14f09",
      destructive: "#b3261e",
      scrim: "#121b1d",
    });
  });

  test("dark mode sits on true black, with groups, cards and separators climbing the ramp", () => {
    const { background, grouped, surface, fill, separator, scrim } = DEFAULT_THEME.dark;
    assert.deepEqual(
      { background, grouped, surface, fill, separator, scrim },
      {
        background: "#000000",
        grouped: "#0a1113",
        surface: "#121b1d",
        fill: "#121b1d",
        separator: "#1c2628",
        scrim: "#000000",
      },
    );
  });

  test("on the black ground, groups, cards, fills and separators each stand off it", () => {
    const dark = DEFAULT_THEME.dark;
    for (const token of ["grouped", "surface", "fill", "separator"] as const) {
      assert.ok(contrastRatio(dark[token], dark.background) > 1.05, token);
    }
    assert.ok(
      contrastRatio(dark.separator, dark.background) > contrastRatio(dark.surface, dark.background),
    );
  });
});

describe("NIGHT_SLATE", () => {
  test("keeps the dark theme Wave shipped before true black", () => {
    assert.deepEqual(NIGHT_SLATE, {
      background: "#0a1113",
      grouped: "#0a1113",
      surface: "#121b1d",
      foreground: "#e0ecef",
      secondary: "#a5b0b3",
      tertiary: "#606b6e",
      separator: "#1c2628",
      fill: "#121b1d",
      accent: "#59c0ad",
      "on-accent": "#0a1113",
      highlight: "#ec9d53",
      destructive: "#f2867a",
      scrim: "#0a1113",
    });
  });

  test("its ground is the deepest ramp step, darker than light mode's text", () => {
    assert.equal(TONES.at(-1), NIGHT_SLATE.background);
    assert.notEqual(DEFAULT_THEME.light.foreground, NIGHT_SLATE.background);
  });
});

describe("themeContrastIssues", () => {
  test("the default themes meet WCAG AA: text 4.5:1 on ground, cards and groups, non-text 3:1", () => {
    assert.deepEqual(themeContrastIssues(DEFAULT_THEME.light), []);
    assert.deepEqual(themeContrastIssues(DEFAULT_THEME.dark), []);
  });

  test("dark text, accent and highlight stay comfortably readable on the deeper ground", () => {
    const dark = DEFAULT_THEME.dark;
    for (const ink of [dark.foreground, dark.secondary, dark.accent, dark.highlight]) {
      assert.ok(contrastRatio(ink, dark.background) >= 7, ink);
      assert.ok(contrastRatio(ink, dark.surface) >= 7, ink);
    }
  });

  test("names each pair that falls short, with its ratio and the minimum it needs", () => {
    const dim = { ...DEFAULT_THEME.dark, secondary: "#454f52", tertiary: "#293235" };
    assert.deepEqual(
      themeContrastIssues(dim).map(({ ink, on, minimum }) => `${ink} on ${on} < ${minimum}`),
      [
        "secondary on background < 4.5",
        "secondary on surface < 4.5",
        "secondary on grouped < 4.5",
        "tertiary on background < 3",
        "tertiary on surface < 3",
      ],
    );
    const [first] = themeContrastIssues(dim);
    assert.ok(first !== undefined && first.ratio > 1 && first.ratio < 4.5);
  });

  test("text on the accent fill needs 4.5:1 too", () => {
    const flat = { ...DEFAULT_THEME.dark, "on-accent": "#a5b0b3" };
    assert.deepEqual(
      themeContrastIssues(flat).map(({ ink, on }) => `${ink} on ${on}`),
      ["on-accent on accent"],
    );
  });
});

describe("SETTINGS_TILE_COLOURS", () => {
  const schemes = ["light", "dark"] as const;

  test("has a colour, in each scheme, for the tile of every Settings page", () => {
    for (const scheme of schemes) {
      for (const { title, colour } of SETTINGS_PAGES) {
        assert.match(
          SETTINGS_TILE_COLOURS[scheme][colour],
          /^#[0-9a-f]{6}$/,
          `${title}, ${scheme}`,
        );
      }
    }
  });

  test("keeps a white glyph legible on every tile, light and dark (3:1, a non-text mark)", () => {
    assert.equal(SETTINGS_TILE_GLYPH, "#ffffff");
    for (const scheme of schemes) {
      for (const [name, colour] of Object.entries(SETTINGS_TILE_COLOURS[scheme])) {
        const ratio = contrastRatio(SETTINGS_TILE_GLYPH, colour);
        assert.ok(ratio >= 3, `white on ${name} (${scheme}) is ${ratio.toFixed(2)}:1`);
      }
    }
  });

  test("takes the grey tile from the tone ramp in both schemes (no ad-hoc greys)", () => {
    for (const scheme of schemes) {
      assert.ok(
        (TONES as readonly string[]).includes(SETTINGS_TILE_COLOURS[scheme].grey),
        `${scheme} grey ${SETTINGS_TILE_COLOURS[scheme].grey}`,
      );
    }
  });

  test("sets every tile off dark mode's black ground", () => {
    for (const [name, colour] of Object.entries(SETTINGS_TILE_COLOURS.dark)) {
      const ratio = contrastRatio(colour, DEFAULT_THEME.dark.background);
      assert.ok(ratio >= 3, `${name} on the dark ground is ${ratio.toFixed(2)}:1`);
    }
  });
});

describe("RECAP_COLOURS", () => {
  /** [ink] laid at [opacity] over [ground], as the app's `opacity-80` lines draw it. */
  const over = (ink: string, opacity: number, ground: string): string => {
    const channel = (hex: string, at: number) => Number.parseInt(hex.slice(at, at + 2), 16);
    return `#${[1, 3, 5]
      .map((at) =>
        Math.round(channel(ink, at) * opacity + channel(ground, at) * (1 - opacity))
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")}`;
  };

  test("keeps a Recap's white ink readable as text on every colour (4.5:1)", () => {
    assert.equal(RECAP_INK, "#ffffff");
    for (const [name, colour] of Object.entries(RECAP_COLOURS)) {
      const ratio = contrastRatio(RECAP_INK, colour);
      assert.ok(ratio >= 4.5, `white on ${name} is ${ratio.toFixed(2)}:1`);
    }
  });

  test("keeps the quieter lines, the ink at 80%, readable as text too", () => {
    for (const [name, colour] of Object.entries(RECAP_COLOURS)) {
      const ratio = contrastRatio(over(RECAP_INK, 0.8, colour), colour);
      assert.ok(ratio >= 4.5, `80% white on ${name} is ${ratio.toFixed(2)}:1`);
    }
  });

  test("are a Recap's own, apart from Settings' tiles", () => {
    const tiles = new Set(
      [SETTINGS_TILE_COLOURS.light, SETTINGS_TILE_COLOURS.dark].flatMap((c) => Object.values(c)),
    );
    for (const [name, colour] of Object.entries(RECAP_COLOURS)) {
      if (name !== "grey") assert.ok(!tiles.has(colour), `${name} ${colour} is a Settings tile's`);
    }
  });

  test("takes the grey from the tone ramp (no ad-hoc greys)", () => {
    assert.ok((TONES as readonly string[]).includes(RECAP_COLOURS.grey));
  });
});
