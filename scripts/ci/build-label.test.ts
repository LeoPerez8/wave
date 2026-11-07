import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { buildLabel } from "./build-label.ts";

const sha = "90970e36a1b2c3d4e5f60718293a4b5c6d7e8f90";

describe("buildLabel", () => {
  it("names a push's branch and short commit", () => {
    assert.equal(buildLabel({ refName: "ti", sha }), "ti @ 90970e3");
    assert.equal(buildLabel({ refName: "main", sha }), "main @ 90970e3");
  });

  it("names a tag's run by its tag", () => {
    assert.equal(buildLabel({ refName: "v0.11.0-ti", sha }), "v0.11.0-ti @ 90970e3");
  });

  it("is only the short commit without a ref", () => {
    assert.equal(buildLabel({ refName: "", sha }), "90970e3");
  });

  it("fails without a commit", () => {
    assert.throws(() => buildLabel({ refName: "", sha: "" }), /commit/);
  });
});

describe("the build-label command", () => {
  it("prints Expo's public variable for $GITHUB_ENV from the run's environment", () => {
    const out = execFileSync(
      process.execPath,
      [fileURLToPath(new URL("./build-label.ts", import.meta.url))],
      {
        env: { GITHUB_REF_NAME: "main", HEAD_SHA: sha },
        encoding: "utf8",
      },
    );
    assert.equal(out, "EXPO_PUBLIC_WAVE_BUILD_LABEL=main @ 90970e3\n");
  });
});
