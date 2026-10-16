// Prints the step-durations table for one job read as JSON from stdin (one job per line,
// as `gh api --jq` prints it; the first is used). Prints nothing when stdin is empty.
// Exits 3 when the API hasn't caught up to <reporting step> yet, so the caller can retry.
//   gh api .../jobs --jq '.jobs[] | select(.name == "Checks")' \
//     | node scripts/ci/step-durations-cli.ts "<reporting step>"
import { readFileSync } from "node:fs";

import { formatStepDurations, reachedStep, type Job, type Step } from "./step-durations.ts";

const isTimestamp = (value: unknown): value is string =>
  typeof value === "string" && Number.isFinite(Date.parse(value));

const isStep = (value: unknown): value is Step =>
  typeof value === "object" &&
  value !== null &&
  "name" in value &&
  typeof value.name === "string" &&
  "status" in value &&
  typeof value.status === "string" &&
  "conclusion" in value &&
  (value.conclusion === null || typeof value.conclusion === "string") &&
  "started_at" in value &&
  (value.started_at === null || isTimestamp(value.started_at)) &&
  "completed_at" in value &&
  (value.completed_at === null || isTimestamp(value.completed_at));

const isJob = (value: unknown): value is Job =>
  typeof value === "object" &&
  value !== null &&
  "started_at" in value &&
  isTimestamp(value.started_at) &&
  (!("steps" in value) || (Array.isArray(value.steps) && value.steps.every(isStep)));

const parseJob = (line: string): Job => {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    throw new Error("Invalid job JSON: expected valid JSON on the first input line.");
  }
  if (!isJob(value))
    throw new Error(
      "Invalid job JSON: expected a started_at timestamp and optional steps array with string name and status, nullable string conclusion, and nullable started_at/completed_at timestamps.",
    );
  return value;
};

const reportingStep = process.argv[2] ?? "Report";
const [line] = readFileSync(0, "utf8").trim().split("\n");
if (line) {
  const job = parseJob(line);
  process.stdout.write(`${formatStepDurations(job, new Date())}\n`);
  if (!reachedStep(job, reportingStep)) process.exitCode = 3;
}
