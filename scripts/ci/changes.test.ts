import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { changes, previousAppRelease, reachesUsers, releaseChanges } from "./changes.ts";

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

describe("releaseChanges", () => {
  it("releases only the app the changed paths reach", () => {
    assert.deepEqual(releaseChanges(["apps/mobile/src/app/_layout.tsx"]), {
      phoneRelease: true,
      desktopRelease: false,
    });
    assert.deepEqual(releaseChanges(["apps/desktop/src/main/index.ts"]), {
      phoneRelease: false,
      desktopRelease: true,
    });
    assert.deepEqual(
      releaseChanges(["apps/mobile/src/app/_layout.tsx", "apps/desktop/src/main/index.ts"]),
      { phoneRelease: true, desktopRelease: true },
    );
  });

  it("releases neither app for a change to CI or docs alone", () => {
    assert.deepEqual(releaseChanges(["scripts/ci/changes.ts", ".github/workflows/mobile.yml"]), {
      phoneRelease: false,
      desktopRelease: false,
    });
    assert.deepEqual(releaseChanges([]), { phoneRelease: false, desktopRelease: false });
  });
});

describe("releaseChanges over several merged changes", () => {
  const workspace = ["pnpm-workspace.yaml", "pnpm-lock.yaml"];
  const desktop = ["apps/desktop/src/main/index.ts"];

  it("releases the phone for a workspace change merged beside a desktop-only one", () => {
    // A catalog bump in one PR and a desktop-only PR after it: the APK's dependencies changed.
    assert.deepEqual(releaseChanges([...workspace, ...desktop], undefined, [workspace, desktop]), {
      phoneRelease: true,
      desktopRelease: true,
    });
  });

  it("leaves out the workspace files a desktop-only change changed along the way", () => {
    const desktopWithLockfile = [...desktop, "pnpm-lock.yaml"];
    assert.deepEqual(
      releaseChanges(desktopWithLockfile, undefined, [desktopWithLockfile, ["docs/spec.md"]]),
      { phoneRelease: false, desktopRelease: true },
    );
  });

  it("counts only what the paths still change, whatever a merged change touched", () => {
    // A change and its revert since the previous release leave nothing new.
    assert.equal(
      releaseChanges(desktop, undefined, [["packages/core/src/queue.ts"], desktop]).phoneRelease,
      false,
    );
  });
});

describe("releaseChanges with the app's package.json", () => {
  const appPackage = (version: string, extra = {}) =>
    `${JSON.stringify({ name: "@wave/mobile", version, dependencies: { expo: "58.0.7" }, ...extra }, null, 2)}\n`;

  it("doesn't release the phone for a version bump alone, as a desktop-only version makes", () => {
    const paths = ["apps/mobile/package.json", "apps/desktop/src/main/index.ts"];
    const bumpOnly = { previous: appPackage("0.80.1-ti"), current: appPackage("0.81.0-ti") };
    assert.deepEqual(releaseChanges(paths, bumpOnly), {
      phoneRelease: false,
      desktopRelease: true,
    });
    assert.deepEqual(releaseChanges(["apps/mobile/package.json"], bumpOnly), {
      phoneRelease: false,
      desktopRelease: false,
    });
  });

  it("releases the phone when its package.json changed more than its version", () => {
    const newDependency = {
      previous: appPackage("0.80.1-ti"),
      current: appPackage("0.81.0-ti", { dependencies: { expo: "58.0.8" } }),
    };
    assert.equal(releaseChanges(["apps/mobile/package.json"], newDependency).phoneRelease, true);
    assert.equal(releaseChanges(["apps/mobile/package.json"]).phoneRelease, true);
  });

  it("releases the phone when it had no package.json before", () => {
    const added = { previous: "", current: appPackage("0.81.0-ti") };
    assert.equal(releaseChanges(["apps/mobile/package.json"], added).phoneRelease, true);
  });
});

