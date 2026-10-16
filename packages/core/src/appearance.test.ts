import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  APPEARANCES,
  DEFAULT_THEME,
  appearanceAccent,
  readAppearance,
  storedAppearance,
} from "./index.ts";

describe("readAppearance", () => {
  test("a fresh install (nothing stored) follows Android, as Wave always has", () => {
    assert.equal(readAppearance(null), "system");
  });

  test("a stored choice comes back", () => {
    assert.equal(readAppearance("light"), "light");
    assert.equal(readAppearance("dark"), "dark");
    assert.equal(readAppearance("system"), "system");
  });

  test("anything else stored falls back to System", () => {
    assert.equal(readAppearance("Dark"), "system");
    assert.equal(readAppearance(""), "system");
    assert.equal(readAppearance('"dark"'), "system");
  });
});

describe("storedAppearance", () => {
  test("System, the default, stores nothing; Light and Dark read back as themselves", () => {
    assert.equal(storedAppearance("system"), null);
    assert.equal(readAppearance(storedAppearance("light")), "light");
    assert.equal(readAppearance(storedAppearance("dark")), "dark");
  });
});

describe("APPEARANCES", () => {
  test("Settings offers System, Light and Dark, in that order", () => {
    assert.deepEqual(
      APPEARANCES.map(({ id, label }) => [id, label]),
      [
        ["system", "System"],
        ["light", "Light"],
        ["dark", "Dark"],
      ],
    );
  });
});

describe("appearanceAccent", () => {
  // The shipped primary: deep teal on light grounds, bright teal on dark.
  const LIGHT_TEAL = "#006a5f";
  const DARK_TEAL = "#59c0ad";

  test("System gives each Android scheme its own tone of the primary", () => {
    assert.deepEqual(appearanceAccent(DEFAULT_THEME, "system"), {
      light: LIGHT_TEAL,
      dark: DARK_TEAL,
    });
  });

  test("Light and Dark keep their tone whatever Android's scheme", () => {
    assert.deepEqual(appearanceAccent(DEFAULT_THEME, "light"), {
      light: LIGHT_TEAL,
      dark: LIGHT_TEAL,
    });
    assert.deepEqual(appearanceAccent(DEFAULT_THEME, "dark"), {
      light: DARK_TEAL,
      dark: DARK_TEAL,
    });
  });
});
