import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  DEFAULT_THEME_CHOICE,
  editThemeChoice,
  readThemeEdit,
  themeFor,
  type ThemeChoice,
} from "./index.ts";

const edited = (choice: ThemeChoice, ...edits: readonly unknown[]): ThemeChoice =>
  edits.reduce<ThemeChoice>((current, raw) => {
    const edit = readThemeEdit(raw);
    assert.notEqual(edit, null, `refused ${JSON.stringify(raw)}`);
    return editThemeChoice(current, edit!);
  }, choice);

describe("theme edits", () => {
  test("a background swatch changes that mode's ground and leaves the other", () => {
    const choice = edited(DEFAULT_THEME_CHOICE, { kind: "swatch", group: "light", id: "sand" });
    assert.equal(themeFor(choice).light.background, "#ede6da");
    assert.equal(themeFor(choice).dark.background, themeFor(DEFAULT_THEME_CHOICE).dark.background);
    const dark = edited(choice, { kind: "swatch", group: "dark", id: "navy" });
    assert.equal(themeFor(dark).dark.background, "#0a0f1f");
    assert.equal(themeFor(dark).light.background, "#ede6da");
  });

  test("a custom colour applies, and typed hex is read as the picker reads it", () => {
    const choice = edited(DEFAULT_THEME_CHOICE, { kind: "custom", group: "primary", hex: "F80" });
    assert.equal(choice.primary, "custom");
    assert.equal(choice.customPrimary, "#ff8800");
    assert.equal(themeFor(choice).dark.accent, "#ff8800");
  });

  test("Save keeps a colour without applying it, a saved colour applies, Remove takes it out", () => {
    const saved = edited(DEFAULT_THEME_CHOICE, {
      kind: "save",
      group: "secondary",
      hex: "#7cc4ea",
    });
    assert.deepEqual(saved.savedSecondary, ["#7cc4ea"]);
    assert.equal(saved.secondary, "white");
    const applied = edited(saved, { kind: "saved", group: "secondary", hex: "#7cc4ea" });
    assert.equal(themeFor(applied).dark.highlight, "#7cc4ea");
    const removed = edited(applied, { kind: "remove", group: "secondary", hex: "#7cc4ea" });
    assert.deepEqual(removed.savedSecondary, []);
    // The colour in use stays.
    assert.equal(themeFor(removed).dark.highlight, "#7cc4ea");
  });

  test("Reset brings back the default theme and keeps the saved colours", () => {
    const choice = edited(
      DEFAULT_THEME_CHOICE,
      { kind: "swatch", group: "dark", id: "plum" },
      { kind: "save", group: "primary", hex: "#a99af0" },
      { kind: "custom", group: "primary", hex: "#112233" },
      { kind: "reset" },
    );
    assert.deepEqual(choice, { ...DEFAULT_THEME_CHOICE, savedPrimary: ["#a99af0"] });
  });

  test("what isn't an edit is refused", () => {
    for (const raw of [
      null,
      "reset",
      {},
      { kind: "paint" },
      { kind: "swatch", group: "light", id: "navy" },
      { kind: "swatch", group: "tertiary", id: "fog" },
      { kind: "swatch", group: "primary", id: "custom" },
      { kind: "swatch", group: "light", id: 3 },
      { kind: "custom", group: "light", hex: "#112233" },
      { kind: "custom", group: "primary", hex: "red" },
      { kind: "save", group: "primary" },
      { kind: "remove", group: "secondary", hex: 12 },
    ])
      assert.equal(readThemeEdit(raw), null, JSON.stringify(raw));
  });
});
