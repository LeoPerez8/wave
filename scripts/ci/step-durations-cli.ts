// Prints the step-durations table for one job read as JSON from stdin (one job per line,
// as `gh api --jq` prints it; the first is used). Prints nothing when stdin is empty.
//   gh api .../jobs --jq '.jobs[] | select(.name == "Checks")' | node scripts/ci/step-durations-cli.ts
import { readFileSync } from "node:fs";

import { formatStepDurations } from "./step-durations.ts";

const [line] = readFileSync(0, "utf8").trim().split("\n");
if (line) process.stdout.write(`${formatStepDurations(JSON.parse(line), new Date())}\n`);
