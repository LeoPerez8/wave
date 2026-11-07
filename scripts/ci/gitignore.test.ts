import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { describe, it } from "node:test";

const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();

// Whether .gitignore keeps `path` out of a broad `git add`, tracked or not.
const ignored = (path: string): boolean => {
  try {
    execFileSync("git", ["check-ignore", "--no-index", "-q", path], { cwd: root });
    return true;
  } catch {
    return false;
  }
};

describe(".gitignore", () => {
  it("keeps local notes and agent worktrees out", () => {
    assert.ok(ignored(".scratch/notes.md"));
    assert.ok(ignored(".scratch/plan/issues/01.md"));
    assert.ok(ignored(".claude/worktrees/agent-1/package.json"));
  });

  it("keeps key and keystore files out, anywhere in the tree", () => {
    for (const path of [
      "release.jks",
      "apps/mobile/upload.jks",
      "signing.p12",
      "apps/updates/signing.key",
      "private.pem",
    ]) {
      assert.ok(ignored(path), path);
    }
  });

  it("keeps local MCP server settings out", () => {
    assert.ok(ignored(".mcp.json"));
    assert.ok(ignored("apps/mobile/.mcp.json"));
  });

  it("still tracks the public update certificate and Claude's shared settings", () => {
    assert.equal(ignored("apps/mobile/certs/certificate.pem"), false);
    assert.equal(ignored(".claude/settings.json"), false);
  });
});
