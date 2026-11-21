/**
 * Gradle settings for the generated Android project. `withGradleBuildCache.ts`
 * applies these at prebuild, since the android folder isn't checked in (#185).
 */
import type { AndroidConfig } from "expo/config-plugins";

type Properties = AndroidConfig.Properties.PropertiesItem[];

const CACHING = "org.gradle.caching";
const JVM_ARGS = "org.gradle.jvmargs";

/** CI runners have 16 GB; prebuild's 2 GB default leaves Gradle short on a release build. */
const HEAP = "-Xmx4g";

/**
 * Prebuild's 512 MB of class metadata ran out in a full release build's ART profile step, and
 * the out-of-memory Gradle then hung instead of exiting.
 */
const METASPACE = "-XX:MaxMetaspaceSize=1g";

const withHeap = (jvmargs: string): string =>
  [
    HEAP,
    METASPACE,
    ...jvmargs
      .split(/\s+/)
      .filter(
        (arg) => arg !== "" && !arg.startsWith("-Xmx") && !arg.startsWith("-XX:MaxMetaspaceSize="),
      ),
  ].join(" ");

/**
 * Turns on Gradle's build cache, so a build reuses task outputs from earlier
 * builds, and raises Gradle's heap and class-metadata limit. Replaces the setting from an earlier run.
 */
export const addBuildCacheProperties = (properties: Properties): Properties => [
  ...properties
    .filter((p) => !(p.type === "property" && p.key === CACHING))
    .map((p) =>
      p.type === "property" && p.key === JVM_ARGS ? { ...p, value: withHeap(p.value) } : p,
    ),
  { type: "property", key: CACHING, value: "true" },
];
