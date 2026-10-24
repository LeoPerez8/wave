import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_MIX_SLIDERS,
  GENRE_FAITHFULNESS_STEPS,
  POPULARITY_STEPS,
  readMixSliders,
  sliderStep,
  sliderStepLabel,
  storedMixSliders,
} from "./index.ts";

describe("A section's sliders", () => {
  test("each has five steps named from one end to the other, the middle one the default", () => {
    assert.deepEqual(
      GENRE_FAITHFULNESS_STEPS.map((step) => step.label),
      ["Same genres", "Close", "Balanced", "Neighbours", "Wander"],
    );
    assert.deepEqual(
      POPULARITY_STEPS.map((step) => step.label),
      ["Hits", "Popular", "Balanced", "Lesser known", "Deep cuts"],
    );
    assert.deepEqual(DEFAULT_MIX_SLIDERS, { faithfulness: 3, popularity: 3 });
  });
});

describe("Keeping a section's sliders", () => {
  test("round-trips them; the defaults store nothing", () => {
    const sliders = { faithfulness: 5, popularity: 1 } as const;
    assert.deepEqual(readMixSliders(storedMixSliders(sliders)), sliders);
    assert.equal(storedMixSliders(DEFAULT_MIX_SLIDERS), null);
    assert.deepEqual(readMixSliders(storedMixSliders({ faithfulness: 2, popularity: 3 })), {
      faithfulness: 2,
      popularity: 3,
    });
  });

  test("reads the defaults for nothing stored, and for any slider that isn't a step", () => {
    assert.deepEqual(readMixSliders(null), DEFAULT_MIX_SLIDERS);
    assert.deepEqual(readMixSliders("not json"), DEFAULT_MIX_SLIDERS);
    assert.deepEqual(readMixSliders('{"faithfulness":9,"popularity":4}'), {
      faithfulness: 3,
      popularity: 4,
    });
    assert.deepEqual(readMixSliders('{"faithfulness":2.5,"popularity":"1"}'), DEFAULT_MIX_SLIDERS);
  });
});

describe("A level card slider's position", () => {
  test("lands on the nearest of the five steps, within them", () => {
    assert.deepEqual(
      [0, 1, 2.4, 2.6, 5, 9].map((value) => sliderStep(value)),
      [1, 1, 2, 3, 5, 5],
    );
  });

  test("reads as its step's label", () => {
    assert.equal(sliderStepLabel(GENRE_FAITHFULNESS_STEPS, 1.2), "Same genres");
    assert.equal(sliderStepLabel(POPULARITY_STEPS, 4.8), "Deep cuts");
  });
});
