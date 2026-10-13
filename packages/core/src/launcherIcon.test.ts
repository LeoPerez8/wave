import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  DEFAULT_THEME_CHOICE,
  LAUNCHER_ICON_ART,
  LAUNCHER_ICONS,
  THEME_SWATCHES,
  contrastRatio,
  launcherIconFor,
  launcherIconSwitch,
  type ThemeChoice,
} from "./index.ts";

const choose = (change: Partial<ThemeChoice>): ThemeChoice => ({
  ...DEFAULT_THEME_CHOICE,
  ...change,
});

describe("launcherIconFor", () => {
  test("the shipped theme keeps the teal-over-amber icon (#94)", () => {
    const icon = launcherIconFor(DEFAULT_THEME_CHOICE);
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
    assert.equal(LAUNCHER_ICONS.length, ids.size);
  });
});

/** The points of an `M x y L x y …` path. */
const pathPoints = (path: string): [number, number][] => {
  assert.match(path, /^M[\d.\- ]+(L[\d.\- ]+)+$/);
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

  test("a background change leaves the icon alone", () => {
    assert.equal(launcherIconSwitch(DEFAULT_THEME_CHOICE, choose({ dark: "black" }), drops), null);
  });

  test("a new primary or secondary switches to its icon", () => {
    const change = launcherIconSwitch(DEFAULT_THEME_CHOICE, choose({ primary: "violet" }), keeps);
    assert.equal(change?.icon.id, "violet_ember");
    assert.equal(change?.warning, null);
  });

  test("resetting to defaults brings back the teal-over-amber icon", () => {
    const change = launcherIconSwitch(
      choose({ primary: "rose", secondary: "sky" }),
      DEFAULT_THEME_CHOICE,
      keeps,
    );
    assert.equal(change?.icon.id, "teal_ember");
  });

  test("warns first when the launcher drops the home-screen icon on a switch", () => {
    const change = launcherIconSwitch(DEFAULT_THEME_CHOICE, choose({ secondary: "gold" }), drops);
    assert.equal(change?.icon.id, "teal_gold");
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
