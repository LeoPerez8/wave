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
    "apps/mobile/DESIGN.md",
    "packages/core/README.md",
  ]) {
    it(`doesn't build the APK when only ${path} changes`, () => {
      assert.equal(changes([path]).apk, false);
    });
  }

  it("names each area a change touches", () => {
    assert.deepEqual(changes(["packages/core/src/queue.ts", "pnpm-lock.yaml"]), {
      app: false,
      core: true,
      workspace: true,
      ci: false,
      apk: true,
    });
    assert.deepEqual(changes(["apps/mobile/app.config.ts", ".github/workflows/ci.yml"]), {
      app: true,
      core: false,
      workspace: false,
      ci: true,
      apk: true,
    });
  });
});

describe("changes.ts as a command", () => {
  it("prints one GitHub output line per area for the paths on stdin", () => {
    assert.equal(
      run([], "docs/spec.md\npackages/core/src/queue.ts\n"),
      "app=false\ncore=true\nworkspace=false\nci=false\napk=true\n",
    );
  });

  it("counts every area as changed with --all, as on pushes to main", () => {
    assert.equal(run(["--all"], ""), "app=true\ncore=true\nworkspace=true\nci=true\napk=true\n");
  });
});
