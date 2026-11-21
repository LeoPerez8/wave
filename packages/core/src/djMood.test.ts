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

  test("a Library song ranks by the features of its ISRC tag, else stays neutral", () => {
    const loud = { energy: 0.9, valence: 0.5, acousticness: 0.1, mode: 1 as const };
    const calm = { energy: 0.1, valence: 0.5, acousticness: 0.8, mode: 1 as const };
    const ranked = djMoodRanked(
      [
        { trackId: "1", source: "library" as const, score: 10, song: null },
        { trackId: "2", source: "library" as const, score: 10, song: null, genre: "Nu Metal" },
        { trackId: "3", source: "library" as const, score: 10, song: { videoId: "matched" } },
        { trackId: "4", source: "library" as const, score: 10, song: null },
      ],
      "energetic",
      new Map(),
      new Map(),
      new Map([
        ["1", calm],
        ["3", loud],
      ]),
    );
    assert.deepEqual(
      ranked.map(({ trackId }) => trackId),
      ["3", "2", "4", "1"],
    );
    assert.equal(ranked[1]!.score, 10);
  });

  test("a stream song's own features come before its Library match's", () => {
    const ranked = djMoodRanked(
      [{ trackId: "1", source: "library" as const, score: 10, song: { videoId: "v" } }],
      "energetic",
      new Map([["v", { energy: 0.9, valence: 0.5, acousticness: 0.1, mode: 1 as const }]]),
      new Map(),
      new Map([["1", { energy: 0.1, valence: 0.5, acousticness: 0.8, mode: 1 as const }]]),
    );
    assert.ok(ranked[0]!.score > 10);
  });
});
