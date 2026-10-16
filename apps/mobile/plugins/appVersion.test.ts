/// <reference types="node" />
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { releaseBranch, releaseTagProblem, versionCode } from "./appVersion.ts";

describe("versionCode", () => {
  test("is major × 10000 + minor × 100 + patch", () => {
    assert.equal(versionCode("0.5.0"), 500);
    assert.equal(versionCode("1.2.3"), 10203);
  });

  test("a ti version keeps its numeric versionCode for updates to stable", () => {
    assert.equal(versionCode("0.5.1-ti"), 501);
    assert.equal(versionCode("0.5.1-ti"), versionCode("0.5.1"));
    assert.ok(versionCode("0.5.1-ti") > versionCode("0.5.0"));
  });

  test("rejects a version it can't number without colliding", () => {
    const versions = ["0.100.0", "0.5.100", "0.5", "0.5.0.1", "0.5.0-beta", "v0.5.0", "0.x.0", ""];
    for (const version of versions) {
      assert.throws(() => versionCode(version), /major\.minor\.patch/, version);
    }
  });
});

describe("releaseTagProblem", () => {
  test("a tag naming the app's version is fine", () => {
    assert.equal(releaseTagProblem("v0.5.0", "0.5.0"), undefined);
    assert.equal(releaseTagProblem("v0.5.1-ti", "0.5.1-ti"), undefined);
    assert.ok(releaseTagProblem("v0.5.1", "0.5.1-ti"));
    assert.ok(releaseTagProblem("v0.5.1-ti", "0.5.1"));
  });

  test("a tag naming another version says which version the app is at", () => {
    for (const tag of ["v0.5.1", "v0.4.0", "0.5.0", "v0.5.0-rc1", "v0.5"]) {
      assert.equal(
        releaseTagProblem(tag, "0.5.0"),
        `The tag ${tag} doesn't match the app's version, 0.5.0 (apps/mobile/package.json). ` +
          "Bump the version in a PR first, then tag its merge commit v<version>; " +
          "or tag v0.5.0 to release 0.5.0.",
        tag,
      );
    }
  });
});

test("stable releases belong to main and ti prereleases belong to ti", () => {
  assert.equal(releaseBranch("0.5.1"), "main");
  assert.equal(releaseBranch("0.5.1-ti"), "ti");
});
