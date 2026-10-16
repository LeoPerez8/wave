import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { bumpFor, nextVersion } from "./next-version.ts";
import type { MergedPr } from "./patch-notes.ts";

const script = fileURLToPath(new URL("./next-version.ts", import.meta.url));

const app = ["apps/mobile/src/app/_layout.tsx"];

describe("nextVersion", () => {
  it("bumps the patch of the highest version tagged, counting a -ti tag by its base", () => {
    const tags = ["latest", "ti-latest", "pr-204", "v0.5.0", "v0.5.1-ti", "v0.5.3-ti", "v0.5.2"];
    const decision = nextVersion({ version: "0.5.2", tags, changed: app });
    assert.equal(decision.version, "0.5.4");
    assert.match(decision.reason, /v0\.5\.3-ti is the highest version tagged/);
  });

  it("starts from the version in package.json when no version is tagged yet", () => {
    const decision = nextVersion({ version: "0.5.0", tags: ["latest", "pr-12"], changed: null });
    assert.equal(decision.version, "0.5.0");
    assert.match(decision.reason, /No version is tagged yet/);
  });

  it("releases a version set by hand above every tag as it is", () => {
    const tags = ["v0.5.3", "v0.5.4-ti"];
    const decision = nextVersion({ version: "1.0.0", tags, changed: ["apps/mobile/package.json"] });
    assert.equal(decision.version, "1.0.0");
    assert.match(decision.reason, /1\.0\.0 in package\.json is above every tag/);
  });

  it("releases nothing when only CI, docs or specs changed since the previous tag, and says so", () => {
    const decision = nextVersion({
      version: "0.5.3",
      tags: ["v0.5.3"],
      changed: [
        ".github/workflows/ci.yml",
        "scripts/ci/release-tag.ts",
        "docs/spec.md",
        "CLAUDE.md",
      ],
    });
    assert.equal(decision.version, undefined);
    assert.match(decision.reason, /only CI, docs or specs changed/i);
  });

  it("releases nothing when nothing changed since the previous tag", () => {
    const decision = nextVersion({ version: "0.5.4", tags: ["v0.5.4"], changed: [] });
    assert.equal(decision.version, undefined);
    assert.match(decision.reason, /Nothing changed since the previous release/);
  });

  it("fails a patch bump that would reach 100, asking for a bump by hand", () => {
    assert.throws(
      () => nextVersion({ version: "0.5.99", tags: ["v0.5.99"], changed: app }),
      /0\.5\.100.*under 100.*by hand/,
    );
  });

  it("bumps the minor and resets the patch when a feat/ PR made the bump minor, naming it", () => {
    const decision = nextVersion({
      version: "0.5.3",
      tags: ["v0.5.3"],
      changed: app,
      bump: { size: "minor", pr: { number: 197, branch: "feat/197-artist-all-songs" } },
    });
    assert.equal(decision.version, "0.6.0");
    assert.match(decision.reason, /0\.6\.0, a minor bump.*#197 \(feat\/197-artist-all-songs\)/);
  });

  it("says a patch bump is one because no PR since the previous tag is a feature", () => {
    const decision = nextVersion({
      version: "0.5.3",
      tags: ["v0.5.3"],
      changed: app,
      bump: { size: "patch" },
    });
    assert.equal(decision.version, "0.5.4");
    assert.match(decision.reason, /0\.5\.4, a patch bump: no PR .* feat\/ branch/);
  });

  it("fails a minor bump that would reach 100, asking for a major bump by hand", () => {
    const bump = { size: "minor", pr: { number: 400, branch: "feat/400-thing" } } as const;
    assert.throws(
      () => nextVersion({ version: "0.99.4", tags: ["v0.99.4"], changed: app, bump }),
      /0\.100\.0.*under 100.*major version.*by hand/,
    );
  });

  it("releases a version set by hand above every tag as it is, even when a feat/ PR shipped", () => {
    const bump = { size: "minor", pr: { number: 400, branch: "feat/400-thing" } } as const;
    const decision = nextVersion({ version: "1.0.0", tags: ["v0.5.3"], changed: app, bump });
    assert.equal(decision.version, "1.0.0");
  });

  it("takes the next number when a merge from ti left a -ti version in package.json", () => {
    const tags = ["v0.5.3", "v0.5.4-ti"];
    assert.equal(nextVersion({ version: "0.5.4-ti", tags, changed: app }).version, "0.5.5");
  });
});

const pr = (number: number, branch: string, fields: Partial<MergedPr> = {}): MergedPr => ({
  number,
  title: `PR ${number}`,
  url: `https://github.com/LeoPerez8/wave/pull/${number}`,
  branch,
  base: "main",
  body: "",
  mergeCommit: `commit-${number}`,
  files: app,
  issues: [],
  ...fields,
});

describe("bumpFor", () => {
  const release = (...pullRequests: MergedPr[]) => ({
    commits: pullRequests.map((merged) => merged.mergeCommit),
    pullRequests,
  });

  it("is minor when a PR since the previous tag is from a feat/ branch, naming the first", () => {
    const bump = bumpFor(
      release(pr(12, "fix/queue-row"), pr(14, "feat/14-sleep-timer"), pr(15, "feat/15-lyrics")),
    );
    assert.deepEqual(bump, { size: "minor", pr: { number: 14, branch: "feat/14-sleep-timer" } });
  });

  it("is a patch when the PRs are from fix/ or any other branch", () => {
    const bump = bumpFor(release(pr(12, "fix/queue-row"), pr(13, "chore/deps"), pr(16, "feature")));
    assert.deepEqual(bump, { size: "patch" });
  });

  it("doesn't count a feat/ PR the patch notes leave out: CI, docs or specs only, or not merged", () => {
    const bump = bumpFor({
      commits: ["commit-12", "commit-20"],
      pullRequests: [
        pr(12, "fix/queue-row"),
        pr(20, "feat/20-auto-version", { files: [".github/workflows/ci.yml", "docs/spec.md"] }),
        pr(21, "feat/21-elsewhere"),
      ],
    });
    assert.deepEqual(bump, { size: "patch" });
  });
});

describe("next-version.ts", () => {
  const dir = mkdtempSync(join(tmpdir(), "next-version-"));
  const file = (name: string, lines: string[]) => {
    const path = join(dir, name);
    writeFileSync(path, lines.map((line) => `${line}\n`).join(""));
    return path;
  };
  const run = (args: string[]) =>
    execFileSync(process.execPath, [script, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  const tags = file("tags.txt", ["latest", "v0.5.3", "v0.5.3-ti"]);

  it("prints the GitHub output line, empty when nothing is released", () => {
    assert.equal(run(["0.5.3", tags, file("app.txt", app)]), "version=0.5.4\n");
    assert.equal(run(["0.5.3", tags, file("docs.txt", ["docs/spec.md"])]), "version=\n");
  });

  it("counts everything as changed without a file of changed paths", () => {
    assert.equal(run(["0.5.3", tags]), "version=0.5.4\n");
  });

  it("bumps by the merged PRs it's given with the release's commits, and logs why", () => {
    const commits = file("commits.txt", ["commit-12", "commit-14"]);
    const prs = file("prs.jsonl", [
      JSON.stringify(pr(12, "fix/queue-row")),
      JSON.stringify(pr(14, "feat/14-sleep-timer")),
    ]);
    const result = spawnSync(
      process.execPath,
      [script, "0.5.3", tags, file("app.txt", app), commits, prs],
      { encoding: "utf8" },
    );
    assert.equal(result.stdout, "version=0.6.0\n");
    assert.match(result.stderr, /a minor bump, because #14 \(feat\/14-sleep-timer\)/);
  });
});
