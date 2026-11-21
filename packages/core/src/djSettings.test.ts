import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { catalogueOf } from "./localisation.ts";
import {
  DEFAULT_DJ_SETTINGS,
  DJ_FILTERS,
  DJ_MOOD_FILTERS,
  djFilterOn,
  djMixSliders,
  djNewMusicShare,
  djToggleFilter,
  djToggleMood,
  parseDjSettings,
  type DjSettings,
} from "./index.ts";

describe("DJ's ranking choices", () => {
  test("Music discovery sets the New music share a session starts at", () => {
    const share = (discovery: "familiar" | "blend" | "discover") =>
      djNewMusicShare({ ...DEFAULT_DJ_SETTINGS, discovery });
    assert.deepEqual([share("familiar"), share("blend"), share("discover")], [0.2, 0.6, 1]);
  });

  test("the popularity filters move Popularity, and Genre faithfulness stays in the middle", () => {
    const sliders = (popularity: "trending" | "balanced" | "lesserKnown") =>
      djMixSliders({ ...DEFAULT_DJ_SETTINGS, popularity });
    assert.deepEqual(sliders("trending"), { faithfulness: 3, popularity: 1 });
    assert.deepEqual(sliders("balanced"), { faithfulness: 3, popularity: 3 });
    assert.deepEqual(sliders("lesserKnown"), { faithfulness: 3, popularity: 5 });
  });

  test("saved choices read back, the default standing in for any that isn't one", () => {
    const chosen = {
      variety: "high",
      discovery: "familiar",
      popularity: "trending",
      newReleases: true,
      mood: "energetic",
    } as const;
    assert.deepEqual(parseDjSettings(JSON.parse(JSON.stringify(chosen))), chosen);
    assert.deepEqual(parseDjSettings(null), DEFAULT_DJ_SETTINGS);
    assert.deepEqual(parseDjSettings({ variety: "toString", discovery: 3, newReleases: "yes" }), {
      ...DEFAULT_DJ_SETTINGS,
    });
  });
});

describe("Adjust's filters", () => {
  const on = (settings: DjSettings) => DJ_FILTERS.filter((filter) => djFilterOn(settings, filter));

  test("offers Trending, Lesser-known songs and New releases, all off at first", () => {
    assert.deepEqual(DJ_FILTERS, ["trending", "lesserKnown", "newReleases"]);
    assert.deepEqual(on(DEFAULT_DJ_SETTINGS), []);
  });

  test("Trending and Lesser-known songs turn on one at a time, and off again", () => {
    const trending = djToggleFilter(DEFAULT_DJ_SETTINGS, "trending");
    assert.deepEqual(on(trending), ["trending"]);
    const lesserKnown = djToggleFilter(trending, "lesserKnown");
    assert.deepEqual(on(lesserKnown), ["lesserKnown"]);
    assert.deepEqual(on(djToggleFilter(lesserKnown, "trending")), ["trending"]);
    assert.deepEqual(on(djToggleFilter(lesserKnown, "lesserKnown")), []);
    assert.deepEqual(on(djToggleFilter(trending, "trending")), []);
  });

  test("New releases turns on and off by itself", () => {
    const trending = djToggleFilter(DEFAULT_DJ_SETTINGS, "trending");
    const both = djToggleFilter(trending, "newReleases");
    assert.deepEqual(on(both), ["trending", "newReleases"]);
    assert.deepEqual(on(djToggleFilter(both, "lesserKnown")), ["lesserKnown", "newReleases"]);
    assert.deepEqual(on(djToggleFilter(both, "newReleases")), ["trending"]);
    assert.deepEqual(on(djToggleFilter(DEFAULT_DJ_SETTINGS, "newReleases")), ["newReleases"]);
  });

  test("a filter changes no slider of Adjust", () => {
    const chosen: DjSettings = { ...DEFAULT_DJ_SETTINGS, variety: "high", discovery: "discover" };
    const filtered = djToggleFilter(djToggleFilter(chosen, "lesserKnown"), "newReleases");
    assert.deepEqual([filtered.variety, filtered.discovery], ["high", "discover"]);
  });

  test("their text is in both languages", () => {
    const en = catalogueOf("en").dj;
    assert.equal(en.filters, "Filters");
    assert.deepEqual(en.filterNames, {
      trending: "Trending",
      lesserKnown: "Lesser-known songs",
      newReleases: "New releases",
    });
    const pt = catalogueOf("pt-BR").dj;
    assert.equal(en.mood, "Mood");
    assert.deepEqual(en.moodNames, {
      energetic: "Energetic",
      relaxing: "Relaxing",
      upbeat: "Upbeat",
    });
    assert.equal(pt.mood, "Humor");
    assert.deepEqual(pt.moodNames, {
      energetic: "Agitada",
      relaxing: "Relaxante",
      upbeat: "Animada",
    });
    assert.equal(pt.filters, "Filtros");
    assert.deepEqual(pt.filterNames, {
      trending: "Em alta",
      lesserKnown: "Músicas pouco conhecidas",
      newReleases: "Lançamentos",
    });
  });
});

describe("Adjust's mood filters", () => {
  test("offers three mutually exclusive moods, all off by default, and remembers the choice", () => {
    assert.deepEqual(DJ_MOOD_FILTERS, ["energetic", "relaxing", "upbeat"]);
    assert.equal(DEFAULT_DJ_SETTINGS.mood, null);
    const energetic = djToggleMood(DEFAULT_DJ_SETTINGS, "energetic");
    assert.equal(energetic.mood, "energetic");
    assert.equal(djToggleMood(energetic, "energetic").mood, null);
    assert.equal(djToggleMood(energetic, "relaxing").mood, "relaxing");
    assert.equal(parseDjSettings(JSON.parse(JSON.stringify(energetic))).mood, "energetic");
    assert.equal(parseDjSettings({ mood: "melancholic" }).mood, null);
    assert.equal(parseDjSettings({}).mood, null);
  });
});
