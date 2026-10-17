import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
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

  it("releases nothing when the app's package.json changed only its version (a bump merged from the other branch)", () => {
    const appPackage = (version: string, extra = {}) =>
      `${JSON.stringify({ name: "@wave/mobile", version, dependencies: { expo: "58.0.7" }, ...extra }, null, 2)}\n`;
    const push = { channel: "ti", version: "0.5.7", tags: ["v0.5.6-ti", "v0.5.7"] } as const;
    const bumpOnly = { previous: appPackage("0.5.6-ti"), current: appPackage("0.5.7") };
    const decision = nextVersion({
      ...push,
      changed: ["apps/mobile/package.json", "docs/spec.md"],
      appPackage: bumpOnly,
    });
    assert.equal(decision.version, undefined);
    assert.match(decision.reason, /only CI, docs, specs or the app's version changed/i);
    const changed = ["apps/mobile/package.json"];
    assert.equal(nextVersion({ ...push, changed, appPackage: bumpOnly }).version, undefined);
    const newDependency = {
      previous: appPackage("0.5.6-ti"),
      current: appPackage("0.5.7", { dependencies: { expo: "58.0.8" } }),
    };
    assert.equal(nextVersion({ ...push, changed, appPackage: newDependency }).version, "0.5.8-ti");
    assert.equal(nextVersion({ ...push, changed }).version, "0.5.8-ti");
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

  it("releases the pushed commit as it is when it already carries its channel's tag", () => {
    const tags = ["v0.5.3", "v0.5.4-ti", "v0.5.5"];
    const decision = nextVersion({ version: "0.5.5", tags, own: ["v0.5.5"], changed: app });
    assert.equal(decision.version, "0.5.5");
    assert.match(decision.reason, /already tagged v0\.5\.5/);
    const ti = { channel: "ti", tags, changed: app } as const;
    assert.equal(
      nextVersion({ ...ti, version: "0.5.4-ti", own: ["v0.5.4-ti"] }).version,
      "0.5.4-ti",
    );
    assert.equal(nextVersion({ ...ti, version: "0.5.5", own: ["v0.5.5"] }).version, "0.5.6-ti");
  });

  it("takes the next number when a merge from ti left a -ti version in package.json", () => {
    const tags = ["v0.5.3", "v0.5.4-ti"];
    assert.equal(nextVersion({ version: "0.5.4-ti", tags, changed: app }).version, "0.5.5");
  });

  it("bumps from a -ti tag on main too: the counter is shared", () => {
    const tags = ["v0.5.4", "v0.5.5-ti"];
    assert.equal(nextVersion({ version: "0.5.4", tags, changed: app }).version, "0.5.6");
  });
});

describe("nextVersion on ti", () => {
  const ti = { channel: "ti", changed: app } as const;

  it("bumps the patch of the highest version tagged, with the -ti suffix", () => {
    const decision = nextVersion({ ...ti, version: "0.5.4-ti", tags: ["v0.5.3-ti", "v0.5.4"] });
    assert.equal(decision.version, "0.5.5-ti");
    assert.match(
      decision.reason,
      /v0\.5\.4 is the highest version tagged: this run releases 0\.5\.5-ti/,
    );
  });

  it("bumps the minor for a feat/ PR, with the -ti suffix", () => {
    const decision = nextVersion({
      ...ti,
      version: "0.5.5-ti",
      tags: ["v0.5.5-ti"],
      bump: { size: "minor", pr: { number: 20, branch: "feat/20-sleep-timer" } },
    });
    assert.equal(decision.version, "0.6.0-ti");
  });

  it("takes the next number when a merge from main left a stable version in package.json", () => {
    const decision = nextVersion({ ...ti, version: "0.5.6", tags: ["v0.5.5-ti", "v0.5.6"] });
    assert.equal(decision.version, "0.5.7-ti");
  });

  it("releases a version set by hand above every tag as it is, as a -ti one", () => {
    const tags = ["v0.5.6", "v0.5.7-ti"];
    assert.equal(nextVersion({ ...ti, version: "1.0.0-ti", tags }).version, "1.0.0-ti");
    assert.equal(nextVersion({ ...ti, version: "1.0.0", tags }).version, "1.0.0-ti");
  });

  it("starts from the version in package.json when no version is tagged yet", () => {
    assert.equal(nextVersion({ ...ti, version: "0.5.1-ti", tags: [] }).version, "0.5.1-ti");
  });

  it("releases nothing when only CI, docs or specs changed since the previous tag", () => {
    const decision = nextVersion({
      channel: "ti",
      version: "0.5.5-ti",
      tags: ["v0.5.5-ti"],
      changed: ["docs/spec.md", "scripts/ci/repack.ts"],
    });
    assert.equal(decision.version, undefined);
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
  const release = (...pullRequests: MergedPr[]) => {
    const commits = pullRequests.map((merged) => merged.mergeCommit);
    return { commits, unreleased: commits, pullRequests };
  };

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
      unreleased: ["commit-12", "commit-20"],
      pullRequests: [
        pr(12, "fix/queue-row"),
        pr(20, "feat/20-auto-version", { files: [".github/workflows/ci.yml", "docs/spec.md"] }),
        pr(21, "feat/21-elsewhere"),
      ],
    });
    assert.deepEqual(bump, { size: "patch" });
  });

  it("doesn't count a feat/ PR that a release of either channel already shipped", () => {
    // ti's 0.6.0-ti shipped #14; merging ti into main brings it to main's notes again.
    const bump = bumpFor({
      commits: ["commit-12", "commit-14", "commit-30"],
      unreleased: ["commit-12", "commit-30"],
      pullRequests: [
        pr(12, "fix/queue-row", { base: "ti" }),
        pr(14, "feat/14-sleep-timer", { base: "ti" }),
        pr(30, "ti"),
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
  const appPackage = (name: string, version: string) =>
    file(name, [JSON.stringify({ name: "@wave/mobile", version })]);
  const spawn = (args: string[]) =>
    spawnSync(process.execPath, [script, ...args], { encoding: "utf8" });
  const run = (args: string[]) => spawn(args).stdout;
  const tags = file("tags.txt", ["latest", "v0.5.3", "v0.5.3-ti"]);
  const at = (version: string) => [
    "--package",
    appPackage(`package-${version}.json`, version),
    "--tags",
    tags,
  ];

  it("prints the GitHub output line, empty when nothing is released", () => {
    assert.equal(run([...at("0.5.3"), "--changed", file("app.txt", app)]), "version=0.5.4\n");
    const docs = file("docs.txt", ["docs/spec.md"]);
    assert.equal(run([...at("0.5.3"), "--changed", docs]), "version=\n");
  });

  it("counts everything as changed without a file of changed paths", () => {
    assert.equal(run(at("0.5.3")), "version=0.5.4\n");
  });

  it("releases a -ti version with --ti", () => {
    const changed = file("ti.txt", app);
    assert.equal(run(["--ti", ...at("0.5.3-ti"), "--changed", changed]), "version=0.5.4-ti\n");
  });

  it("releases nothing when the app's package.json changed only its version", () => {
    const changed = file("package-only.txt", ["apps/mobile/package.json"]);
    const previous = appPackage("previous.json", "0.5.3-ti");
    const args = [...at("0.5.3"), "--changed", changed, "--previous-package", previous];
    assert.equal(run(args), "version=\n");
  });

  it("releases a commit already tagged for its channel as it is", () => {
    const own = file("own.txt", ["v0.5.3"]);
    const changed = file("none.txt", []);
    assert.equal(run([...at("0.5.3"), "--own", own, "--changed", changed]), "version=0.5.3\n");
  });

  it("bumps by the unreleased merged PRs it's given with the release's commits, and logs why", () => {
    const commits = file("commits.txt", ["commit-12", "commit-14", "commit-15"]);
    const prs = file("prs.jsonl", [
      JSON.stringify(pr(12, "fix/queue-row")),
      JSON.stringify(pr(14, "feat/14-sleep-timer")),
      JSON.stringify(pr(15, "feat/15-lyrics")),
    ]);
    const changed = file("app.txt", app);
    const args = [...at("0.5.3"), "--changed", changed, "--commits", commits, "--prs", prs];
    const unreleased = file("unreleased.txt", ["commit-12", "commit-15"]);
    const result = spawn([...args, "--unreleased", unreleased]);
    assert.equal(result.stdout, "version=0.6.0\n");
    assert.match(result.stderr, /a minor bump, because #15 \(feat\/15-lyrics\)/);
    const shipped = file("shipped.txt", ["commit-12"]);
    assert.equal(run([...args, "--unreleased", shipped]), "version=0.5.4\n");
  });
});
