import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { nextVersion } from "./next-version.ts";

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

  it("takes the next number when a merge from ti left a -ti version in package.json", () => {
    const tags = ["v0.5.3", "v0.5.4-ti"];
    assert.equal(nextVersion({ version: "0.5.4-ti", tags, changed: app }).version, "0.5.5");
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
});
