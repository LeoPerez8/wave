import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
