import assert from "node:assert/strict";
import { test } from "node:test";

import { selfInstallSpikeApkUrl, selfInstallSpikeAvailable } from "./selfInstallSpike.ts";

test("the trigger shows on PR and ti builds", () => {
  for (const buildLabel of ["PR #900 @ 90970e3", "ti @ 1a2b3c4", "v0.47.0-ti @ 1a2b3c4"]) {
    assert.equal(selfInstallSpikeAvailable({ dev: false, buildLabel }), true, buildLabel);
  }
});

test("the trigger never shows on a stable build", () => {
  for (const buildLabel of ["main @ 1a2b3c4", "v0.47.0 @ 1a2b3c4", "1a2b3c4", undefined]) {
    assert.equal(selfInstallSpikeAvailable({ dev: false, buildLabel }), false, String(buildLabel));
  }
});

test("a debug build shows the trigger without a label", () => {
  assert.equal(selfInstallSpikeAvailable({ dev: true, buildLabel: undefined }), true);
});

test("the URL starts at the rolling APK of the build's own channel", () => {
  assert.equal(
    selfInstallSpikeApkUrl("PR #900 @ 90970e3"),
    "https://github.com/LeoPerez8/wave/releases/download/pr-900/wave-pr-900.apk",
  );
  assert.equal(
    selfInstallSpikeApkUrl("ti @ 1a2b3c4"),
    "https://github.com/LeoPerez8/wave/releases/download/ti-latest/wave-ti.apk",
  );
  assert.equal(selfInstallSpikeApkUrl(undefined), "");
});
