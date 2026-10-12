import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { withOpacity } from "./index.ts";

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
