import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { applyAutofixPatch } from "./autofix-patch.ts";

// A stand-in formatter with a rule a test can predict: runs of spaces become one.
const format = (_path: string, text: string) => text.replace(/ {2,}/g, " ");

let repo: string;
let patch: string;

const git = (...args: string[]) =>
  execFileSync("git", ["-C", repo, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
const read = (path: string) => readFileSync(join(repo, path), "utf8");
const write = (path: string, text: string) => writeFileSync(join(repo, path), text);

// Records what the untrusted job would hand over: the working tree's changes as a patch,
// then puts the tree back the way the PR left it.
function recordPatch() {
  git("add", "-A");
  writeFileSync(patch, git("diff", "--cached", "--binary", "HEAD"));
  git("reset", "-q", "--hard", "HEAD");
  git("clean", "-qfd");
}

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "autofix-repo-"));
  patch = join(mkdtempSync(join(tmpdir(), "autofix-patch-")), "autofix.patch");
  git("init", "-q");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Test");
  write("pnpm-lock.yaml", "lockfileVersion: '9.0'\n");
  write("app.ts", "const  a =  1;\n");
  write("other.ts", "export const b = 2;\n");
  git("add", "-A");
  git("commit", "-qm", "PR head");
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

describe("applyAutofixPatch", () => {
  it("applies a lockfile update and formatting the formatter agrees with", () => {
    write("pnpm-lock.yaml", "lockfileVersion: '9.0'\npackages: {}\n");
    write("app.ts", "const a = 1;\n");
    recordPatch();

    assert.deepEqual(applyAutofixPatch({ patch, repo, format }), {
      ok: true,
      files: ["app.ts", "pnpm-lock.yaml"],
    });
    assert.equal(read("pnpm-lock.yaml"), "lockfileVersion: '9.0'\npackages: {}\n");
    assert.equal(read("app.ts"), "const a = 1;\n");
  });

  it("refuses a change to a file that isn't only formatting, and leaves the tree as it was", () => {
    write("pnpm-lock.yaml", "lockfileVersion: '9.0'\npackages: {}\n");
    write("other.ts", "export const b = 2;\nfetch('https://example.com');\n");
    recordPatch();

    const verdict = applyAutofixPatch({ patch, repo, format });
    assert.equal(verdict.ok, false);
    assert.match(!verdict.ok ? verdict.reason : "", /other\.ts/);
    assert.equal(read("pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
    assert.equal(git("status", "--porcelain"), "");
  });

  it("refuses new, deleted, renamed and re-moded files, even next to allowed changes", () => {
    const cases: Array<[string, () => void]> = [
      ["a new file", () => write("postinstall.js", "run()\n")],
      ["a deleted file", () => rmSync(join(repo, "other.ts"))],
      ["a renamed file", () => git("mv", "other.ts", "renamed.ts")],
      ["a mode change", () => chmodSync(join(repo, "other.ts"), 0o755)],
      ["a binary file", () => write("other.ts", "\u0000\u0001binary")],
    ];
    for (const [name, change] of cases) {
      write("app.ts", "const a = 1;\n");
      change();
      recordPatch();
      const verdict = applyAutofixPatch({ patch, repo, format });
      assert.equal(verdict.ok, false, name);
      assert.equal(git("status", "--porcelain"), "", name);
    }
  });

  it("refuses a patch that wasn't made from the PR's head", () => {
    write("app.ts", "const a = 1;\n");
    recordPatch();
    write("app.ts", "const  a =  1;\nconst  c = 3;\n");
    git("commit", "-qam", "newer push");

    const verdict = applyAutofixPatch({ patch, repo, format });
    assert.equal(verdict.ok, false);
    assert.equal(read("app.ts"), "const  a =  1;\nconst  c = 3;\n");
  });

  it("refuses a file the formatter can't parse", () => {
    write("app.ts", "const a = 1;\n");
    recordPatch();
    const broken = () => {
      throw new Error("SyntaxError");
    };

    const verdict = applyAutofixPatch({ patch, repo, format: broken });
    assert.equal(verdict.ok, false);
    assert.equal(git("status", "--porcelain"), "");
  });

  it("has nothing to apply for an empty patch", () => {
    recordPatch();
    assert.deepEqual(applyAutofixPatch({ patch, repo, format }), { ok: true, files: [] });
  });
});
