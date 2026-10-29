import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  DEFAULT_THEME_CHOICE,
  LAUNCHER_ICON_ART,
  LAUNCHER_ICONS,
  THEME_SWATCHES,
  chooseCustomInk,
  contrastRatio,
  isDefaultThemeState,
  launcherIconFor,
  launcherIconSwitch,
  planAlert,
  resolveThemeChange,
  type ThemeChoice,
} from "./index.ts";

const choose = (change: Partial<ThemeChoice>): ThemeChoice => ({
  ...DEFAULT_THEME_CHOICE,
  ...change,
});

describe("resolveThemeChange", () => {
  const current = { choice: DEFAULT_THEME_CHOICE, icon: LAUNCHER_ICONS[0]! };
  const next = choose({ primary: "rose" });

  test("Yes keeps the new colours and their icon", () => {
    const result = resolveThemeChange(current, next, "action");
    assert.deepEqual(result.choice, next);
    assert.equal(result.icon.id, "rose_white");
  });

  test("No keeps the new colours and stored icon, so a later colour change asks again", () => {
    const result = resolveThemeChange(current, next, "alternative");
    assert.deepEqual(result.choice, next);
    assert.equal(result.icon.id, "white_white");
    assert.equal(
      launcherIconSwitch(result.icon, choose({ primary: "rose", secondary: "sky" }), {
        dropsHomeScreenIcon: true,
      })?.icon.id,
      "rose_sky",
    );
  });

  test("Back or an outside tap cancels both the colours and icon", () => {
    assert.deepEqual(resolveThemeChange(current, next, "dismiss"), current);
  });
});

describe("isDefaultThemeState", () => {
  const rose = LAUNCHER_ICONS.find((icon) => icon.id === "rose_white")!;

  test("the shipped colours with the shipped icon have nothing to reset", () => {
    assert.equal(
      isDefaultThemeState({ choice: DEFAULT_THEME_CHOICE, icon: LAUNCHER_ICONS[0]! }),
      true,
    );
  });

  test("an icon kept by No after a reset still leaves something to reset", () => {
    assert.equal(isDefaultThemeState({ choice: DEFAULT_THEME_CHOICE, icon: rose }), false);
  });

  test("new colours with the shipped icon leave something to reset", () => {
    assert.equal(
      isDefaultThemeState({ choice: choose({ primary: "rose" }), icon: LAUNCHER_ICONS[0]! }),
      false,
    );
  });
});

/** The icon for a custom primary and secondary. */
const customIcon = (customPrimary: string, customSecondary: string): string =>
  launcherIconFor(
    choose({ primary: "custom", customPrimary, secondary: "custom", customSecondary }),
  ).id;

