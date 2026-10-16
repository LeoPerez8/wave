/// <reference types="node" />
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { AndroidConfig } from "expo/config-plugins";

import { addBuildCacheProperties } from "./gradleProperties.ts";

type Properties = AndroidConfig.Properties.PropertiesItem[];

/** The parts of prebuild's gradle.properties that matter here. */
const prebuildProperties = (): Properties => [
  { type: "comment", value: " Specifies the JVM arguments used for the daemon process." },
  { type: "property", key: "org.gradle.jvmargs", value: "-Xmx2048m -XX:MaxMetaspaceSize=512m" },
  { type: "empty" },
  { type: "property", key: "org.gradle.parallel", value: "true" },
  { type: "property", key: "android.useAndroidX", value: "true" },
];

const values = (properties: Properties, key: string): string[] =>
  properties.flatMap((p) => (p.type === "property" && p.key === key ? [p.value] : []));

describe("addBuildCacheProperties", () => {
  test("turns on Gradle's build cache", () => {
    assert.deepEqual(values(addBuildCacheProperties(prebuildProperties()), "org.gradle.caching"), [
      "true",
    ]);
  });

  test("gives Gradle a 4 GB heap instead of prebuild's 2 GB, keeping its other JVM flags", () => {
    assert.deepEqual(values(addBuildCacheProperties(prebuildProperties()), "org.gradle.jvmargs"), [
      "-Xmx4g -XX:MaxMetaspaceSize=512m",
    ]);
  });

  test("running prebuild again leaves the properties as the first run wrote them", () => {
    const once = addBuildCacheProperties(prebuildProperties());
    assert.deepEqual(addBuildCacheProperties(addBuildCacheProperties(prebuildProperties())), once);
  });
});
