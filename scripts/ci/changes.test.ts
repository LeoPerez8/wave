import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { changes, reachesUsers } from "./changes.ts";

const script = fileURLToPath(new URL("./changes.ts", import.meta.url));
const run = (args: string[], stdin: string) =>
  execFileSync(process.execPath, [script, ...args], { input: stdin, encoding: "utf8" });

describe("changes", () => {
  it("releases phone changes to the shared client and checks its dependents", () => {
    const paths = ["packages/client/src/db/tracks.ts"];
    assert.equal(changes(paths).app, true);
    assert.equal(reachesUsers(paths), true);
  });
  it("touches no area for a docs-only change", () => {
    const result = changes(["docs/spec.md", "docs/spotify-samples/track-metadata.json"]);
    assert.ok(Object.values(result).every((value) => value === false));
  });

  it("checks a sync-service change without running native tests", () => {
    const result = changes(["apps/sync/src/worker.ts", "apps/sync/package.json"]);
    assert.equal(result.nativeTests, false);
    assert.equal(result.allPackages, false);
  });

  it("checks an update-service change without releasing", () => {
    const paths = ["apps/updates/src/service.ts", "apps/updates/package.json"];
    const result = changes(paths);
    assert.equal(result.updates, true);
    assert.equal(result.nativeTests, false);
    assert.equal(result.allPackages, false);
    assert.equal(reachesUsers(paths), false);
  });

  it("runs the native tests when wave-native changes", () => {
    assert.equal(
      changes([
        "apps/mobile/modules/wave-native/android/src/main/java/expo/modules/wavenative/player/SleepTimer.kt",
      ]).nativeTests,
      true,
    );
  });

  it("runs the native tests and releases the phone when the shared Kotlin changes", () => {
    const paths = ["packages/kotlin-shared/src/main/kotlin/expo/modules/wavenative/yt/YtClient.kt"];
    assert.equal(changes(paths).nativeTests, true);
    assert.equal(reachesUsers(paths), true);
  });

  it("doesn't release the phone for the desktop's JVM entry point, and still runs its tests", () => {
    const paths = [
      "packages/kotlin-shared/stdio/src/main/kotlin/dev/leoperez/wave/stdio/WaveDesktop.kt",
      "packages/kotlin-shared/stdio/build.gradle.kts",
      "apps/desktop/src/main/index.ts",
    ];
    const result = changes(paths);
    assert.equal(result.app, false);
    assert.equal(reachesUsers(paths), false);
    assert.equal(result.nativeTests, true);
    assert.equal(result.desktopChecks, true);
    assert.equal(reachesUsers([...paths, "packages/kotlin-shared/build.gradle.kts"]), true);
  });

  it("runs the native tests when wave-glass changes", () => {
    assert.equal(
      changes([
        "apps/mobile/modules/wave-glass/android/src/main/java/expo/modules/waveglass/WaveCoverView.kt",
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

  it("doesn't run the native tests for a JS-only change", () => {
    const result = changes([
      "apps/mobile/src/app/_layout.tsx",
      "apps/mobile/global.css",
      "apps/mobile/src/services.ts",
      "packages/core/src/queue.ts",
      "apps/mobile/modules/wave-native/NOTES.md",
    ]);
    assert.equal(result.nativeTests, false);
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

  for (const path of [
    "apps/desktop/src/main/index.ts",
    "packages/client/src/db/tracks.ts",
    "packages/core/src/queue.ts",
    "packages/theme/colours.css",
    "packages/kotlin-shared/stdio/src/main/kotlin/dev/leoperez/wave/stdio/WaveDesktop.kt",
    "pnpm-lock.yaml",
    "tsconfig.base.json",
    ".github/workflows/ci.yml",
  ]) {
    it(`checks the desktop on Windows and Linux when ${path} changes`, () => {
      assert.equal(changes([path]).desktopChecks, true);
    });
  }

  it("checks a desktop change without releasing the phone or running its native tests", () => {
    const paths = ["apps/desktop/src/main/index.ts", "apps/desktop/package.json"];
    const result = changes(paths);
    assert.equal(result.desktop, true);
    assert.equal(result.nativeTests, false);
    assert.equal(result.allPackages, false);
    assert.equal(reachesUsers(paths), false);
  });

  it("doesn't check the desktop for a phone-only or sync change", () => {
    assert.equal(
      changes(["apps/mobile/src/app/_layout.tsx", "apps/sync/src/worker.ts"]).desktopChecks,
      false,
    );
  });

  it("names each area a change touches", () => {
    assert.deepEqual(changes(["packages/core/src/queue.ts", "pnpm-lock.yaml"]), {
      app: false,
      core: true,
      sync: false,
      updates: false,
      workspace: true,
      ci: false,
      perf: false,
      tsconfig: false,
      native: false,
      desktop: true,
      allPackages: true,
      nativeTests: true,
      desktopChecks: true,
    });
    assert.deepEqual(changes(["apps/mobile/app.config.ts", ".github/workflows/ci.yml"]), {
      app: true,
      core: false,
      sync: false,
      updates: false,
      workspace: false,
      ci: true,
      perf: false,
      tsconfig: false,
      native: true,
      desktop: false,
      allPackages: true,
      nativeTests: true,
      desktopChecks: true,
    });
  });
});

describe("changes.ts as a command", () => {
  it("prints one GitHub output line per area for the paths on stdin", () => {
    assert.equal(
      run([], "docs/spec.md\npackages/core/src/queue.ts\n"),
      "app=false\ncore=true\nsync=false\nupdates=false\nworkspace=false\nci=false\nperf=false\ntsconfig=false\nnative=false\ndesktop=true\nallPackages=false\nnativeTests=false\ndesktopChecks=true\n",
    );
  });

  it("counts every area as changed with --all, as on pushes to main", () => {
    assert.equal(
      run(["--all"], ""),
      "app=true\ncore=true\nsync=true\nupdates=true\nworkspace=true\nci=true\nperf=true\ntsconfig=true\nnative=true\ndesktop=true\nallPackages=true\nnativeTests=true\ndesktopChecks=true\n",
    );
  });
});
