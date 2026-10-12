import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { SHORTCUT_TAB_CHOICES, parseShortcutTab, tabBarTabs } from "./index.ts";

describe("shortcut tab", () => {
  test("Settings offers None, then the Library sections in Library order", () => {
    assert.deepEqual(SHORTCUT_TAB_CHOICES, [
      null,
      "playlists",
      "artists",
      "albums",
      "songs",
      "genres",
      "folders",
      "favorites",
    ]);
  });

  test("a fresh install (nothing stored) has no shortcut", () => {
    assert.equal(parseShortcutTab(null), null);
  });

  test("a stored section comes back as that section", () => {
    assert.equal(parseShortcutTab("albums"), "albums");
    assert.equal(parseShortcutTab("favorites"), "favorites");
  });

  test("anything else stored (None, a removed section, junk) means no shortcut", () => {
    assert.equal(parseShortcutTab(""), null);
    assert.equal(parseShortcutTab("none"), null);
    assert.equal(parseShortcutTab("podcasts"), null);
  });

  test("without a shortcut the bar is exactly Home, Library, Search", () => {
    assert.deepEqual(tabBarTabs(null), ["index", "library", "search"]);
  });

  test("a shortcut sits after Library, before the Search pill", () => {
    assert.deepEqual(tabBarTabs("artists"), ["index", "library", "shortcut", "search"]);
  });
});
