import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { patchNotes, type MergedPr } from "./patch-notes.ts";

const pr = (number: number, fields: Partial<MergedPr> = {}): MergedPr => ({
  number,
  title: `PR ${number}`,
  url: `https://github.com/LeoPerez8/wave/pull/${number}`,
  branch: `feat/${number}-thing`,
  base: "main",
  body: "",
  mergeCommit: `commit-${number}`,
  files: ["apps/mobile/src/app/_layout.tsx"],
  issues: [],
  ...fields,
});

describe("patchNotes", () => {
  it("lists a merged app PR under New as its title, linked to the PR", () => {
    const notes = patchNotes({
      commits: ["commit-7"],
      bugIssues: [],
      pullRequests: [pr(7, { title: "Play a track with system media controls" })],
    });
    assert.equal(
      notes,
      "## New\n\n- [Play a track with system media controls](https://github.com/LeoPerez8/wave/pull/7)\n",
    );
  });

  it("puts a PR from a fix/ branch under Fixes and leaves out an empty New", () => {
    const notes = patchNotes({
      commits: ["commit-44"],
      bugIssues: [],
      pullRequests: [
        pr(44, {
          title: "Queue: show Up Next songs once they load",
          branch: "fix/queue-row-songs",
        }),
      ],
    });
    assert.equal(
      notes,
      "## Fixes\n\n- [Queue: show Up Next songs once they load](https://github.com/LeoPerez8/wave/pull/44)\n",
    );
  });

  it("puts a PR whose issue has the bug label under Fixes, linked or named in the body", () => {
    const notes = patchNotes({
      commits: ["commit-20", "commit-21", "commit-22", "commit-23"],
      bugIssues: [10, 12],
      pullRequests: [
        pr(20, { title: "Artist pages", issues: [11] }),
        pr(21, { title: "Android Auto doesn't freeze on a cold start", issues: [3, 10] }),
        pr(22, { title: "Lyrics show again", body: "Part of #9. Closes #12.\n\nDetails" }),
        pr(23, { title: "Sleep timer", body: "Closes #13. Mentions #12." }),
      ],
    });
    assert.equal(
      notes,
      [
        "## New",
        "",
        "- [Artist pages](https://github.com/LeoPerez8/wave/pull/20)",
        "- [Sleep timer](https://github.com/LeoPerez8/wave/pull/23)",
        "",
        "## Fixes",
        "",
        "- [Android Auto doesn't freeze on a cold start](https://github.com/LeoPerez8/wave/pull/21)",
        "- [Lyrics show again](https://github.com/LeoPerez8/wave/pull/22)",
        "",
      ].join("\n"),
    );
  });

  it("leaves out PRs that change only CI, docs or specs", () => {
    const notes = patchNotes({
      commits: [30, 31, 32, 33, 34, 35, 36].map((n) => `commit-${n}`),
      bugIssues: [],
      pullRequests: [
        pr(30, { files: [".github/workflows/ci.yml", "scripts/ci/changes.ts"] }),
        pr(31, { files: ["docs/spec.md", "README.md"] }),
        pr(32, { files: ["apps/mobile/DESIGN.md", "CLAUDE.md"], branch: "fix/typo" }),
        pr(33, { files: ["packages/core/src/queue.ts"] }),
        pr(34, { files: ["pnpm-lock.yaml", ".github/workflows/ci.yml"] }),
        pr(35, { files: null }),
        pr(36, { files: ["scripts/music-folder/plan.ts"] }),
      ],
    });
    assert.equal(
      notes,
      [
        "## New",
        "",
        "- [PR 33](https://github.com/LeoPerez8/wave/pull/33)",
        "- [PR 34](https://github.com/LeoPerez8/wave/pull/34)",
        "- [PR 35](https://github.com/LeoPerez8/wave/pull/35)",
        "",
      ].join("\n"),
    );
  });

  it("lists only PRs merged in the release's commits, in PR order", () => {
    const notes = patchNotes({
      commits: ["commit-52", "a-direct-commit", "commit-50"],
      bugIssues: [],
      pullRequests: [pr(52), pr(51), pr(50), pr(49, { mergeCommit: "commit-on-another-branch" })],
    });
    assert.equal(
      notes,
      [
        "## New",
        "",
        "- [PR 50](https://github.com/LeoPerez8/wave/pull/50)",
        "- [PR 52](https://github.com/LeoPerez8/wave/pull/52)",
        "",
      ].join("\n"),
    );
  });

  it("leaves out a feature's PR into main when its own PRs are listed", () => {
    const notes = patchNotes({
      commits: ["commit-60", "commit-61", "commit-62"],
      bugIssues: [],
      pullRequests: [
        pr(60, { title: "Faster CI and versioned releases", branch: "feat/183-faster-ci" }),
        pr(61, { title: "Wave gets version numbers", base: "feat/183-faster-ci" }),
        pr(62, {
          title: "Skip the APK build",
          base: "feat/183-faster-ci",
          files: ["scripts/ci/changes.ts"],
        }),
      ],
    });
    assert.equal(
      notes,
      "## New\n\n- [Wave gets version numbers](https://github.com/LeoPerez8/wave/pull/61)\n",
    );
  });

  it("keeps a title's <angle brackets> and [brackets] as text, and its `code` as code", () => {
    const notes = patchNotes({
      commits: ["commit-70"],
      bugIssues: [],
      pullRequests: [pr(70, { title: "A v<version> tag [beta] publishes `wave-<version>.apk`" })],
    });
    assert.equal(
      notes,
      "## New\n\n- [A v\\<version\\> tag \\[beta\\] publishes `wave-<version>.apk`](https://github.com/LeoPerez8/wave/pull/70)\n",
    );
  });

  it("is empty when no PR is listed", () => {
    assert.equal(
      patchNotes({
        commits: ["commit-80"],
        bugIssues: [],
        pullRequests: [pr(80, { files: ["docs/spec.md"] })],
      }),
      "",
    );
  });
});

