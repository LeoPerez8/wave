// Runs secret-scan.sh in scratch repos with a stand-in gitleaks. Needs bash and git (POSIX).
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("./secret-scan.sh", import.meta.url));

/** A scratch repo with scripts/ci (previous-tag.sh reads its tags) and a commit per name. */
const repo = () => {
  const dir = mkdtempSync(join(tmpdir(), "wave-scan-"));
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", dir, ...args], { encoding: "utf8" }).trim();
  git("init", "-q", "-b", "main");
  const commit = (name: string) => {
    writeFileSync(join(dir, `${name}.txt`), name);
    git("add", ".");
    git("-c", "user.name=t", "-c", "user.email=t@localhost", "commit", "-q", "-m", name);
    return git("rev-parse", "HEAD");
  };
  // A stand-in gitleaks: it finds the self-check's planted secret, and logs every other scan,
  // failing it when told to.
  const gitleaks = join(dir, "..", `${dir.split(/[\\/]/).pop()}-gitleaks`);
  writeFileSync(
    gitleaks,
    `#!/usr/bin/env bash
for arg in "$@"; do
  if [ "$prev" = --report-path ]; then echo '"generic-api-key"' > "$arg"; exit 0; fi
  prev="$arg"
done
echo "$@" >> "${dir}.scans"
exit "\${FAKE_LEAK:-0}"
`,
  );
  chmodSync(gitleaks, 0o755);
  return { dir, git, commit, gitleaks, scans: () => readFileSync(`${dir}.scans`, "utf8") };
};

const scan = (
  fixture: ReturnType<typeof repo>,
  env: Record<string, string>,
): { status: number | null; stderr: string; output: string } => {
  const output = `${fixture.dir}.output`;
  writeFileSync(output, "");
  const run = spawnSync("bash", [script], {
    cwd: fixture.dir,
    encoding: "utf8",
    env: {
      PATH: process.env.PATH ?? "",
      HOME: process.env.HOME ?? "",
      GITLEAKS: fixture.gitleaks,
      GITHUB_OUTPUT: output,
      ...env,
    },
  });
  return { status: run.status, stderr: run.stderr, output: readFileSync(output, "utf8") };
};

describe("secret-scan.sh for a release source", () => {
  it("scans every commit since the channel's previous release, up to the version bump", () => {
    const fixture = repo();
    const previous = fixture.commit("previous");
    fixture.git("tag", "v1.2.0-ti");
    const pushed = fixture.commit("pushed");
    const bump = fixture.commit("bump");
    fixture.git("tag", "v1.3.0-ti");
    const { status, stderr, output } = scan(fixture, {
      GITHUB_EVENT_NAME: "push",
      GITHUB_REF: "refs/heads/main",
      GITHUB_SHA: pushed,
      BEFORE: previous,
      SOURCE_SHA: bump,
    });
    assert.equal(status, 0, stderr);
    assert.match(fixture.scans(), new RegExp(`--log-opts=${previous}\\.\\.${bump}`));
    assert.match(output, new RegExp(`^source=${bump}$`, "m"));
    assert.match(output, new RegExp(`^range=${previous}\\.\\.${bump}$`, "m"));
  });

  it("scans a stable release from the previous stable one, past the ti releases between", () => {
    const fixture = repo();
    const stable = fixture.commit("stable");
    fixture.git("tag", "v1.2.0");
    fixture.commit("tested");
    fixture.git("tag", "v1.2.1-ti");
    const promoted = fixture.commit("promoted");
    fixture.git("tag", "v1.3.0-ti");
    fixture.git("tag", "v1.3.0");
    const { status, stderr, output } = scan(fixture, {
      GITHUB_EVENT_NAME: "workflow_dispatch",
      GITHUB_REF: "refs/tags/v1.3.0",
      GITHUB_SHA: promoted,
      SOURCE_SHA: promoted,
    });
    assert.equal(status, 0, stderr);
    assert.match(output, new RegExp(`^range=${stable}\\.\\.${promoted}$`, "m"));
  });

  it("scans the source's whole history when no release precedes it", () => {
    const fixture = repo();
    fixture.commit("first");
    const source = fixture.commit("second");
    const { status, output } = scan(fixture, {
      GITHUB_EVENT_NAME: "push",
      GITHUB_REF: "refs/heads/main",
      GITHUB_SHA: source,
      SOURCE_SHA: source,
    });
    assert.equal(status, 0);
    assert.match(output, new RegExp(`^range=${source}$`, "m"));
  });

  it("scans a PR's commits up to its autofix commit", () => {
    const fixture = repo();
    const base = fixture.commit("base");
    fixture.commit("change");
    const autofix = fixture.commit("autofix");
    const { status, output } = scan(fixture, {
      GITHUB_EVENT_NAME: "pull_request",
      BASE_SHA: base,
      SOURCE_SHA: autofix,
    });
    assert.equal(status, 0);
    assert.match(output, new RegExp(`^range=${base}\\.\\.${autofix}$`, "m"));
  });

  it("leaves no evidence when the scan finds a secret", () => {
    const fixture = repo();
    const source = fixture.commit("leak");
    const { status, output } = scan(fixture, {
      GITHUB_EVENT_NAME: "push",
      GITHUB_REF: "refs/heads/main",
      GITHUB_SHA: source,
      SOURCE_SHA: source,
      FAKE_LEAK: "1",
    });
    assert.notEqual(status, 0);
    assert.equal(output, "");
  });

  it("refuses to scan when the checkout isn't the release source", () => {
    const fixture = repo();
    const source = fixture.commit("source");
    fixture.commit("later");
    const { status, stderr, output } = scan(fixture, {
      GITHUB_EVENT_NAME: "push",
      GITHUB_REF: "refs/heads/main",
      GITHUB_SHA: source,
      SOURCE_SHA: source,
    });
    assert.notEqual(status, 0);
    assert.match(stderr, /not the release source/);
    assert.equal(output, "");
    assert.equal(existsSync(`${fixture.dir}.scans`), false);
  });
});