describe("previousAppRelease", () => {
  const releases = [
    { tagName: "v2.0.0-ti", assets: ["wave-2.0.0-ti.apk"] },
    { tagName: "v1.9.0-ti", assets: ["wave-1.9.0-ti.apk", "wave-1.9.0-ti-win-x64.exe"] },
    { tagName: "v1.10.0-ti", assets: ["wave-1.10.0-ti.provenance.json"] },
    { tagName: "v1.8.0-ti", assets: ["wave-1.8.0-ti.apk", "wave-1.8.0-ti-linux-x64.AppImage"] },
    { tagName: "v1.7.0", assets: ["wave-1.7.0.apk", "wave-1.7.0-linux-x64.AppImage"] },
    { tagName: "ti-latest", assets: ["wave-ti.apk"] },
  ];

  it("is the newest release of the channel that published the app's own files", () => {
    assert.equal(previousAppRelease(releases, "phone", "ti"), "v2.0.0-ti");
    assert.equal(previousAppRelease(releases, "desktop", "ti"), "v1.9.0-ti");
    assert.equal(previousAppRelease(releases, "phone", "main"), "v1.7.0");
    assert.equal(previousAppRelease(releases, "desktop", "main"), "v1.7.0");
  });

  it("counts a version only once it published, so skipped versions don't hide changes", () => {
    const skipped = [
      { tagName: "v1.9.0-ti", assets: [] },
      { tagName: "v1.8.0-ti", assets: ["wave-1.8.0-ti.apk"] },
    ];
    assert.equal(previousAppRelease(skipped, "phone", "ti"), "v1.8.0-ti");
  });

  it("looks back past stable releases on ti, and never at ti ones on main", () => {
    const promoted = [
      { tagName: "v1.8.0", assets: ["wave-1.8.0.apk"] },
      { tagName: "v1.7.0-ti", assets: ["wave-1.7.0-ti.apk"] },
      { tagName: "v1.9.0-ti", assets: ["wave-1.9.0-ti-linux-x64.AppImage"] },
    ];
    assert.equal(previousAppRelease(promoted, "phone", "ti"), "v1.8.0");
    assert.equal(previousAppRelease(promoted, "desktop", "main"), undefined);
  });

  it("counts a promoted desktop from the ti release it was built from, not the phone's commit", () => {
    // Promoting 0.6.0: the phone from 0.5.9-ti (the tag's commit), the desktop from 0.6.0-ti.
    const promoted = [
      {
        tagName: "v0.6.0",
        assets: ["wave-0.6.0.apk", "wave-0.6.0-win-x64.exe", "wave-0.6.0-linux-x64.AppImage"],
      },
      {
        tagName: "v0.6.0-ti",
        assets: ["wave-0.6.0-ti-win-x64.exe", "wave-0.6.0-ti-linux-x64.AppImage"],
      },
      { tagName: "v0.5.9-ti", assets: ["wave-0.5.9-ti.apk"] },
      {
        tagName: "v0.5.8-ti",
        assets: ["wave-0.5.8-ti-win-x64.exe", "wave-0.5.8-ti-linux-x64.AppImage"],
      },
    ];
    assert.equal(previousAppRelease(promoted, "desktop", "ti"), "v0.6.0-ti");
    assert.equal(previousAppRelease(promoted, "desktop", "main"), "v0.6.0-ti");
    assert.equal(previousAppRelease(promoted, "phone", "ti"), "v0.6.0");
    assert.equal(previousAppRelease(promoted, "phone", "main"), "v0.6.0");
    // The desktop from an older ti release than the phone's: its own, not the tag's commit.
    const older = [promoted[0]!, { tagName: "v0.6.0-ti", assets: [] }, ...promoted.slice(2)];
    assert.equal(previousAppRelease(older, "desktop", "ti"), "v0.5.8-ti");
    assert.equal(previousAppRelease(older, "desktop", "main"), "v0.5.8-ti");
  });

  it("prefers the ti release on ti when a stable one has the same number", () => {
    const same = [
      { tagName: "v1.8.0", assets: ["wave-1.8.0.apk"] },
      { tagName: "v1.8.0-ti", assets: ["wave-1.8.0-ti.apk"] },
    ];
    assert.equal(previousAppRelease(same, "phone", "ti"), "v1.8.0-ti");
    assert.equal(previousAppRelease(same, "phone", "main"), "v1.8.0");
  });

  it("leaves out the run's own tag, which a re-run may already have published", () => {
    assert.equal(previousAppRelease(releases, "phone", "ti", "v2.0.0-ti"), "v1.9.0-ti");
  });

  it("finds none when no release holds the app's files", () => {
    assert.equal(
      previousAppRelease([{ tagName: "v1.9.0-ti", assets: [] }], "desktop", "ti"),
      undefined,
    );
  });
});

