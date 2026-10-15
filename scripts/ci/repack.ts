// A PR whose native side matches a kept full build gets its APK by swapping a new JS bundle
// into that build (repack.sh), without Gradle. This module holds the decisions:
//   node scripts/ci/repack.ts key <app dir> <Metro's assets dir>   `key=` for the kept APK
//                                                    (after prebuild and bundle.sh)
//   node scripts/ci/repack.ts plan                   `APK_BUILD=full|repack` and why, for $GITHUB_ENV
//   node scripts/ci/repack.ts hermes-flags <app/build.gradle>  hermesc's flags, one per line
// `plan` reads GITHUB_EVENT_NAME, GITHUB_REF, IS_RELEASE and KEPT (the cache hit, 'true' or not).
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const sha256 = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");

// Files under `dir` whose relative paths pass `keep`, skipping directories `skipDir` names.
const files = (
  dir: string,
  skipDir: (name: string) => boolean,
  keep: (path: string) => boolean,
  prefix = "",
): string[] =>
  readdirSync(join(dir, prefix), { withFileTypes: true }).flatMap((entry) => {
    const path = prefix + entry.name;
    if (entry.isDirectory())
      return skipDir(entry.name) ? [] : files(dir, skipDir, keep, `${path}/`);
    return keep(path) ? [path] : [];
  });

// One hash for a set of files, from their paths and contents.
const digest = (dir: string, paths: readonly string[]) =>
  sha256(
    [...paths]
      .sort()
      .map((path) => `${path}\0${sha256(readFileSync(join(dir, path)))}\n`)
      .join(""),
  );

// Build output and tool state inside the generated project, not prebuild's output.
const PROJECT_STATE = new Set(["build", ".gradle", ".cxx", ".kotlin"]);
// Folders of the app that hold no image assets of its own.
const NOT_APP_ASSETS = new Set(["android", "ios", "node_modules"]);
const IMAGE = /\.(avif|bmp|gif|heic|heif|ico|jpe?g|ktx|png|psd|svg|tiff?|webp)$/i;

/**
 * The key a full build's APK is kept under: what the APK's native side is made of. Expo's
 * native fingerprint (native modules, native dependencies, the app config, config plugins),
 * the Android project prebuild generated in `<appDir>/android` (it also catches what the
 * fingerprint misses, like files a config plugin imports), the app's image assets, and the
 * assets Metro emitted for this bundle. Metro's assets are Android resources that Gradle
 * compiles into the APK, and a JS-only change can add one (an image from a package), so a
 * repack is only safe when they match the kept build's exactly.
 * The CI workflow and scripts are part of the recipe too: build flags and the bundle
 * handoff can change the native APK. Hashing all CI files conservatively rebuilds it
 * after a CI-only change; a TS/TSX-only app change still reuses the key.
 */
export const apkCacheKey = ({
  fingerprint,
  appDir,
  metroAssets,
}: {
  fingerprint: string;
  appDir: string;
  metroAssets: AssetManifest;
}) => {
  const android = join(appDir, "android");
  const project = digest(
    android,
    files(
      android,
      (name) => PROJECT_STATE.has(name),
      () => true,
    ),
  );
  const images = digest(
    appDir,
    files(
      appDir,
      (name) => NOT_APP_ASSETS.has(name) || name.startsWith("."),
      (path) => IMAGE.test(path),
    ),
  );
  // Expo deliberately ignores fields such as the app version for OTA updates. APKs must
  // invalidate on every app config and dependency declaration change, including those.
  const config = digest(
    appDir,
    readdirSync(appDir).filter((path) =>
      /^(package\.json|app\.json|app\.config\.[cm]?[jt]s)$/.test(path),
    ),
  );
  const repo = resolve(appDir, "../..");
  const recipe = digest(repo, [
    ".github/workflows/ci.yml",
    ...files(
      join(repo, "scripts/ci"),
      () => false,
      () => true,
    ).map((path) => `scripts/ci/${path}`),
  ]);
  const metro = sha256(JSON.stringify(Object.entries(metroAssets).sort()));
  return `apk-v1-${sha256(`${fingerprint}\n${project}\n${images}\n${config}\n${recipe}\n${metro}\n`)}`;
};

/** The files Metro wrote to its assets folder (Android resources), by path, with their hashes. */
export type AssetManifest = Record<string, string>;

export const assetManifest = (dir: string): AssetManifest =>
  Object.fromEntries(
    files(
      dir,
      () => false,
      () => true,
    )
      .sort()
      .map((path) => [path, sha256(readFileSync(join(dir, path)))]),
  );

// React Native's flags when app/build.gradle sets none.
const DEFAULT_HERMES_FLAGS = ["-O", "-output-source-map"];

/** The flags the full build passes to hermesc, read from the generated app/build.gradle. */
export const hermesFlags = (buildGradle: string): string[] => {
  const line = /^\s*hermesFlags\s*=\s*\[(.*)\]/m.exec(buildGradle);
  if (!line) return DEFAULT_HERMES_FLAGS;
  return [...(line[1] ?? "").matchAll(/["']([^"']*)["']/g)].map((flag) => flag[1] ?? "");
};

export type ApkPlan = { build: "full" | "repack"; reason: string };

/**
 * Whether this run builds the APK in full or swaps a new JS bundle into a kept full build.
 * `kept` is whether a full build with this run's key was found.
 */
export const planApkBuild = (run: {
  event: string;
  ref: string;
  release: boolean;
  kept: boolean;
}): ApkPlan => {
  const full = (reason: string): ApkPlan => ({ build: "full", reason });
  if (run.release) return full("Release tags always build in full.");
  if (run.ref === "refs/heads/main") return full("Pushes to main always build in full.");
  if (run.event !== "pull_request") return full("Only pull requests repack.");
  if (!run.kept) return full("No full build is kept for this native side yet.");
  return { build: "repack", reason: "Only JS changed since a kept full build." };
};

// Expo's native fingerprint of the app, through the @expo/fingerprint that expo depends on.
const nativeFingerprint = async (appDir: string): Promise<string> => {
  const expo = createRequire(join(appDir, "package.json")).resolve("expo/package.json");
  const { createFingerprintAsync } = createRequire(expo)("@expo/fingerprint");
  const { hash } = await createFingerprintAsync(appDir, { platforms: ["android"] });
  return hash;
};

const cli = async ([command, ...args]: string[]) => {
  switch (command) {
    case "key": {
      const appDir = resolve(args[0] ?? ".");
      const fingerprint = await nativeFingerprint(appDir);
      const metroAssets = assetManifest(args[1] ?? "");
      console.log(`fingerprint=${fingerprint}`);
      console.log(`key=${apkCacheKey({ fingerprint, appDir, metroAssets })}`);
      return;
    }
    case "plan": {
      const plan = planApkBuild({
        event: process.env.GITHUB_EVENT_NAME ?? "",
        ref: process.env.GITHUB_REF ?? "",
        release: process.env.IS_RELEASE === "true",
        kept: process.env.KEPT === "true",
      });
      console.log(`APK_BUILD=${plan.build}`);
      console.log(`APK_BUILD_REASON=${plan.reason}`);
      return;
    }
    case "hermes-flags":
      for (const flag of hermesFlags(readFileSync(args[0] ?? "", "utf8"))) console.log(flag);
      return;
    default:
      throw new Error(`Unknown command: ${command ?? "(none)"}`);
  }
};

if (process.argv[1] === fileURLToPath(import.meta.url)) await cli(process.argv.slice(2));
