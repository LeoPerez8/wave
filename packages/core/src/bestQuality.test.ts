import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { settleBestQuality } from "./index.ts";

describe("settleBestQuality", () => {
  test("a pulled on the native switch doesn't show yet turns it on", () => {
    assert.equal(settleBestQuality({ synced: true, native: false, pulled: true }), "turnOn");
  });

  test("a pulled value the native switch shows is in place", () => {
    assert.equal(settleBestQuality({ synced: true, native: true, pulled: true }), "applied");
    assert.equal(settleBestQuality({ synced: false, native: false, pulled: true }), "applied");
  });

  test("a pulled off the native switch doesn't show yet turns it off", () => {
    assert.equal(settleBestQuality({ synced: false, native: true, pulled: true }), "turnOff");
  });

  test("a switch that went off natively under a synced on (Soulseek rejected the account) turns the synced copy off", () => {
    assert.equal(settleBestQuality({ synced: true, native: false, pulled: false }), "wentOff");
  });

  test("a switch that agrees with the synced copy needs nothing", () => {
    assert.equal(settleBestQuality({ synced: true, native: true, pulled: false }), "none");
    assert.equal(settleBestQuality({ synced: false, native: false, pulled: false }), "none");
  });

  test("an upgraded phone's switch, on under a synced copy it never set, stays on and isn't sent up", () => {
    assert.equal(settleBestQuality({ synced: false, native: true, pulled: false }), "none");
  });
});
