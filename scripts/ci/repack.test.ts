import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { describe, it } from "node:test";
import { apkCacheKey, assetManifest, hermesFlags, planApkBuild } from "./repack.ts";

// A directory holding `files` (path → contents).
const tree = (files: Record<string, string>): string => {
  const root = mkdtempSync(join(tmpdir(), "wave-repack-"));
  for (const [path, contents] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), contents);
  }
  return root;
};

// An app folder after prebuild: sources, image assets and the generated android project.
const app = (files: Record<string, string> = {}) => {
  const appFiles = {
    "src/app/index.tsx": "export default () => null;",
    "assets/icon.png": "icon",
    "package.json": '{"dependencies":{"expo-constants":"~58.0.10"}}',
    "android/app/build.gradle": "react {}",
    "android/app/src/main/AndroidManifest.xml": "<manifest/>",
    ...files,
  };
  const root = tree({
    ".github/workflows/ci.yml":
      "run: ./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a",
    "scripts/ci/prebuilt-bundle.gradle": "// verify the bundle handoff",
    "scripts/ci/bundle.sh": "pnpm exec expo export --platform android",
    ...Object.fromEntries(
      Object.entries(appFiles).map(([path, contents]) => [`apps/mobile/${path}`, contents]),
    ),
  });
  return join(root, "apps/mobile");
};

// Metro's assets folder (Android resources) for a bundle.
const metro = (files: Record<string, string> = { "drawable-mdpi/src_assets_cover.png": "cover" }) =>
  assetManifest(tree(files));

const key = (appDir: string, fingerprint = "f1", metroAssets = metro()) =>
  apkCacheKey({ fingerprint, appDir, metroAssets });

const pr = { event: "pull_request", ref: "refs/pull/7/merge", release: false, kept: true };

describe("planApkBuild", () => {
  it("repacks a PR whose native side matches a kept full build", () => {
    assert.equal(planApkBuild(pr).build, "repack");
  });

  it("builds in full when no full build is kept for the PR's native side", () => {
    assert.equal(planApkBuild({ ...pr, kept: false }).build, "full");
  });

  it("always builds a release tag in full", () => {
    const tag = { event: "push", ref: "refs/tags/v0.5.0", release: true, kept: true };
    assert.deepEqual(planApkBuild(tag), {
      build: "full",
      reason: "Release tags always build in full.",
    });
  });

  it("always builds a push to main in full", () => {
    const main = { event: "push", ref: "refs/heads/main", release: false, kept: true };
    assert.deepEqual(planApkBuild(main), {
      build: "full",
      reason: "Pushes to main always build in full.",
    });
  });

  it("only repacks pull requests", () => {
    const other = { event: "workflow_dispatch", ref: "refs/heads/x", release: false, kept: true };
    assert.equal(planApkBuild(other).build, "full");
  });
});

describe("apkCacheKey", () => {
  it("changes when CI builds another native architecture", () => {
    const dir = app();
    const previous = key(dir);
    writeFileSync(
      resolve(dir, "../../.github/workflows/ci.yml"),
      "run: ./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a,x86_64",
    );
    assert.notEqual(key(dir), previous);
  });

  it("changes when a native build script changes", () => {
    const dir = app();
    const previous = key(dir);
    writeFileSync(
      resolve(dir, "../../scripts/ci/prebuilt-bundle.gradle"),
      "// a different handoff",
    );
    assert.notEqual(key(dir), previous);
  });

  it("doesn't change when only JS or TS changes", () => {
    const before = app();
    const after = app({
      "src/app/index.tsx": "export default () => 'changed';",
      "src/new.ts": "export {};",
    });
    assert.equal(key(after), key(before));
  });

  it("changes with Expo's native fingerprint", () => {
    const dir = app();
    assert.notEqual(key(dir, "f2"), key(dir, "f1"));
  });

  it("changes when the app declares another native dependency version", () => {
    const changed = app({
      "package.json": '{"dependencies":{"expo-constants":"~58.0.11"}}',
    });
    assert.notEqual(key(changed), key(app()));
  });

  // What config plugins generate, including files they import that the fingerprint misses.
  for (const [path, contents] of [
    ["android/app/build.gradle", 'react { hermesFlags = ["-O"] }'],
    ["android/app/src/main/res/drawable/ic_launcher_teal_coral_foreground.xml", "<vector/>"],
    ["android/gradle.properties", "org.gradle.caching=true"],
  ]) {
    it(`changes when prebuild generates a different ${path}`, () => {
      assert.notEqual(key(app({ [path]: contents })), key(app()));
    });
  }

  it("ignores build output and tool state in the generated project", () => {
    const built = app({
      "android/app/build/outputs/apk/release/app-release.apk": "apk",
      "android/.gradle/8.14/checksums.bin": "x",
      "android/app/.cxx/RelWithDebInfo/build.ninja": "x",
    });
    assert.equal(key(built), key(app()));
  });

  // A JS-only change can make Metro emit another resource, such as an image from a package.
  // Those are compiled into the APK, so they need a full build kept under its own key.
  it("changes when Metro emits another asset", () => {
    const dir = app();
    const withIcon = metro({
      "drawable-mdpi/src_assets_cover.png": "cover",
      "drawable-mdpi/node_modules_exporouter_assets_error.png": "error",
    });
    assert.notEqual(key(dir, "f1", withIcon), key(dir));
  });

  it("changes when an asset Metro emits changes", () => {
    const dir = app();
    const redrawn = metro({ "drawable-mdpi/src_assets_cover.png": "redrawn" });
    assert.notEqual(key(dir, "f1", redrawn), key(dir));
  });

  it("ignores images in node_modules", () => {
    assert.equal(key(app({ "node_modules/expo-router/assets/error.png": "x" })), key(app()));
  });

  for (const path of [
    "assets/icon.png",
    "src/components/cover.webp",
    "assets/new.jpg",
    "assets/new.avif",
    "assets/new.svg",
  ]) {
    it(`changes when the image asset ${path} changes`, () => {
      assert.notEqual(key(app({ [path]: "new pixels" })), key(app()));
    });
  }
});

// The repack compiles the bundle with the flags the full build would use.
describe("hermesFlags", () => {
  it("reads the flags prebuild set in the react block", () => {
    const gradle = 'react {\n    hermesFlags = ["-O"]\n    bundleCommand = "export:embed"\n}';
    assert.deepEqual(hermesFlags(gradle), ["-O"]);
  });

  it("reads several flags", () => {
    const gradle = "react {\n  hermesFlags = ['-O', '-output-source-map']\n}";
    assert.deepEqual(hermesFlags(gradle), ["-O", "-output-source-map"]);
  });

  it("falls back to React Native's default when none are set", () => {
    const gradle = 'react {\n    // hermesFlags = ["-O", "-output-source-map"]\n}';
    assert.deepEqual(hermesFlags(gradle), ["-O", "-output-source-map"]);
  });
});
