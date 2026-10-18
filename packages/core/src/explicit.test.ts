import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { explicitFromAdvisory, showsExplicitBadge } from "./index.ts";

describe("explicitFromAdvisory", () => {
  test("an advisory tag of 1 is explicit, 0 is checked and clean", () => {
    assert.equal(explicitFromAdvisory("1"), "explicit");
    assert.equal(explicitFromAdvisory("0"), "clean");
  });

  test("no tag is unknown", () => {
    assert.equal(explicitFromAdvisory(null), "unknown");
    assert.equal(explicitFromAdvisory(undefined), "unknown");
    assert.equal(explicitFromAdvisory(""), "unknown");
  });

  test("iTunes' clean (2) and older explicit (4) values count too", () => {
    assert.equal(explicitFromAdvisory("2"), "clean");
    assert.equal(explicitFromAdvisory("4"), "explicit");
    assert.equal(explicitFromAdvisory(" 1 "), "explicit");
  });

  test("a value that isn't an advisory is unknown", () => {
    assert.equal(explicitFromAdvisory("Explicit?"), "unknown");
    assert.equal(explicitFromAdvisory("3"), "unknown");
  });
});

describe("showsExplicitBadge", () => {
  test("a YT Music song marked explicit shows the badge; a clean one doesn't", () => {
    assert.equal(showsExplicitBadge(true), true);
    assert.equal(showsExplicitBadge(false), false);
  });

  test("a Library song shows it when its index says explicit, never when unknown", () => {
    assert.equal(showsExplicitBadge("explicit"), true);
    assert.equal(showsExplicitBadge("clean"), false);
    assert.equal(showsExplicitBadge("unknown"), false);
  });
});
