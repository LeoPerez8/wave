import assert from "node:assert/strict";
import { test } from "node:test";

import { formatStepDurations } from "./step-durations.ts";

const now = new Date("2026-10-14T12:20:00Z");

test("lists each completed step with how long it took", () => {
  const job = {
    started_at: "2026-10-14T12:00:00Z",
    steps: [
      {
        name: "Install",
        status: "completed",
        conclusion: "success",
        started_at: "2026-10-14T12:00:00Z",
        completed_at: "2026-10-14T12:00:42Z",
      },
      {
        name: "Gradle assembleRelease",
        status: "completed",
        conclusion: "success",
        started_at: "2026-10-14T12:01:00Z",
        completed_at: "2026-10-14T12:14:05Z",
      },
    ],
  };

  const table = formatStepDurations(job, now);

  assert.match(table, /\| Install \| 42s \|/);
  assert.match(table, /\| Gradle assembleRelease \| 13m 05s \|/);
});

test("shows a skipped step as skipped", () => {
  // GitHub stamps skipped steps with a start and end time too.
  const job = {
    started_at: "2026-10-14T12:00:00Z",
    steps: [
      {
        name: "Autofix lockfile and formatting",
        status: "completed",
        conclusion: "skipped",
        started_at: "2026-10-14T12:00:10Z",
        completed_at: "2026-10-14T12:00:10Z",
      },
    ],
  };

  assert.match(formatStepDurations(job, now), /\| Autofix lockfile and formatting \| skipped \|/);
});

test("marks the step that failed, keeping its time", () => {
  const job = {
    started_at: "2026-10-14T12:00:00Z",
    steps: [
      {
        name: "Typecheck",
        status: "completed",
        conclusion: "failure",
        started_at: "2026-10-14T12:00:00Z",
        completed_at: "2026-10-14T12:01:30Z",
      },
    ],
  };

  assert.match(formatStepDurations(job, now), /\| Typecheck \| 1m 30s ❌ \|/);
});

test("gives the job's time up to now, since the job is still running when it reports", () => {
  const job = { started_at: "2026-10-14T11:58:30Z", steps: [] };

  assert.match(formatStepDurations(job, now), /Job took 21m 30s/);
});

test("leaves out steps that haven't finished, like the report step itself", () => {
  const job = {
    started_at: "2026-10-14T12:00:00Z",
    steps: [
      {
        name: "Test",
        status: "completed",
        conclusion: "success",
        started_at: "2026-10-14T12:00:00Z",
        completed_at: "2026-10-14T12:00:20Z",
      },
      {
        name: "Report",
        status: "in_progress",
        conclusion: null,
        started_at: "2026-10-14T12:00:20Z",
        completed_at: null,
      },
      {
        name: "Post Run actions/checkout@v5",
        status: "pending",
        conclusion: null,
        started_at: null,
        completed_at: null,
      },
    ],
  };

  const table = formatStepDurations(job, now);

  assert.match(table, /\| Test \| 20s \|/);
  assert.doesNotMatch(table, /Report \|/);
  assert.doesNotMatch(table, /Post Run/);
});