describe("changes.ts as a command", () => {
  it("prints one GitHub output line per area for the paths on stdin", () => {
    assert.equal(
      run([], "docs/spec.md\npackages/core/src/queue.ts\n"),
      "app=false\ncore=true\nsync=false\nupdates=false\nworkspace=false\nci=false\nperf=false\ntsconfig=false\nnative=false\ndesktop=true\nallPackages=false\nnativeTests=false\ndesktopChecks=true\nphoneRelease=true\ndesktopRelease=true\n",
    );
  });

  it("names each app's previous release from GitHub's releases, one JSON line each", () => {
    const releases = [
      { tagName: "v1.9.0-ti", assets: ["wave-1.9.0-ti.apk"] },
      { tagName: "v1.8.0-ti", assets: ["wave-1.8.0-ti-win-x64.exe"] },
    ]
      .map((release) => JSON.stringify(release))
      .join("\n");
    assert.equal(run(["--previous-release", "phone", "ti"], releases), "v1.9.0-ti\n");
    assert.equal(run(["--previous-release", "desktop", "ti"], releases), "v1.8.0-ti\n");
    assert.equal(run(["--previous-release", "phone", "ti", "v1.9.0-ti"], releases), "");
    assert.equal(run(["--previous-release", "desktop", "main"], releases), "");
  });

  it("leaves out a version bump of the app's package.json given both texts", () => {
    const dir = mkdtempSync(join(tmpdir(), "changes-"));
    const write = (name: string, version: string) => {
      const path = join(dir, name);
      writeFileSync(path, JSON.stringify({ name: "@wave/mobile", version }));
      return path;
    };
    const args = [
      "--app-package",
      write("before.json", "1.8.0-ti"),
      write("after.json", "1.9.0-ti"),
    ];
    const output = run(args, "apps/mobile/package.json\napps/desktop/src/main/index.ts\n");
    assert.match(output, /^phoneRelease=false$/m);
    assert.match(output, /^desktopRelease=true$/m);
    assert.match(run([], "apps/mobile/package.json\n"), /^phoneRelease=true$/m);
  });

  it("reads each merged change from git log's file lists with --merged", () => {
    const dir = mkdtempSync(join(tmpdir(), "changes-"));
    const log = join(dir, "merged.txt");
    writeFileSync(
      log,
      "commit 1111\n\npnpm-workspace.yaml\npnpm-lock.yaml\ncommit 2222\n\napps/desktop/src/main/index.ts\n",
    );
    const paths = "pnpm-workspace.yaml\npnpm-lock.yaml\napps/desktop/src/main/index.ts\n";
    assert.match(run(["--merged", log], paths), /^phoneRelease=true$/m);
    assert.match(run([], paths), /^phoneRelease=false$/m);
  });

  it("counts every area as changed with --all, as on pushes to main", () => {
    assert.equal(
      run(["--all"], ""),
      "app=true\ncore=true\nsync=true\nupdates=true\nworkspace=true\nci=true\nperf=true\ntsconfig=true\nnative=true\ndesktop=true\nallPackages=true\nnativeTests=true\ndesktopChecks=true\nphoneRelease=true\ndesktopRelease=true\n",
    );
  });
});

describe("changes.sh on a promotion's run", () => {
  const shell = fileURLToPath(new URL("./changes.sh", import.meta.url));
  /** A repo whose one commit is tagged v1.0.0, with a `gh` that lists no releases. */
  const promotion = (ref: string, app: string, gh = "exit 0") => {
    const dir = mkdtempSync(join(tmpdir(), "wave-changes-"));
    const git = (...args: string[]) =>
      execFileSync("git", ["-C", dir, ...args], { encoding: "utf8" });
    git("init", "-q");
    writeFileSync(join(dir, "README.md"), "Wave\n");
    git("add", "README.md");
    git("-c", "user.name=ci", "-c", "user.email=ci@localhost", "commit", "-q", "-m", "one");
    git("tag", "v1.0.0");
    const bin = join(dir, "bin");
    execFileSync("mkdir", ["-p", bin]);
    writeFileSync(join(bin, "gh"), `#!/bin/sh\n${gh}\n`, { mode: 0o755 });
    const output = join(dir, "output");
    writeFileSync(output, "");
    const result = spawnSync("bash", [shell], {
      cwd: dir,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        GITHUB_REPOSITORY: "o/r",
        GITHUB_REF: ref,
        GITHUB_OUTPUT: output,
        PR_NUMBER: "",
        PROMOTED_APP: app,
      },
    });
    return { ...result, output: readFileSync(output, "utf8") };
  };

  it("publishes the apps the promotion names, whatever changed", () => {
    for (const [app, phone, desktop] of [
      ["both", "true", "true"],
      ["mobile", "true", "false"],
      ["desktop", "false", "true"],
    ] as const) {
      const { status, output, stderr } = promotion("refs/tags/v1.0.0", app);
      assert.equal(status, 0, stderr);
      assert.match(output, new RegExp(`^phoneRelease=${phone}$`, "m"), app);
      assert.match(output, new RegExp(`^desktopRelease=${desktop}$`, "m"), app);
    }
  });

  it("refuses named apps anywhere but a stable tag, or an app that isn't one", () => {
    assert.notEqual(promotion("refs/tags/v1.0.0-ti", "mobile").status, 0);
    assert.notEqual(promotion("refs/heads/main", "mobile").status, 0);
    assert.notEqual(promotion("refs/tags/v1.0.0", "tv").status, 0);
  });

  it("names the desktop's previous release none when it never released, and unknown without the list", () => {
    const listed = promotion("refs/heads/main", "");
    assert.equal(listed.status, 0, listed.stderr);
    assert.match(listed.output, /^desktopSince=none$/m);
    const unlisted = promotion("refs/heads/main", "", "exit 1");
    assert.equal(unlisted.status, 0, unlisted.stderr);
    assert.doesNotMatch(unlisted.output, /^desktopSince=./m);
  });
});

