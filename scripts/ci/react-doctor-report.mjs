import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

// React Doctor 0.9.18 can return 0 after incomplete scans or baseline failures.
// Trust its native finding comparison only when the report confirms completion.
const [reportPath, mode = "full"] = process.argv.slice(2);
const report = JSON.parse(readFileSync(reportPath, "utf8"));

// React Doctor counts every changed file in the scanned directory, native code included, but
// only scans a project when React source changed. Ask git whether any did; any doubt (no
// directory, unknown base, git failing) counts as a source change, so the gate stays closed.
const SOURCE = /\.(?:astro|[cm]?[jt]sx?|mts|cts|html?)$/i;
function changesReactSource() {
  if (!report.directory || !report.baseline?.baseRef) return true;
  const git = (...args) =>
    spawnSync("git", ["-C", report.directory, ...args], { encoding: "utf8" });
  const changed = git("diff", "--name-only", "--relative", report.baseline.baseRef);
  const untracked = git("ls-files", "--others", "--exclude-standard");
  if (changed.status !== 0 || untracked.status !== 0) return true;
  return `${changed.stdout}\n${untracked.stdout}`.split("\n").some((file) => SOURCE.test(file));
}

const emptyComparison =
  mode === "baseline" &&
  (report.diff?.changedFileCount === 0 || !changesReactSource()) &&
  report.projects?.length === 0 &&
  report.diagnostics?.length === 0 &&
  report.summary?.errorCount === 0 &&
  report.summary?.warningCount === 0;
if (
  !["full", "baseline"].includes(mode) ||
  report.schemaVersion !== 3 ||
  report.ok !== true ||
  report.mode !== mode ||
  report.baselineDegraded === true ||
  report.diagnosticsAreGateExempt === true ||
  (report.skippedProjects ?? []).length !== 0 ||
  !Array.isArray(report.diagnostics) ||
  !Number.isInteger(report.summary?.errorCount) ||
  report.summary.errorCount < 0 ||
  !Number.isInteger(report.summary?.warningCount) ||
  report.summary.warningCount < 0 ||
  (mode === "baseline" && (report.baseline?.source !== "base" || !report.baseline.baseRef)) ||
  (!emptyComparison &&
    (report.reactDetected !== true ||
      !Array.isArray(report.projects) ||
      report.projects.length !== 1 ||
      report.projects.some(
        (project) => project.complete !== true || project.skippedChecks?.length !== 0,
      )))
) {
  const reasons = [
    report.error?.message,
    ...(report.projects ?? []).flatMap((project) =>
      Object.values(project.skippedCheckReasons ?? {}),
    ),
  ].filter(Boolean);
  throw new Error(
    `React Doctor did not complete a valid ${mode} mobile scan (${reportPath}). ${reasons.join(" ")}`,
  );
}

const lines = report.diagnostics.flatMap((diagnostic) => [
  `${diagnostic.filePath}:${diagnostic.line}:${diagnostic.column} ${diagnostic.severity} ${diagnostic.plugin}/${diagnostic.rule}`,
  `  ${diagnostic.message}`,
  ...(diagnostic.help ? [`  ${diagnostic.help}`] : []),
]);
for (const line of lines) console.log(line);
const label = mode === "full" ? "Full mobile diagnostics (advisory)" : "New React diagnostics";
const summary = `${label}: ${report.summary.errorCount} errors, ${report.summary.warningCount} warnings.`;
console.log(summary);
console.log(`JSON report: ${reportPath}`);
writeFileSync(
  `${reportPath}.md`,
  [
    `#### ${summary}`,
    "",
    ...(lines.length > 0
      ? [
          "```text",
          ...lines.slice(0, 30).map((line) => line.slice(0, 400).replaceAll("```", "'''")),
          "```",
          "",
        ]
      : []),
    ...(lines.length > 30
      ? ["Remaining diagnostics are in the job logs and JSON artifact.", ""]
      : []),
  ].join("\n"),
);
if (mode === "baseline" && report.summary.errorCount > 0) process.exitCode = 1;
