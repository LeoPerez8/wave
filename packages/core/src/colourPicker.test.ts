import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { colourPickerLayout, colourPickerMarkers, colourPickerTarget, pickColour } from "./index.ts";

const layout = colourPickerLayout(200);
const { centre, ringRadius, square } = layout;

const near = (actual: number, expected: number) =>
  assert.ok(Math.abs(actual - expected) < 1e-6, `${actual} vs ${expected}`);

describe("colourPickerLayout", () => {
  test("a hue ring around the edge and a saturation and brightness square inside it", () => {
    assert.equal(centre, 100);
    assert.ok(ringRadius + layout.ringWidth / 2 <= 100);
    // The square's corners stay clear of the ring.
    const corner = Math.hypot(square.side / 2, square.side / 2);
    assert.ok(corner < ringRadius - layout.ringWidth / 2);
    near(square.left + square.side / 2, centre);
    near(square.top + square.side / 2, centre);
  });
});

describe("colourPickerTarget", () => {
  test("a touch on the ring picks the hue, inside the square the shade, elsewhere nothing", () => {
    assert.equal(colourPickerTarget(layout, centre + ringRadius, centre), "ring");
    assert.equal(colourPickerTarget(layout, centre, centre), "square");
    assert.equal(colourPickerTarget(layout, 2, 2), null);
    // Between the square's corner and the ring.
    const corner = (square.side / 2) * Math.SQRT2;
    const between = (corner + ringRadius - layout.ringWidth / 2) / 2 / Math.SQRT2;
    assert.equal(colourPickerTarget(layout, centre + between, centre + between), null);
  });
});

describe("pickColour", () => {
  const hsv = { h: 200, s: 0.5, v: 0.5 };

  test("on the ring, the angle is the hue: red to the right, clockwise", () => {
    near(pickColour(layout, "ring", centre + ringRadius, centre, hsv).h, 0);
    near(pickColour(layout, "ring", centre, centre + ringRadius, hsv).h, 90);
    near(pickColour(layout, "ring", centre - ringRadius, centre, hsv).h, 180);
    near(pickColour(layout, "ring", centre, centre - ringRadius, hsv).h, 270);
    // Saturation and brightness stay.
    assert.deepEqual(pickColour(layout, "ring", centre, centre + 10, hsv), { ...hsv, h: 90 });
  });

  test("in the square, saturation grows to the right and brightness upward", () => {
    const at = (x: number, y: number) => pickColour(layout, "square", x, y, hsv);
    assert.deepEqual(at(square.left, square.top), { h: 200, s: 0, v: 1 });
    assert.deepEqual(at(square.left + square.side, square.top + square.side), { h: 200, s: 1, v: 0 });
    near(at(centre, centre).s, 0.5);
    near(at(centre, centre).v, 0.5);
  });

  test("a drag that leaves the square keeps to its edge", () => {
    assert.deepEqual(pickColour(layout, "square", -50, 500, hsv), { h: 200, s: 0, v: 0 });
  });
});

describe("colourPickerMarkers", () => {
  test("the ring's marker sits on the ring at the hue, the square's at the shade", () => {
    const markers = colourPickerMarkers(layout, { h: 90, s: 1, v: 1 });
    near(markers.ring.x, centre);
    near(markers.ring.y, centre + ringRadius);
    near(markers.square.x, square.left + square.side);
    near(markers.square.y, square.top);
  });

  test("a marker put back where it points picks the same colour", () => {
    const hsv = { h: 300, s: 0.25, v: 0.75 };
    const markers = colourPickerMarkers(layout, hsv);
    near(pickColour(layout, "ring", markers.ring.x, markers.ring.y, hsv).h, 300);
    const shade = pickColour(layout, "square", markers.square.x, markers.square.y, hsv);
    near(shade.s, 0.25);
    near(shade.v, 0.75);
  });
});
