import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
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

  it("leaves out of the phone's notes a PR that changes only the desktop", () => {
    const notes = patchNotes({
      commits: [40, 41, 42, 43, 44].map((n) => `commit-${n}`),
      bugIssues: [],
      pullRequests: [
        pr(40, { files: ["apps/desktop/src/renderer/src/App.tsx"], branch: "feat/40-desktop" }),
        pr(41, {
          files: [
            "apps/desktop/src/main/index.ts",
            "packages/kotlin-shared/stdio/src/main/kotlin/dev/leoperez/wave/stdio/WaveDesktop.kt",
            "docs/spec-desktop.md",
          ],
        }),
        pr(42, { files: ["packages/core/src/catalogue/desktopEn.ts"], branch: "fix/42-desktop" }),
        // A desktop dependency changes the shared lockfile along the way.
        pr(43, {
          files: ["apps/desktop/package.json", "pnpm-lock.yaml", ".github/workflows/ci.yml"],
        }),
        pr(44, { files: ["apps/mobile/src/app/_layout.tsx"] }),
      ],
    });
    assert.equal(notes, "## New\n\n- [PR 44](https://github.com/LeoPerez8/wave/pull/44)\n");
  });

  it("lists a PR that changes the desktop and something the phone ships", () => {
    const notes = patchNotes({
      commits: [45, 46, 47, 48].map((n) => `commit-${n}`),
      bugIssues: [],
      pullRequests: [
        pr(45, {
          files: [
            "apps/desktop/src/main/index.ts",
            "apps/mobile/src/home/MagicQueueCard.tsx",
            "pnpm-lock.yaml",
          ],
        }),
        pr(46, { files: ["apps/desktop/src/main/index.ts", "packages/core/src/catalogueEn.ts"] }),
        pr(47, {
          files: [
            "apps/desktop/src/main/index.ts",
            "packages/kotlin-shared/src/main/kotlin/expo/modules/wavenative/yt/YtClient.kt",
          ],
        }),
        pr(48, { files: ["apps/desktop/src/main/index.ts", "apps/sync/src/worker.ts"] }),
      ],
    });
    assert.equal(
      notes,
      [
        "## New",
        "",
        "- [PR 45](https://github.com/LeoPerez8/wave/pull/45)",
        "- [PR 46](https://github.com/LeoPerez8/wave/pull/46)",
        "- [PR 47](https://github.com/LeoPerez8/wave/pull/47)",
        "- [PR 48](https://github.com/LeoPerez8/wave/pull/48)",
        "",
      ].join("\n"),
    );
  });

  it("lists a PR that changes only the sync service", () => {
    const notes = patchNotes({
      commits: ["commit-37"],
      bugIssues: [],
      pullRequests: [pr(37, { title: "Sync favorites", files: ["apps/sync/src/worker.ts"] })],
    });
    assert.equal(
      notes,
      "## New\n\n- [Sync favorites](https://github.com/LeoPerez8/wave/pull/37)\n",
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

describe("the desktop's patch notes", () => {
  it("list the desktop's PRs and leave out the phone's", () => {
    const input = {
      commits: [60, 61, 62].map((n) => `commit-${n}`),
      bugIssues: [],
      pullRequests: [
        pr(60, { files: ["apps/desktop/src/main/index.ts"], branch: "feat/60-desktop" }),
        pr(61, { files: ["apps/mobile/src/app/_layout.tsx"] }),
        pr(62, { files: ["packages/core/src/catalogue/desktopEn.ts"], branch: "fix/62-tray" }),
      ],
    };
    assert.equal(
      patchNotes(input, "desktop"),
      "## New\n\n- [PR 60](https://github.com/LeoPerez8/wave/pull/60)\n\n## Fixes\n\n- [PR 62](https://github.com/LeoPerez8/wave/pull/62)\n",
    );
    assert.equal(
      patchNotes(input),
      "## New\n\n- [PR 61](https://github.com/LeoPerez8/wave/pull/61)\n",
    );
  });

  it("are printed with the desktop target", () => {
    const script = fileURLToPath(new URL("./patch-notes.ts", import.meta.url));
    const dir = mkdtempSync(join(tmpdir(), "patch-notes-"));
    writeFileSync(join(dir, "commits.txt"), "commit-63\n");
    writeFileSync(join(dir, "bugs.txt"), "");
    const desktop = pr(63, { files: ["apps/desktop/src/main/index.ts"] });
    const args = [script, join(dir, "commits.txt"), join(dir, "bugs.txt")];
    const input = `${JSON.stringify(desktop)}\n`;
    assert.equal(
      execFileSync(process.execPath, [...args, "desktop"], { input, encoding: "utf8" }),
      "## New\n\n- [PR 63](https://github.com/LeoPerez8/wave/pull/63)\n",
    );
    assert.equal(execFileSync(process.execPath, args, { input, encoding: "utf8" }), "");
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

describe("patch-notes.sh for the desktop", () => {
  const shell = fileURLToPath(new URL("./patch-notes.sh", import.meta.url));
  const firstNotes = fileURLToPath(
    new URL("../../docs/desktop-first-release-notes.md", import.meta.url),
  );
  /** A repo with a tagged ti release and one commit after it, and a `gh` that finds no PR. */
  const notes = (desktopSince: string) => {
    const dir = mkdtempSync(join(tmpdir(), "wave-patch-notes-"));
    const git = (...args: string[]) => execFileSync("git", ["-C", dir, ...args], { encoding: "utf8" });
    git("init", "-q");
    for (const name of ["one", "two"]) {
      writeFileSync(join(dir, `${name}.txt`), `${name}\n`);
      git("add", `${name}.txt`);
      git("-c", "user.name=ci", "-c", "user.email=ci@localhost", "commit", "-q", "-m", name);
      if (name === "one") git("tag", "v1.0.0-ti");
    }
    const bin = join(dir, "bin");
    execFileSync("mkdir", ["-p", bin]);
    writeFileSync(join(bin, "gh"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    const [localized, release] = [join(dir, "desktop.json"), join(dir, "desktop.md")];
    const result = spawnSync("bash", [shell], {
      cwd: dir,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        GITHUB_REPOSITORY: "o/r",
        IS_TI: "true",
        DESKTOP_NOTES_FILE: localized,
        DESKTOP_RELEASE_NOTES_FILE: release,
        DESKTOP_NOTES_SINCE: desktopSince,
      },
    });
    const read = (path: string) => {
      try {
        return readFileSync(path, "utf8");
      } catch {
        return "";
      }
    };
    return { ...result, localized: read(localized), release: read(release) };
  };

  it("gives the desktop's first release the hand-written notes, as the phone's first has", () => {
    const { status, stderr, localized, release } = notes("none");
    assert.equal(status, 0, stderr);
    assert.equal(release, readFileSync(firstNotes, "utf8"));
    assert.equal(localized, "");
  });

  it("counts from the channel's previous tag when the desktop's own release is unknown", () => {
    const { status, stderr, release } = notes("");
    assert.equal(status, 0, stderr);
    assert.notEqual(release, readFileSync(firstNotes, "utf8"));
  });
});