describe("launcherIconFor", () => {
  test("the shipped theme shows white waves on black, the first icon (#793)", () => {
    assert.deepEqual(launcherIconFor(DEFAULT_THEME_CHOICE), {
      id: "white_white",
      primary: "white",
      secondary: "white",
      top: "#ffffff",
      bottom: "#ffffff",
    });
    assert.equal(LAUNCHER_ICONS[0]?.id, "white_white");
  });

  test("Teal and Ember keep the teal-over-amber icon Wave shipped before (#94)", () => {
    const icon = launcherIconFor(choose({ primary: "teal", secondary: "ember" }));
    assert.equal(icon.id, "teal_ember");
    assert.equal(icon.top, "#14b7a6");
    assert.equal(icon.bottom, "#f5b83d");
  });

  test("the top wave takes the primary and the bottom wave the secondary, in their dark tones", () => {
    const icon = launcherIconFor(choose({ primary: "blue", secondary: "coral" }));
    assert.equal(icon.top, "#7aaef5");
    assert.equal(icon.bottom, "#f5917e");
  });

  test("the backgrounds don't change the icon", () => {
    assert.deepEqual(
      launcherIconFor(choose({ light: "sand", dark: "black" })),
      launcherIconFor(DEFAULT_THEME_CHOICE),
    );
  });

  test("custom primaries and secondaries keep their black-ground icon on every background (#791)", () => {
    const samples = [
      ["#1177bb", "vivid239"],
      ["#330099", "vivid269"],
      ["#001932", "blue"],
      ["#00e9ff", "vivid209"],
      ["#ff0d00", "vivid29"],
      ["#89cff0", "sky"],
      ["#f8c8dc", "rose"],
    ] as const;
    for (const group of ["primary", "secondary"] as const) {
      for (const [hex, ink] of samples) {
        const choice = chooseCustomInk(DEFAULT_THEME_CHOICE, group, hex);
        const expected = group === "primary" ? `${ink}_white` : `white_${ink}`;
        for (const light of THEME_SWATCHES.light) {
          for (const dark of THEME_SWATCHES.dark) {
            assert.equal(
              launcherIconFor({ ...choice, light: light.id, dark: dark.id }).id,
              expected,
              `${group} ${hex} on ${light.id}/${dark.id}`,
            );
          }
        }
      }
    }
  });

  test("every primary × secondary combination has an icon of its own", () => {
    const ids = new Set<string>();
    for (const primary of THEME_SWATCHES.primary)
      for (const secondary of THEME_SWATCHES.secondary) {
        const icon = launcherIconFor(choose({ primary: primary.id, secondary: secondary.id }));
        assert.equal(icon.primary, primary.id);
        assert.equal(icon.secondary, secondary.id);
        ids.add(icon.id);
      }
    assert.equal(ids.size, THEME_SWATCHES.primary.length * THEME_SWATCHES.secondary.length);
    for (const id of ids) assert.ok(LAUNCHER_ICONS.some((icon) => icon.id === id));
  });

  test("custom colours take palette inks across groups, with the pastel guard", () => {
    assert.equal(customIcon("#00e9ff", "#ff0d00"), "vivid209_vivid29");
    assert.equal(customIcon("#89cff0", "#f8c8dc"), "sky_rose");
  });

  test("a kept custom colour doesn't change the icon while a preset is chosen", () => {
    assert.equal(launcherIconFor(choose({ customPrimary: "#ff00aa" })).id, "white_white");
  });
});

/** The points of an `M x y C … x y …` path, control points included (they bound the curve). */
const pathPoints = (path: string): [number, number][] => {
  assert.match(path, /^M[\d.\- ]+([LC][\d.\- ]+)+$/);
  const numbers = path.match(/-?\d+(\.\d+)?/g)?.map(Number) ?? [];
  return Array.from({ length: numbers.length / 2 }, (_, i) => [
    numbers[2 * i]!,
    numbers[2 * i + 1]!,
  ]);
};

const meanY = (path: string): number => {
  const points = pathPoints(path);
  return points.reduce((sum, [, y]) => sum + y, 0) / points.length;
};

describe("LAUNCHER_ICON_ART", () => {
  const { viewport, strokeWidth, top, bottom } = LAUNCHER_ICON_ART;
  const centre = viewport / 2;
  const reach = (path: string): number =>
    Math.max(...pathPoints(path).map(([x, y]) => Math.hypot(x - centre, y - centre))) +
    strokeWidth / 2;

  test("draws on the adaptive icon's 108dp layer", () => {
    assert.equal(viewport, 108);
  });

  test("keeps both waves inside the 66dp circle every launcher mask shows", () => {
    assert.ok(reach(top) <= 33, `top reaches ${reach(top)}`);
    assert.ok(reach(bottom) <= 33, `bottom reaches ${reach(bottom)}`);
  });

  test("fills most of that circle, as the shipped icon does", () => {
    assert.ok(Math.max(reach(top), reach(bottom)) >= 28);
  });

  test("puts the top wave above the bottom one", () => {
    assert.ok(meanY(top) < centre && centre < meanY(bottom));
  });
});