describe("patch-notes.ts as a command", () => {
  it("rejects malformed merged PR data with its input line and expected shape", () => {
    const script = fileURLToPath(new URL("./patch-notes.ts", import.meta.url));
    const dir = mkdtempSync(join(tmpdir(), "patch-notes-"));
    writeFileSync(join(dir, "commits.txt"), "commit-90\n");
    writeFileSync(join(dir, "bugs.txt"), "");
    const result = spawnSync(
      process.execPath,
      [script, join(dir, "commits.txt"), join(dir, "bugs.txt")],
      { input: JSON.stringify({ ...pr(90), files: [42] }), encoding: "utf8" },
    );
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Invalid merged PR on line 1.*files.*string/i);
    assert.equal(result.stdout, "");
  });

  it("prints the notes for the PRs on stdin, given the release's commits and bug issues", () => {
    const script = fileURLToPath(new URL("./patch-notes.ts", import.meta.url));
    const dir = mkdtempSync(join(tmpdir(), "patch-notes-"));
    writeFileSync(join(dir, "commits.txt"), "commit-90\ncommit-91\n");
    writeFileSync(join(dir, "bugs.txt"), "4\n5\n");
    // One PR per line, as `gh api --jq` prints them.
    const prs = [pr(90, { issues: [5] }), pr(91)].map((it) => JSON.stringify(it)).join("\n");
    assert.equal(
      execFileSync(process.execPath, [script, join(dir, "commits.txt"), join(dir, "bugs.txt")], {
        input: `${prs}\n`,
        encoding: "utf8",
      }),
      "## New\n\n- [PR 91](https://github.com/LeoPerez8/wave/pull/91)\n\n## Fixes\n\n- [PR 90](https://github.com/LeoPerez8/wave/pull/90)\n",
    );
  });
});
