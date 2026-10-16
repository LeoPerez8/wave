import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

const emptyComparison = {
  schemaVersion: 3,
  ok: true,
  mode: "baseline",
  baseline: { baseRef: "abc123", source: "base", newCount: 0 },
  diff: { changedFileCount: 0 },
  projects: [],
  diagnostics: [],
  summary: { errorCount: 0, warningCount: 0 },
};

function check(report, mode = "baseline") {
  const directory = mkdtempSync(join(tmpdir(), "wave-doctor-report-"));
  try {
    const path = join(directory, "report.json");
    writeFileSync(path, JSON.stringify(report));
    return spawnSync(process.execPath, ["scripts/ci/react-doctor-report.mjs", path, mode], {
      encoding: "utf8",
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test("a comparison with no changed React source passes without scanning a project", () => {
  const result = check(emptyComparison);
  assert.equal(result.status, 0, result.stderr);
});

// A repository whose last commit changes the given files under apps/mobile.
function repository(changed) {
  const root = mkdtempSync(join(tmpdir(), "wave-doctor-repo-"));
  const git = (...args) => {
    const result = spawnSync("git", ["-C", root, ...args], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  const write = (file, text) => {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), text);
  };
  git("init", "-q");
  git("config", "user.email", "ci@example.com");
  git("config", "user.name", "CI");
  write("apps/mobile/src/App.tsx", "export {};\n");
  git("add", "-A");
  git("commit", "-q", "-m", "base");
  const base = git("rev-parse", "HEAD");
  for (const file of changed) write(`apps/mobile/${file}`, `// ${file}\n`);
  git("add", "-A");
  git("commit", "-q", "-m", "change");
  return { root, base, directory: join(root, "apps/mobile") };
}

test("a comparison whose changes hold no React source passes without scanning a project", () => {
  const { root, base, directory } = repository([
    "modules/native/Downloads.kt",
    "modules/native/DownloadsTest.kt",
  ]);
  try {
    const result = check({
      ...emptyComparison,
      directory,
      baseline: { ...emptyComparison.baseline, baseRef: base },
      diff: { changedFileCount: 2 },
    });
    assert.equal(result.status, 0, result.stderr);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a comparison that scanned no project while React source changed is rejected", () => {
  const { root, base, directory } = repository(["modules/native/Downloads.kt", "src/Screen.tsx"]);
  try {
    const result = check({
      ...emptyComparison,
      directory,
      baseline: { ...emptyComparison.baseline, baseRef: base },
      diff: { changedFileCount: 2 },
    });
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /did not complete a valid baseline mobile scan/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

const completeComparison = {
  ...emptyComparison,
  reactDetected: true,
  diff: { changedFileCount: 1 },
  projects: [{ complete: true, skippedChecks: [], scannedFileCount: 1 }],
};

test("new errors fail a completed native comparison", () => {
  const result = check({
    ...completeComparison,
    diagnostics: [
      {
        filePath: "src/Probe.tsx",
        line: 6,
        column: 3,
        severity: "error",
        plugin: "react-doctor",
        rule: "rules-of-hooks",
        message: "Hook is called conditionally.",
      },
    ],
    summary: { errorCount: 1, warningCount: 0 },
  });
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stdout, /src\/Probe\.tsx:6:3 error react-doctor\/rules-of-hooks/);
});

test("existing findings remain advisory in a completed full scan", () => {
  const result = check(
    {
      ...completeComparison,
      mode: "full",
      summary: { errorCount: 1, warningCount: 73 },
    },
    "full",
  );
  assert.equal(result.status, 0, result.stderr);
});

test("native fail-open, missing, and incomplete comparisons are rejected", () => {
  for (const report of [
    { ...completeComparison, mode: "diff", baselineDegraded: true },
    { ...completeComparison, diagnosticsAreGateExempt: true },
    { ...completeComparison, baseline: undefined },
    { ...completeComparison, projects: [] },
    { ...completeComparison, skippedProjects: [{ reason: "max-duration" }] },
    { ...completeComparison, projects: [{ complete: false, skippedChecks: [] }] },
    { ...completeComparison, projects: [{ complete: true, skippedChecks: ["lint"] }] },
  ]) {
    const result = check(report);
    assert.equal(result.status, 1, JSON.stringify(report));
    assert.match(result.stderr, /did not complete a valid baseline mobile scan/);
  }
});

test("empty full scans and advisory scanner failures are rejected", () => {
  for (const report of [
    { ...emptyComparison, mode: "full" },
    {
      ...completeComparison,
      mode: "full",
      projects: [{ complete: false, skippedChecks: ["lint"] }],
    },
  ]) {
    const result = check(report, "full");
    assert.equal(result.status, 1, result.stderr);
  }
});
