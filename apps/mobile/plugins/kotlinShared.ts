/**
 * The phone's share of `packages/kotlin-shared` (#1144): the Kotlin the desktop app also runs (the
 * YT Music client, Soulseek, downloads and tags). `withKotlinShared.ts` applies this at prebuild,
 * since the android folder isn't checked in; wave-native then depends on
 * `dev.leoperez.wave:kotlin-shared`, which Gradle builds from that folder.
 */

/** From apps/mobile/android, where settings.gradle sits. */
const INCLUDE = "includeBuild(new File(rootDir, '../../../packages/kotlin-shared'))";

/** Adds the shared Kotlin as an included build, once. */
export const includeKotlinShared = (settings: string): string =>
  settings.includes(INCLUDE)
    ? settings
    : `${settings}${settings.endsWith("\n") ? "" : "\n"}\n// Kotlin shared with Wave desktop (#1144).\n${INCLUDE}\n`;
