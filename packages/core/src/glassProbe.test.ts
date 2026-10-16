import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { DEFAULT_GLASS_SETTINGS, GLASS_PROBES, glassLayers, readGlassProbe } from "./index.ts";

const TUNED = { blur: 30, refraction: 6, tint: 90, rim: false };

describe("glassLayers", () => {
  test("without a probe, the glass is what Settings says: live backdrop, blur and refraction", () => {
    assert.deepEqual(glassLayers(DEFAULT_GLASS_SETTINGS), {
      backdrop: true,
      blur: 24,
      refraction: 12,
      coalesce: false,
    });
    assert.deepEqual(glassLayers(TUNED, "live"), {
      backdrop: true,
      blur: 30,
      refraction: 6,
      coalesce: false,
    });
  });

  test("each probe peels off one layer, so neighbours differ by a single cost", () => {
    // live − blur = refraction; blur − record = blur; record − off = recording the backdrop.
    assert.deepEqual(glassLayers(TUNED, "blur"), {
      backdrop: true,
      blur: 30,
      refraction: 0,
      coalesce: false,
    });
    assert.deepEqual(glassLayers(TUNED, "record"), {
      backdrop: true,
      blur: 0,
      refraction: 0,
      coalesce: false,
    });
    assert.deepEqual(glassLayers(TUNED, "off"), {
      backdrop: false,
      blur: 0,
      refraction: 0,
      coalesce: false,
    });
  });

  test("coalesced keeps the look of live and only changes how the backdrop is recorded", () => {
    assert.deepEqual(glassLayers(TUNED, "coalesced"), {
      backdrop: true,
      blur: 30,
      refraction: 6,
      coalesce: true,
    });
  });
});

describe("readGlassProbe", () => {
  test("reads every probe by name", () => {
    assert.deepEqual(
      ["live", "coalesced", "blur", "record", "off"].map(readGlassProbe),
      ["live", "coalesced", "blur", "record", "off"],
    );
    assert.deepEqual([...GLASS_PROBES].sort(), ["blur", "coalesced", "live", "off", "record"]);
  });

  test("no probe or an unknown one is null, so the caller falls back to the shipped glass", () => {
    assert.equal(readGlassProbe(null), null);
    assert.equal(readGlassProbe(undefined), null);
    assert.equal(readGlassProbe(""), null);
    assert.equal(readGlassProbe("OFF"), null);
    assert.equal(readGlassProbe("none"), null);
    assert.equal(readGlassProbe(3), null);
  });
});
