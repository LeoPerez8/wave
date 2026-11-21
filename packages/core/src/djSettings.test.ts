import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { DEFAULT_DJ_SETTINGS, djMixSliders, djNewMusicShare, parseDjSettings } from "./index.ts";

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
    } as const;
    assert.deepEqual(parseDjSettings(JSON.parse(JSON.stringify(chosen))), chosen);
    assert.deepEqual(parseDjSettings(null), DEFAULT_DJ_SETTINGS);
    assert.deepEqual(parseDjSettings({ variety: "toString", discovery: 3, newReleases: "yes" }), {
      ...DEFAULT_DJ_SETTINGS,
    });
  });
});
