// A PR whose native side matches a kept full build gets its APK by swapping a new JS bundle
// into that build (repack.sh), without Gradle. This module holds the decisions:
//   node scripts/ci/repack.ts key <app dir>          `key=` for the kept APK (after prebuild)
//   node scripts/ci/repack.ts plan                   `APK_BUILD=full|repack` and why, for $GITHUB_ENV
//   node scripts/ci/repack.ts assets <dir>           Metro's assets folder as JSON, kept with the APK
//   node scripts/ci/repack.ts check-assets <kept.json> <dir>   assets the kept APK lacks, one per line
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
const IMAGE = /\.(png|jpe?g|gif|webp|bmp)$/i;

/**
 * The key a full build's APK is kept under: what the APK's native side is made of. Expo's
 * native fingerprint (native modules, native dependencies, the app config, config plugins),
 * the Android project prebuild generated in `<appDir>/android` (it also catches what the
 * fingerprint misses, like files a config plugin imports), and the app's image assets.
 * Bump the version when the full build's own recipe in ci.yml changes.
 */
export const apkCacheKey = ({ fingerprint, appDir }: { fingerprint: string; appDir: string }) => {
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
  return `apk-v1-${sha256(`${fingerprint}\n${project}\n${images}\n`)}`;
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

/**
 * The assets a new bundle needs that the kept APK doesn't have as they are now. Metro's assets
 * are Android resources, compiled into the APK by Gradle, so a repack can only swap the bundle
 * when this is empty. An asset the bundle stopped using can stay in the APK.
 */
export const assetsNotInKeptApk = (kept: AssetManifest, built: AssetManifest): string[] =>
  Object.keys(built).filter((path) => kept[path] !== built[path]);

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
      console.log(`fingerprint=${fingerprint}`);
      console.log(`key=${apkCacheKey({ fingerprint, appDir })}`);
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
    case "assets":
      console.log(JSON.stringify(assetManifest(args[0] ?? "."), null, 2));
      return;
    case "check-assets": {
      const kept = JSON.parse(readFileSync(args[0] ?? "", "utf8")) as AssetManifest;
      for (const path of assetsNotInKeptApk(kept, assetManifest(args[1] ?? "."))) console.log(path);
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
