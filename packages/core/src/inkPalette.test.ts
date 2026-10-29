import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DEFAULT_THEME_CHOICE,
  INK_PALETTE,
  INK_PAIRS,
  LAUNCHER_ICONS,
  PASTEL_CHROMA_THRESHOLD,
  THEME_SWATCHES,
  chooseCustomInk,
  inkPairFor,
  launcherIconFor,
  paletteSplashThemeFor,
  contrastRatio,
} from "./index.ts";

test("custom cyan and red take the vivid inks their dark theme shows (#654)", () => {
  const choice = chooseCustomInk(
    chooseCustomInk(DEFAULT_THEME_CHOICE, "primary", "#00e9ff"),
    "secondary",
    "#ff0d00",
  );
  const pair = inkPairFor(choice);
  assert.equal(pair.id, "vivid209_vivid29");
  assert.equal(pair.primary.dark, "#00e5ff");
  assert.equal(pair.secondary.dark, "#ff1a1d");
});

test("pastel cyan and mint stay with presets in either wave", () => {
  for (const group of ["primary", "secondary"] as const) {
    for (const hex of ["#b5ecf5", "#bdf2d5"]) {
      const pair = inkPairFor(chooseCustomInk(DEFAULT_THEME_CHOICE, group, hex));
      assert.equal(pair[group].kind, "preset", `${group} ${hex}`);
    }
  }
});

test("a custom colour close to white takes the white ink in either wave (#793)", () => {
  // Cream, beige, ivory, linen, snow and a light grey: light, with little chroma.
  for (const hex of ["#fffdd0", "#f5f5dc", "#fffff0", "#faf0e6", "#fffafa", "#e0e0e0", "#ffffff"])
    for (const group of ["primary", "secondary"] as const) {
      const pair = inkPairFor(
        chooseCustomInk(
          { ...DEFAULT_THEME_CHOICE, primary: "teal", secondary: "ember" },
          group,
          hex,
        ),
      );
      assert.equal(pair[group].id, "white", `${group} ${hex}`);
    }
});

test("saturated or darker colours never take the white ink", () => {
  // Yellow, lemon, peach, two pastel pinks, mid grey and the vivid tones' own sources.
  for (const hex of [
    "#ffff00",
    "#f5d742",
    "#ffe5b4",
    "#ffc0cb",
    "#f8c8dc",
    "#9e9e9e",
    "#00e5ff",
    "#ff0004",
  ])
    for (const group of ["primary", "secondary"] as const) {
      const pair = inkPairFor(chooseCustomInk(DEFAULT_THEME_CHOICE, group, hex));
      assert.notEqual(pair[group].id, "white", `${group} ${hex}`);
    }
});

test("the pastel guard ends at dark-ink OKLCH chroma 0.12", () => {
  assert.equal(PASTEL_CHROMA_THRESHOLD, 0.12);
  // These corrected dark inks have chroma 0.11989 and 0.12099, respectively.
  assert.equal(
    inkPairFor(chooseCustomInk(DEFAULT_THEME_CHOICE, "primary", "#47d5e5")).primary.id,
    "sky",
  );
  assert.equal(
    inkPairFor(chooseCustomInk(DEFAULT_THEME_CHOICE, "primary", "#45d5e6")).primary.id,
    "vivid209",
  );
});

test("matching uses the corrected dark ink rather than the raw pick", () => {
  // This dark navy displays as #798693 in the app. Its raw pick would match Teal.
  assert.equal(
    inkPairFor(chooseCustomInk(DEFAULT_THEME_CHOICE, "primary", "#001932")).primary.id,
    "blue",
  );
});

test("a custom primary can take Sky from the secondary presets", () => {
  const choice = chooseCustomInk(DEFAULT_THEME_CHOICE, "primary", "#89cff0");
  assert.equal(inkPairFor(choice).id, "sky_white");
});

test("the palette supplies 25 inks, white last, and all 625 uniquely named pairs (#793)", () => {
  // Splash style names count positions in this order, so the first 24 never move.
  assert.deepEqual(
    INK_PALETTE.map((ink) => ink.id),
    [
      "teal",
      "blue",
      "violet",
      "green",
      "rose",
      "lime",
      "ember",
      "gold",
      "coral",
      "magenta",
      "sky",
      "lemon",
      ...[29, 59, 89, 119, 149, 179, 209, 239, 269, 299, 329, 359].map((hue) => `vivid${hue}`),
      "white",
    ],
  );
  assert.deepEqual(INK_PALETTE.at(-1), {
    id: "white",
    kind: "preset",
    light: "#121b1d",
    dark: "#ffffff",
  });
  assert.equal(INK_PAIRS.length, 625);
  assert.equal(new Set(INK_PAIRS.map((pair) => pair.id)).size, 625);
  for (const primary of INK_PALETTE) {
    for (const secondary of INK_PALETTE) {
      const pair = INK_PAIRS.find((pair) => pair.id === `${primary.id}_${secondary.id}`);
      assert.deepEqual(pair, { id: `${primary.id}_${secondary.id}`, primary, secondary });
      assert.match(pair.id, /^[a-z][a-z0-9_]*$/);
    }
  }
  for (const id of ["white_white", "white_teal", "teal_white", "vivid29_white", "white_lemon"])
    assert.ok(
      INK_PAIRS.some((pair) => pair.id === id),
      id,
    );
});