describe("launcherIconSwitch", () => {
  const keeps = { dropsHomeScreenIcon: false };
  const drops = { dropsHomeScreenIcon: true };

  test("compares the next colours with the stored icon, including a vivid icon (#792)", () => {
    const stored = LAUNCHER_ICONS.find((icon) => icon.id === "vivid209_vivid29")!;
    const change = launcherIconSwitch(stored, DEFAULT_THEME_CHOICE, keeps);
    assert.equal(change?.icon.id, "white_white");
    assert.equal(change?.warning.title, "Change the app icon too?");
    assert.deepEqual(planAlert(change!.warning).buttons, [
      { label: "No", tone: "accent", choice: "alternative" },
      { label: "Yes", tone: "accent", choice: "action" },
    ]);
  });

  test("light or dark background changes never request an icon switch, including custom colours (#791)", () => {
    const primary = chooseCustomInk(DEFAULT_THEME_CHOICE, "primary", "#1177bb");
    const secondary = chooseCustomInk(DEFAULT_THEME_CHOICE, "secondary", "#330099");
    for (const choice of [
      DEFAULT_THEME_CHOICE,
      primary,
      secondary,
      chooseCustomInk(primary, "secondary", "#330099"),
    ]) {
      for (const group of ["light", "dark"] as const) {
        for (const from of THEME_SWATCHES[group]) {
          for (const to of THEME_SWATCHES[group]) {
            for (const launcher of [keeps, drops]) {
              assert.equal(
                launcherIconSwitch(
                  launcherIconFor({ ...choice, [group]: from.id }),
                  { ...choice, [group]: to.id },
                  launcher,
                ),
                null,
                `${choice.primary}/${choice.secondary}: ${group} ${from.id} to ${to.id}`,
              );
            }
          }
        }
      }
    }
  });

  test("a new primary or secondary switches to its icon", () => {
    const change = launcherIconSwitch(
      launcherIconFor(DEFAULT_THEME_CHOICE),
      choose({ primary: "violet" }),
      keeps,
    );
    assert.equal(change?.icon.id, "violet_white");
    assert.equal(change?.warning.title, "Change the app icon too?");
  });

  test("resetting to defaults asks to bring back the white icon (#793)", () => {
    const change = launcherIconSwitch(
      launcherIconFor(choose({ primary: "rose", secondary: "sky" })),
      DEFAULT_THEME_CHOICE,
      keeps,
    );
    assert.equal(change?.icon.id, "white_white");
  });

  test("resetting to defaults doesn't ask when the white icon is already on", () => {
    const white = launcherIconFor(DEFAULT_THEME_CHOICE);
    assert.equal(launcherIconSwitch(white, DEFAULT_THEME_CHOICE, drops), null);
    const cream = choose({ primary: "custom", customPrimary: "#fffdd0" });
    assert.equal(launcherIconSwitch(launcherIconFor(cream), DEFAULT_THEME_CHOICE, drops), null);
  });

  test("warns first when the launcher drops the home-screen icon on a switch", () => {
    const change = launcherIconSwitch(
      launcherIconFor(DEFAULT_THEME_CHOICE),
      choose({ secondary: "gold" }),
      drops,
    );
    assert.equal(change?.icon.id, "white_gold");
    assert.match(change?.warning?.message ?? "", /home screen/);
    assert.equal(change?.warning?.action.destructive, undefined);
  });
});

describe("LAUNCHER_ICONS", () => {
  test("names are valid Android resource names", () => {
    for (const icon of LAUNCHER_ICONS) assert.match(icon.id, /^[a-z][a-z0-9_]*$/);
  });

  test("both waves stand out on the black ground (3:1, as for graphics)", () => {
    for (const icon of LAUNCHER_ICONS) {
      assert.ok(contrastRatio(icon.top, "#000000") >= 3, `${icon.id} top`);
      assert.ok(contrastRatio(icon.bottom, "#000000") >= 3, `${icon.id} bottom`);
    }
  });
});
