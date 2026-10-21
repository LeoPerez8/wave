import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  CENTRE_FRAMING,
  adjustFraming,
  framingSquare,
  framingText,
  framingView,
  MAX_FRAMING_ZOOM,
  panFraming,
  pinchFraming,
  readFraming,
} from "./index.ts";

const LANDSCAPE = { width: 800, height: 600 };
const PORTRAIT = { width: 300, height: 601 };

describe("the square a framing saves", () => {
  test("starts as the photo's centre square", () => {
    assert.deepEqual(framingSquare(LANDSCAPE, CENTRE_FRAMING), { left: 100, top: 0, side: 600 });
    assert.deepEqual(framingSquare(PORTRAIT, CENTRE_FRAMING), { left: 0, top: 150, side: 300 });
  });

  test("zoomed in, is a smaller square around the same centre", () => {
    assert.deepEqual(framingSquare(LANDSCAPE, { zoom: 2, centerX: 0.5, centerY: 0.5 }), {
      left: 250,
      top: 150,
      side: 300,
    });
  });

  test("never leaves the photo, nor zooms out past it or in past the limit", () => {
    assert.deepEqual(framingSquare(LANDSCAPE, { zoom: 1, centerX: 0, centerY: 1 }), {
      left: 0,
      top: 0,
      side: 600,
    });
    assert.deepEqual(framingSquare(LANDSCAPE, { zoom: 0.2, centerX: 0.5, centerY: 0.5 }), {
      left: 100,
      top: 0,
      side: 600,
    });
    assert.equal(framingSquare(LANDSCAPE, { zoom: 50, centerX: 0.5, centerY: 0.5 }).side, 120);
    assert.equal(MAX_FRAMING_ZOOM, 5);
    assert.deepEqual(framingSquare(LANDSCAPE, { zoom: 2, centerX: 1, centerY: 1 }), {
      left: 500,
      top: 300,
      side: 300,
    });
  });
});

describe("the crop screen", () => {
  test("accessible photo adjustments can move, zoom and reset the saved square", () => {
    const left = adjustFraming(LANDSCAPE, CENTRE_FRAMING, "moveLeft");
    assert.deepEqual(framingSquare(LANDSCAPE, left), { left: 160, top: 0, side: 600 });
    const zoomed = adjustFraming(LANDSCAPE, CENTRE_FRAMING, "zoomIn");
    assert.deepEqual(framingSquare(LANDSCAPE, zoomed), { left: 160, top: 60, side: 480 });
    const up = adjustFraming(LANDSCAPE, zoomed, "moveUp");
    assert.deepEqual(framingSquare(LANDSCAPE, up), { left: 160, top: 108, side: 480 });
    assert.deepEqual(adjustFraming(LANDSCAPE, up, "reset"), CENTRE_FRAMING);
    assert.deepEqual(adjustFraming(LANDSCAPE, zoomed, "zoomOut"), CENTRE_FRAMING);
  });
  test("draws the photo so the framing's square fills the crop square", () => {
    assert.deepEqual(framingView(LANDSCAPE, 300, CENTRE_FRAMING), {
      scale: 0.5,
      translateX: -50,
      translateY: 0,
    });
    assert.deepEqual(framingView(LANDSCAPE, 300, { zoom: 2, centerX: 0.5, centerY: 0.5 }), {
      scale: 1,
      translateX: -250,
      translateY: -150,
    });
  });

  test("a drag moves the photo with the finger, as far as the photo goes", () => {
    // 30 dp right at half scale is 60 photo px: the square moves 60 px left.
    const dragged = panFraming(LANDSCAPE, 300, CENTRE_FRAMING, 30, 0);
    assert.deepEqual(framingSquare(LANDSCAPE, dragged), { left: 40, top: 0, side: 600 });
    const far = panFraming(LANDSCAPE, 300, CENTRE_FRAMING, 1_000, 40);
    assert.deepEqual(framingSquare(LANDSCAPE, far), { left: 0, top: 0, side: 600 });
    assert.deepEqual(framingView(LANDSCAPE, 300, far), {
      scale: 0.5,
      translateX: 0,
      translateY: 0,
    });
  });

  test("a pinch zooms around the point between the fingers", () => {
    const centred = pinchFraming(LANDSCAPE, 300, CENTRE_FRAMING, 2, 150, 150);
    assert.deepEqual(framingSquare(LANDSCAPE, centred), { left: 250, top: 150, side: 300 });
    // The crop square's top-left corner shows photo px (100, 0) and keeps showing it.
    const corner = pinchFraming(LANDSCAPE, 300, CENTRE_FRAMING, 2, 0, 0);
    assert.deepEqual(framingSquare(LANDSCAPE, corner), { left: 100, top: 0, side: 300 });
  });

  test("a pinch stops at the photo's edges and at the zoom limit", () => {
    assert.deepEqual(pinchFraming(LANDSCAPE, 300, CENTRE_FRAMING, 0.5, 150, 150), CENTRE_FRAMING);
    const deep = pinchFraming(LANDSCAPE, 300, CENTRE_FRAMING, 100, 150, 150);
    assert.equal(deep.zoom, 5);
  });
});

describe("the framing kept beside the original", () => {
  test("reads back as it was saved, with the original's size", () => {
    const framing = { zoom: 1.5, centerX: 0.4, centerY: 0.6 };
    assert.deepEqual(readFraming(framingText(LANDSCAPE, framing)), { size: LANDSCAPE, framing });
  });

  test("anything unreadable is no framing", () => {
    for (const text of [
      null,
      "",
      "{",
      "[]",
      '{"width":800}',
      '{"width":0,"height":600,"zoom":1,"centerX":0.5,"centerY":0.5}',
    ])
      assert.equal(readFraming(text), null);
  });
});
