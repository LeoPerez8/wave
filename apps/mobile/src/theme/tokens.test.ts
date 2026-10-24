/// <reference types="node" />
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

import { DEFAULT_THEME, RECAP_COLOURS, RECAP_INK, TONES } from "@wave/core";

const read = (path: string): string => readFileSync(new URL(path, import.meta.url), "utf8");

const css = read("../../global.css");
const appConfig = read("../../app.config.ts");

/** `--color-<name>: #rrggbb;` declarations inside a block. */
const declarations = (block: string): Record<string, string> =>
  Object.fromEntries(
    [...block.matchAll(/--color-([\w-]+):\s*(#[0-9a-f]{6});/gi)].map(([, name, value]) => [
      name,
      value?.toLowerCase(),
    ]),
  );

const variant = (scheme: "light" | "dark"): Record<string, string> => {
  const match = new RegExp(`@variant ${scheme} \\{([^}]*)\\}`).exec(css);
  assert.ok(match?.[1] !== undefined, `global.css has a ${scheme} variant`);
  return declarations(match[1]);
};

describe("global.css colour tokens", () => {
  test("each scheme declares exactly Core's default theme, the Recap colours and their ink", () => {
    for (const scheme of ["light", "dark"] as const) {
      const recap = Object.fromEntries(
        Object.entries(RECAP_COLOURS).map(([name, value]) => [`recap-${name}`, value]),
      );
      assert.deepEqual(variant(scheme), {
        ...DEFAULT_THEME[scheme],
        ...recap,
        "on-recap": RECAP_INK,
      });
    }
  });

  test("the tone ramp matches Core's, step for step", () => {
    const tones = declarations(css.slice(css.indexOf("@theme {")));
    assert.deepEqual(tones, Object.fromEntries(TONES.map((tone, step) => [`tone-${step}`, tone])));
  });
});

describe("launch splash", () => {
  test("shows each scheme's background, so opening the app has no colour jump", () => {
    const splash = /"expo-splash-screen",\s*\{([\s\S]*?)\n {6}\},/.exec(appConfig)?.[1] ?? "";
    const [light, dark] = [...splash.matchAll(/backgroundColor:\s*"(#[0-9a-f]{6})"/gi)].map(
      ([, value]) => value?.toLowerCase(),
    );
    assert.equal(light, DEFAULT_THEME.light.background);
    assert.equal(dark, DEFAULT_THEME.dark.background);
  });
});
