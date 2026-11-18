/// <reference types="node" />
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { includeKotlinShared } from "./kotlinShared.ts";

/** The end of prebuild's settings.gradle. */
const prebuildSettings = `rootProject.name = 'Wave'

include ':app'
includeBuild(expoAutolinking.reactNativeGradlePlugin)
`;

const includes = (settings: string): string[] =>
  settings.split("\n").filter((line) => line.includes("packages/kotlin-shared"));

describe("includeKotlinShared", () => {
  test("includes packages/kotlin-shared as a build of its own, from the repo root", () => {
    assert.deepEqual(includes(includeKotlinShared(prebuildSettings)), [
      "includeBuild(new File(rootDir, '../../../packages/kotlin-shared'))",
    ]);
  });

  test("keeps what prebuild wrote", () => {
    assert.ok(includeKotlinShared(prebuildSettings).startsWith(prebuildSettings));
  });

  test("running prebuild again leaves the settings as the first run wrote them", () => {
    const once = includeKotlinShared(prebuildSettings);
    assert.equal(includeKotlinShared(once), once);
  });
});
