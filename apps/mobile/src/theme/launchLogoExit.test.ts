/// <reference types="node" />
// The launch splash leaves natively, as Android hands it to the app, so the
// timing is mirrored in Kotlin (`LaunchLogoExit.kt`, which has Core's cases as
// JVM tests). This fails when its numbers drift from Core's `LAUNCH_LOGO`, the
// source the splash's moving logo is built from too.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

import { LAUNCH_LOGO } from "@wave/core";

const kotlin = readFileSync(
  new URL(
    "../../modules/wave-native/android/src/main/java/expo/modules/wavenative/launch/LaunchLogoExit.kt",
    import.meta.url,
  ),
  "utf8",
);

const constant = (name: string): number => {
  const match = new RegExp(`const val ${name} = ([\\d_]+)L`).exec(kotlin);
  assert.ok(match, `LaunchLogoExit.kt declares ${name}`);
  return Number(match[1]!.replaceAll("_", ""));
};

describe("LaunchLogoExit.kt", () => {
  test("keeps the native fade duration in step with Core", () => {
    assert.equal(constant("FADE_MS"), LAUNCH_LOGO.fadeMs);
  });
});
