// Prints the step-durations table for one job read as JSON from stdin (one job per line,
// as `gh api --jq` prints it; the first is used). Prints nothing when stdin is empty.
// Exits 3 when the API hasn't caught up to <reporting step> yet, so the caller can retry.
//   gh api .../jobs --jq '.jobs[] | select(.name == "Checks")' \
//     | node scripts/ci/step-durations-cli.ts "<reporting step>"
import { readFileSync } from "node:fs";

import { formatStepDurations, reachedStep } from "./step-durations.ts";

const reportingStep = process.argv[2] ?? "Report";
const [line] = readFileSync(0, "utf8").trim().split("\n");
if (line) {
  const job = JSON.parse(line);
  process.stdout.write(`${formatStepDurations(job, new Date())}\n`);
  if (!reachedStep(job, reportingStep)) process.exitCode = 3;
}
