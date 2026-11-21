import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { worktreeApps } from "./worktree-apps.ts";

const script = fileURLToPath(new URL("./worktree-apps.ts", import.meta.url));

describe("worktreeApps", () => {
  it("picks the phone for a phone-only change", () => {
    assert.deepEqual(worktreeApps(["apps/mobile/src/App.tsx"]), ["mobile"]);
  });

  it("picks the desktop for a desktop-only change", () => {
    assert.deepEqual(worktreeApps(["apps/desktop/src/main.ts"]), ["desktop"]);
    assert.deepEqual(worktreeApps(["packages/kotlin-shared/stdio/Main.kt"]), ["desktop"]);
  });

  it("picks both apps for what they share", () => {
    for (const path of [
      "packages/core/src/queue.ts",
      "packages/client/src/db/tracks.ts",
      "packages/theme/colours.css",
      "packages/kotlin-shared/src/Scan.kt",
      "pnpm-lock.yaml",
      "pnpm-workspace.yaml",
      "tsconfig.base.json",
    ])
      assert.deepEqual(worktreeApps([path]), ["mobile", "desktop"], path);
  });

  it("picks both apps when a branch holds each app's tickets", () => {
    assert.deepEqual(worktreeApps(["apps/mobile/src/App.tsx", "apps/desktop/src/main.ts"]), [
      "mobile",
      "desktop",
    ]);
  });

  it("defaults to the phone when no app is reached", () => {
    assert.deepEqual(worktreeApps(["docs/spec.md", "packages/theme/README.md"]), ["mobile"]);
    assert.deepEqual(worktreeApps(["apps/sync/src/worker.ts"]), ["mobile"]);
  });

  it("prints one app per line from paths on stdin", () => {
    const output = execFileSync(process.execPath, [script], {
      input: "packages/core/src/queue.ts\n",
      encoding: "utf8",
    });
    assert.equal(output, "mobile\ndesktop\n");
  });
});
