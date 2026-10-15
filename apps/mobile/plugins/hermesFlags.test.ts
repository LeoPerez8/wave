/// <reference types="node" />
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { compileHermesWithoutSourceMap } from "./hermesFlags.ts";

/** The part of prebuild's app/build.gradle that matters here. */
const prebuildAppBuildGradle = `react {
    bundleCommand = "export:embed"

    /* Hermes Commands */
    //   The hermes compiler command to run. By default it is 'hermesc'
    // hermesCommand = "$rootDir/my-custom-hermesc/bin/hermesc"
    //
    //   The list of flags to pass to the Hermes compiler. By default is "-O", "-output-source-map"
    // hermesFlags = ["-O", "-output-source-map"]

    /* Autolinking */
    autolinkLibrariesWithApp()
}
`;

const settings = (gradle: string, key: string): string[] =>
  gradle
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith(`${key} =`));

describe("compileHermesWithoutSourceMap", () => {
  test("keeps Hermes' optimiser and drops the source map", () => {
    assert.deepEqual(settings(compileHermesWithoutSourceMap(prebuildAppBuildGradle), "hermesFlags"), [
      'hermesFlags = ["-O"]',
    ]);
  });

  test("sets the flags once when prebuild runs again on its output", () => {
    const twice = compileHermesWithoutSourceMap(compileHermesWithoutSourceMap(prebuildAppBuildGradle));
    assert.deepEqual(settings(twice, "hermesFlags"), ['hermesFlags = ["-O"]']);
  });

  test("fails prebuild when the react block is missing, rather than keep the slow default", () => {
    assert.throws(() => compileHermesWithoutSourceMap("android {\n}\n"), /react \{/);
  });
});