test("all 36 preset choices keep their icon ids and inks", () => {
  for (const primary of THEME_SWATCHES.primary) {
    for (const secondary of THEME_SWATCHES.secondary) {
      const choice = { ...DEFAULT_THEME_CHOICE, primary: primary.id, secondary: secondary.id };
      const pair = inkPairFor(choice);
      const icon = launcherIconFor(choice);
      assert.equal(pair.id, `${primary.id}_${secondary.id}`);
      assert.equal(icon.id, pair.id);
      assert.equal(pair.primary.dark, primary.id === "teal" ? "#14b7a6" : primary.dark);
      assert.equal(pair.secondary.dark, secondary.id === "ember" ? "#f5b83d" : secondary.dark);
      assert.equal(pair.primary.light, primary.light);
      assert.equal(pair.secondary.light, secondary.light);
    }
  }
});

test("the 12 vivid tones carry the custom-ink corrections in both modes", () => {
  const expected = [
    ["vivid29", "#d20003", "#ff1a1d"],
    ["vivid59", "#995500", "#ff8e00"],
    ["vivid89", "#806500", "#ffc900"],
    ["vivid119", "#5e6c00", "#ddff00"],
    ["vivid149", "#007936", "#00ff71"],
    ["vivid179", "#007364", "#00ffdf"],
    ["vivid209", "#007380", "#00e5ff"],
    ["vivid239", "#006f9f", "#00b1ff"],
    ["vivid269", "#2b00ff", "#856cff"],
    ["vivid299", "#9000ff", "#b453ff"],
    ["vivid329", "#b900b7", "#ff00fc"],
    ["vivid359", "#cc006f", "#ff008b"],
  ];
  assert.deepEqual(
    INK_PALETTE.filter((ink) => ink.kind === "vivid").map(({ id, light, dark }) => [
      id,
      light,
      dark,
    ]),
    expected,
  );
});

test("kept custom colours and invalid preset ids fall back independently by group", () => {
  assert.equal(inkPairFor({ ...DEFAULT_THEME_CHOICE, customPrimary: "#00e9ff" }).id, "white_white");
  assert.equal(
    inkPairFor({ ...DEFAULT_THEME_CHOICE, primary: "unknown", secondary: "sky" }).id,
    "white_sky",
  );
  assert.equal(
    inkPairFor({ ...DEFAULT_THEME_CHOICE, primary: "blue", secondary: "unknown" }).id,
    "blue_white",
  );
});

test("launcher icons use the shared palette for both waves", () => {
  const choice = chooseCustomInk(
    chooseCustomInk(DEFAULT_THEME_CHOICE, "primary", "#00e9ff"),
    "secondary",
    "#ff0d00",
  );
  assert.deepEqual(launcherIconFor(choice), {
    id: "vivid209_vivid29",
    primary: "vivid209",
    secondary: "vivid29",
    top: "#00e5ff",
    bottom: "#ff1a1d",
  });
  assert.equal(LAUNCHER_ICONS.length, 625);
  for (const pair of INK_PAIRS) {
    assert.deepEqual(
      LAUNCHER_ICONS.find((icon) => icon.id === pair.id),
      {
        id: pair.id,
        primary: pair.primary.id,
        secondary: pair.secondary.id,
        top: pair.primary.dark,
        bottom: pair.secondary.dark,
      },
    );
  }
});

test("the splash can use the same matched pair with its light and dark inks", () => {
  const choice = chooseCustomInk(
    chooseCustomInk(DEFAULT_THEME_CHOICE, "primary", "#00e9ff"),
    "secondary",
    "#ff0d00",
  );
  const splash = paletteSplashThemeFor(choice);
  assert.equal(splash?.name, "Wl.0.0.i.c");
  assert.equal(splash?.choice.primary, "vivid209");
  assert.equal(splash?.choice.secondary, "vivid29");
  assert.equal(splash?.choice.customPrimary, null);
  assert.equal(splash?.choice.customSecondary, null);
  assert.deepEqual(splash?.light, {
    background: "#e0ecef",
    primary: "#007380",
    secondary: "#d20003",
  });
  assert.deepEqual(splash?.dark, {
    background: "#000000",
    primary: "#00e5ff",
    secondary: "#ff1a1d",
  });
});

test("palette splash resources cover every background and ink pair with readable waves", () => {
  const names = new Set<string>();
  for (const light of THEME_SWATCHES.light) {
    for (const dark of THEME_SWATCHES.dark) {
      const choice = { ...DEFAULT_THEME_CHOICE, light: light.id, dark: dark.id };
      for (const pair of INK_PAIRS) {
        const splash = paletteSplashThemeFor(choice, pair);
        if (splash === null) {
          assert.equal(pair.id, "white_white");
          assert.equal(light.id, "fog");
          assert.equal(dark.id, "black");
          continue;
        }
        assert.equal(names.has(splash.name), false, splash.name);
        names.add(splash.name);
        assert.match(splash.name, /^[A-Za-z][A-Za-z0-9_.]*$/);
        assert.equal(splash.light.background, light.colour);
        assert.equal(splash.dark.background, dark.colour);
        for (const scheme of ["light", "dark"] as const) {
          const colours = splash[scheme];
          for (const ink of [colours.primary, colours.secondary]) {
            assert.ok(
              contrastRatio(ink, colours.background) >= 3,
              `${splash.name} ${scheme} ${ink}`,
            );
          }
        }
      }
    }
  }
  assert.equal(names.size, 36 * 625 - 1);
});
