import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { changes } from "./changes.ts";

const script = fileURLToPath(new URL("./changes.ts", import.meta.url));
const run = (args: string[], stdin: string) =>
  execFileSync(process.execPath, [script, ...args], { input: stdin, encoding: "utf8" });

describe("changes", () => {
  it("doesn't build the APK for a docs-only change", () => {
    assert.equal(changes(["docs/spec.md", "docs/spotify-samples/track-metadata.json"]).apk, false);
  });

  it("builds the APK when the app changes", () => {
    assert.equal(changes(["docs/spec.md", "apps/mobile/src/app/_layout.tsx"]).apk, true);
  });

  it("checks a sync-service change without building the APK or running native tests", () => {
    const result = changes(["apps/sync/src/worker.ts", "apps/sync/package.json"]);
    assert.equal(result.apk, false);
    assert.equal(result.nativeTests, false);
    assert.equal(result.allPackages, false);
  });

  for (const path of [
    "packages/core/src/queue.ts",
    "package.json",
    "pnpm-workspace.yaml",
    "pnpm-lock.yaml",
    ".github/workflows/ci.yml",
    "scripts/ci/report.sh",
  ]) {
    it(`builds the APK when ${path} changes`, () => {
      assert.equal(changes([path]).apk, true);
    });
  }

  for (const path of [
    "README.md",
    "CLAUDE.md",
    "tsconfig.base.json",
    ".oxlintrc.json",
    "scripts/music-folder/plan.ts",
    "scripts/perf/runner.ts",
    "apps/mobile/DESIGN.md",
    "packages/core/README.md",
  ]) {
    it(`doesn't build the APK when only ${path} changes`, () => {
      assert.equal(changes([path]).apk, false);
    });
  }

  it("runs the native tests when wave-native changes", () => {
    assert.equal(
      changes([
        "apps/mobile/modules/wave-native/android/src/main/java/expo/modules/wavenative/player/SleepTimer.kt",
      ]).nativeTests,
      true,
    );
  });

  for (const path of [
    "apps/mobile/app.config.ts",
    "apps/mobile/plugins/withGradleBuildCache.ts",
    "apps/mobile/package.json",
    "pnpm-lock.yaml",
    ".github/workflows/ci.yml",
    "scripts/ci/step.sh",
  ]) {
    it(`runs the native tests when ${path} changes`, () => {
      assert.equal(changes([path]).nativeTests, true);
    });
  }

  it("doesn't run the native tests for a JS-only change, though it builds the APK", () => {
    const result = changes([
      "apps/mobile/src/app/_layout.tsx",
      "apps/mobile/global.css",
      "apps/mobile/src/services.ts",
      "packages/core/src/queue.ts",
      "apps/mobile/modules/wave-native/NOTES.md",
    ]);
    assert.equal(result.nativeTests, false);
    assert.equal(result.apk, true);
  });

  for (const path of ["apps/mobile/src/app/_layout.tsx", "packages/core/src/queue.ts"]) {
    it(`checks only the affected packages when ${path} changes`, () => {
      assert.equal(changes(["docs/spec.md", path]).allPackages, false);
    });
  }

  for (const path of [
    "package.json",
    "pnpm-workspace.yaml",
    "pnpm-lock.yaml",
    "tsconfig.base.json",
    ".github/workflows/ci.yml",
    "scripts/ci/step.sh",
    "scripts/perf/runner.ts",
  ]) {
    it(`checks every package when ${path} changes`, () => {
      assert.equal(changes(["apps/mobile/src/app/_layout.tsx", path]).allPackages, true);
    });
  }

  it("names each area a change touches", () => {
    assert.deepEqual(changes(["packages/core/src/queue.ts", "pnpm-lock.yaml"]), {
      app: false,
      core: true,
      sync: false,
      workspace: true,
      ci: false,
      perf: false,
      tsconfig: false,
      native: false,
      apk: true,
      allPackages: true,
      nativeTests: true,
    });
    assert.deepEqual(changes(["apps/mobile/app.config.ts", ".github/workflows/ci.yml"]), {
      app: true,
      core: false,
      sync: false,
      workspace: false,
      ci: true,
      perf: false,
      tsconfig: false,
      native: true,
      apk: true,
      allPackages: true,
      nativeTests: true,
    });
  });
});

describe("changes.ts as a command", () => {
  it("prints one GitHub output line per area for the paths on stdin", () => {
    assert.equal(
      run([], "docs/spec.md\npackages/core/src/queue.ts\n"),
      "app=false\ncore=true\nsync=false\nworkspace=false\nci=false\nperf=false\ntsconfig=false\nnative=false\napk=true\nallPackages=false\nnativeTests=false\n",
    );
  });

  it("counts every area as changed with --all, as on pushes to main", () => {
    assert.equal(
      run(["--all"], ""),
      "app=true\ncore=true\nsync=true\nworkspace=true\nci=true\nperf=true\ntsconfig=true\nnative=true\napk=true\nallPackages=true\nnativeTests=true\n",
    );
  });
});
