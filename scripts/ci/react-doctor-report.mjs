import { readFileSync } from "node:fs";

// Advisory mode in React Doctor 0.9.18 also returns 0 on lint-engine failures.
// Validate the native report before treating its findings as an advisory scan.
const report = JSON.parse(readFileSync(process.argv[2], "utf8"));
if (
  report.schemaVersion !== 3 ||
  report.ok !== true ||
  report.reactDetected !== true ||
  report.mode !== "full" ||
  !Array.isArray(report.projects) ||
  report.projects.length !== 1 ||
  report.projects.some((project) => project.complete !== true || project.skippedChecks.length !== 0)
) {
  const reasons = [
    report.error?.message,
    ...(report.projects ?? []).flatMap((project) =>
      Object.values(project.skippedCheckReasons ?? {}),
    ),
  ].filter(Boolean);
  throw new Error(
    `React Doctor did not complete the full mobile scan (${process.argv[2]}). ${reasons.join(" ")}`,
  );
}

for (const diagnostic of report.diagnostics) {
  console.log(
    `${diagnostic.filePath}:${diagnostic.line}:${diagnostic.column} ${diagnostic.severity} ${diagnostic.plugin}/${diagnostic.rule}`,
  );
  console.log(`  ${diagnostic.message}`);
  if (diagnostic.help) console.log(`  ${diagnostic.help}`);
}

console.log(
  `React Doctor: ${report.summary.errorCount} errors, ${report.summary.warningCount} warnings across ${report.projects[0].scannedFileCount} files (advisory).`,
);
console.log(`Full report: ${process.argv[2]}`);
