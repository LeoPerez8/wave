import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { sliderFraction, sliderValueAt, snapSliderValue, stepSlider } from "./index.ts";

const TAP = { min: 0, max: 600, step: 20 };

describe("sliderValueAt", () => {
  test("a finger at the middle of a 300 dp track picks the middle of the range", () => {
    assert.equal(sliderValueAt(150, 300, TAP), 300);
  });

  test("snaps to the nearest step", () => {
    assert.equal(sliderValueAt(30, 300, TAP), 60); // exactly 60
    assert.equal(sliderValueAt(35.1, 300, TAP), 80); // 70.2, nearer 80 than 60
    assert.equal(sliderValueAt(34.5, 300, TAP), 60); // 69, nearer 60
  });

  test("a finger past either end holds the end value", () => {
    assert.equal(sliderValueAt(-40, 300, TAP), 0);
    assert.equal(sliderValueAt(420, 300, TAP), 600);
  });

  test("steps count from the minimum, not from zero", () => {
    // 50..100 by 15: steps are 50, 65, 80, 95, and 100 is the last value.
    const range = { min: 50, max: 100, step: 15 };
    assert.equal(sliderValueAt(30, 100, range), 65);
    assert.equal(sliderValueAt(100, 100, range), 100);
  });

  test("a track that has not been laid out yet picks the minimum", () => {
    assert.equal(sliderValueAt(10, 0, TAP), 0);
  });
});

describe("stepSlider", () => {
  test("one increment or decrement moves one step", () => {
    assert.equal(stepSlider(140, 1, TAP), 160);
    assert.equal(stepSlider(140, -1, TAP), 120);
  });

  test("stops at the ends", () => {
    assert.equal(stepSlider(600, 1, TAP), 600);
    assert.equal(stepSlider(0, -1, TAP), 0);
  });

  test("from a max that is off the step grid, a decrement lands on the last step", () => {
    const range = { min: 50, max: 100, step: 15 };
    assert.equal(stepSlider(100, -1, range), 95);
    assert.equal(stepSlider(95, 1, range), 100);
  });

  test("fractional steps don't drift", () => {
    assert.equal(stepSlider(0.2, 1, { min: 0, max: 1, step: 0.1 }), 0.3);
  });
});

describe("sliderFraction", () => {
  test("how far along the track a value sits, from 0 to 1", () => {
    assert.equal(sliderFraction(150, TAP), 0.25);
    assert.equal(sliderFraction(0, TAP), 0);
    assert.equal(sliderFraction(600, TAP), 1);
  });

  test("values outside the range sit at its ends", () => {
    assert.equal(sliderFraction(900, TAP), 1);
    assert.equal(sliderFraction(-20, TAP), 0);
  });
});

describe("snapSliderValue", () => {
  test("a stored value off the grid or out of range comes back onto it", () => {
    assert.equal(snapSliderValue(147, TAP), 140);
    assert.equal(snapSliderValue(9000, TAP), 600);
    assert.equal(snapSliderValue(Number.NaN, TAP), 0);
  });
});