describe("changes.sh on main", () => {
  const shell = fileURLToPath(new URL("./changes.sh", import.meta.url));
  /**
   * A repo whose first commit is v1.0.0-ti, which published both apps, then one commit per
   * change; `gh` lists that one release. What changes.sh writes for a push to main.
   */
  const pushed = (changes: ((dir: string, git: (...args: string[]) => string) => void)[]) => {
    const dir = mkdtempSync(join(tmpdir(), "wave-changes-"));
    const git = (...args: string[]) =>
      execFileSync("git", ["-C", dir, "-c", "core.autocrlf=false", ...args], { encoding: "utf8" });
    const commit = (message: string) => {
      git("add", "-A");
      git("-c", "user.name=ci", "-c", "user.email=ci@localhost", "commit", "-q", "-m", message);
    };
    const write = (path: string, text: string) => {
      execFileSync("mkdir", ["-p", join(dir, path, "..")]);
      writeFileSync(join(dir, path), text);
    };
    git("init", "-q");
    write("packages/client/src/foo.ts", "export const foo = 1;\n".repeat(20));
    write("pnpm-workspace.yaml", "catalog:\n  effect: 3.0.0\n");
    write("apps/desktop/src/main/index.ts", "export {};\n");
    commit("one");
    git("tag", "v1.0.0-ti");
    changes.forEach((change, index) => {
      change(dir, git);
      commit(`change ${index}`);
    });
    // Outside the repo, so the commits above don't hold it.
    const bin = mkdtempSync(join(tmpdir(), "wave-changes-bin-"));
    const release = JSON.stringify({
      tagName: "v1.0.0-ti",
      assets: ["wave-1.0.0-ti.apk", "wave-1.0.0-ti-win-x64.exe"],
    });
    writeFileSync(join(bin, "gh"), `#!/bin/sh\necho '${release}'\n`, { mode: 0o755 });
    const output = join(bin, "output");
    writeFileSync(output, "");
    const result = spawnSync("bash", [shell], {
      cwd: dir,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        GITHUB_REPOSITORY: "o/r",
        GITHUB_REF: "refs/heads/main",
        GITHUB_OUTPUT: output,
        PR_NUMBER: "",
        PROMOTED_APP: "",
      },
    });
    assert.equal(result.status, 0, result.stderr);
    return readFileSync(output, "utf8");
  };

  it("releases the phone for a file moved out of the phone's code into the desktop's", () => {
    const output = pushed([
      (_dir, git) => git("mv", "packages/client/src/foo.ts", "apps/desktop/src/foo.ts"),
    ]);
    assert.match(output, /^phoneRelease=true$/m);
    assert.match(output, /^desktopRelease=true$/m);
  });

  it("releases the phone for a workspace change merged before a desktop-only one", () => {
    const output = pushed([
      (dir) => writeFileSync(join(dir, "pnpm-workspace.yaml"), "catalog:\n  effect: 3.1.0\n"),
      (dir) => writeFileSync(join(dir, "apps/desktop/src/main/index.ts"), "export const a = 1;\n"),
    ]);
    assert.match(output, /^phoneRelease=true$/m);
  });

  it("releases only the desktop for a desktop-only change", () => {
    const output = pushed([
      (dir) => writeFileSync(join(dir, "apps/desktop/src/main/index.ts"), "export const a = 1;\n"),
    ]);
    assert.match(output, /^phoneRelease=false$/m);
    assert.match(output, /^desktopRelease=true$/m);
  });
});
