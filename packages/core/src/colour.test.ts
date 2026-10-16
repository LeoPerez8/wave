import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { hexToHsv, hsvToHex, parseHexColour, withOpacity } from "./index.ts";

describe("withOpacity", () => {
  test("a #rrggbb colour at an opacity (0–1) becomes #rrggbbaa", () => {
    assert.equal(withOpacity("#006a5f", 0.25), "#006a5f40");
    assert.equal(withOpacity("#006a5f", 0.16), "#006a5f29");
    assert.equal(withOpacity("#121b1d", 1), "#121b1dff");
    assert.equal(withOpacity("#121b1d", 0), "#121b1d00");
  });

  test("an opacity out of range is clamped, and a colour that has one already is replaced", () => {
    assert.equal(withOpacity("#121b1d", 2), "#121b1dff");
    assert.equal(withOpacity("#121b1d", -1), "#121b1d00");
    assert.equal(withOpacity("#121b1d80", 0.25), "#121b1d40");
  });

  test("a colour that isn't hex (not loaded yet: transparent) is left as it is", () => {
    assert.equal(withOpacity("transparent", 0.5), "transparent");
  });
});

describe("parseHexColour", () => {
  test("reads six- and three-digit hex, with or without #, as lowercase #rrggbb", () => {
    assert.equal(parseHexColour("#3A7BD5"), "#3a7bd5");
    assert.equal(parseHexColour("3a7bd5"), "#3a7bd5");
    assert.equal(parseHexColour(" #F0a "), "#ff00aa");
    assert.equal(parseHexColour("f0a"), "#ff00aa");
  });

  test("anything else isn't a colour", () => {
    for (const text of ["", "#", "#12345", "#1234567", "#ggg", "red", "#3a7bd580"])
      assert.equal(parseHexColour(text), null, text);
  });
});

describe("hsvToHex and hexToHsv", () => {
  test("hue in degrees, saturation and value 0–1, to hex", () => {
    assert.equal(hsvToHex({ h: 0, s: 1, v: 1 }), "#ff0000");
    assert.equal(hsvToHex({ h: 120, s: 1, v: 1 }), "#00ff00");
    assert.equal(hsvToHex({ h: 240, s: 1, v: 0.5 }), "#000080");
    assert.equal(hsvToHex({ h: 30, s: 0, v: 1 }), "#ffffff");
    assert.equal(hsvToHex({ h: 360, s: 1, v: 1 }), "#ff0000");
  });

  test("hex back to hue, saturation and value", () => {
    assert.deepEqual(hexToHsv("#ff0000"), { h: 0, s: 1, v: 1 });
    assert.deepEqual(hexToHsv("#000080"), { h: 240, s: 1, v: 128 / 255 });
    assert.deepEqual(hexToHsv("#ffffff"), { h: 0, s: 0, v: 1 });
    assert.deepEqual(hexToHsv("#000000"), { h: 0, s: 0, v: 0 });
  });

  test("a colour survives the round trip", () => {
    for (const hex of ["#3a7bd5", "#ff00aa", "#14b7a6", "#f5b83d", "#0a0f1f"])
      assert.equal(hsvToHex(hexToHsv(hex)), hex);
  });
});
