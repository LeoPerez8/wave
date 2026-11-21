import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { djMedianAudioFeatures, djMoodRanked, djMoodScore } from "./index.ts";

describe("DJ mood ranking", () => {
  test("ISRC rows use the lower median for each numeric feature", () => {
    assert.deepEqual(
      djMedianAudioFeatures([
        { energy: 0.1, valence: 0.2, acousticness: 0.3, mode: 0 },
        { energy: 0.9, valence: 0.8, acousticness: 0.7, mode: 1 },
        { energy: 0.5, valence: 0.6, acousticness: 0.4, mode: 1 },
        { energy: 0.7, valence: 0.4, acousticness: 0.5, mode: 0 },
      ]),
      { energy: 0.5, valence: 0.4, acousticness: 0.4, mode: 0 },
    );
  });

  test("features favour each mood and lower its opposite", () => {
    const features = (energy: number, valence: number, acousticness: number) => ({
      energy,
      valence,
      acousticness,
      mode: 1 as const,
    });
    assert.ok(djMoodScore("energetic", features(0.9, 0.5, 0.1), null) > 0);
    assert.ok(djMoodScore("energetic", features(0.1, 0.5, 0.1), null) < 0);
    assert.ok(djMoodScore("relaxing", features(0.1, 0.5, 0.9), null) > 0);
    assert.ok(djMoodScore("relaxing", features(0.9, 0.5, 0.1), null) < 0);
    assert.ok(djMoodScore("upbeat", features(0.8, 0.9, 0.1), null) > 0);
    assert.ok(djMoodScore("upbeat", features(0.8, 0.1, 0.1), null) < 0);
  });

  test("missing features use only a known heavy or soft acoustic style", () => {
    assert.ok(djMoodScore("energetic", null, "Nu Metal") > 0);
    assert.ok(djMoodScore("relaxing", null, "Soft Rock") > 0);
    assert.equal(djMoodScore("upbeat", null, "Soft Rock"), 0);
    assert.equal(djMoodScore("energetic", null, null), 0);
  });

  test("cached features rerank songs and unknown entries keep their original score", () => {
    const ranked = djMoodRanked(
      [
        { id: "calm", score: 10, song: { videoId: "calm" } },
        { id: "loud", score: 10, song: { videoId: "loud" } },
        { id: "unknown", score: 10, song: { videoId: "unknown" } },
      ],
      "energetic",
      new Map([
        ["calm", { energy: 0.1, valence: 0.5, acousticness: 0.8, mode: 1 as const }],
        ["loud", { energy: 0.9, valence: 0.5, acousticness: 0.1, mode: 1 as const }],
      ]),
      new Map(),
    );
    assert.deepEqual(
      ranked.map(({ id }) => id),
      ["loud", "unknown", "calm"],
    );
    assert.deepEqual(ranked[1], { id: "unknown", score: 10, song: { videoId: "unknown" } });
  });
});
