import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("./step-durations-cli.ts", import.meta.url));

test("the step-durations command rejects malformed job data before printing a table", () => {
  const result = spawnSync(process.execPath, [script, "Report"], {
    input: JSON.stringify({ started_at: "2026-10-14T12:00:00Z", steps: [{ name: "Test" }] }),
    encoding: "utf8",
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Invalid job JSON.*steps.*status/i);
  assert.equal(result.stdout, "");
});

test("the step-durations command rejects an invalid job timestamp", () => {
  const result = spawnSync(process.execPath, [script], {
    input: JSON.stringify({ started_at: "not-a-date", steps: [] }),
    encoding: "utf8",
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Invalid job JSON.*started_at timestamp/i);
  assert.equal(result.stdout, "");
});

test("the step-durations command prints completed steps and succeeds once reporting starts", () => {
  const result = spawnSync(process.execPath, [script, "Report"], {
    input: JSON.stringify({
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
      ],
    }),
    encoding: "utf8",
  });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /\| Test \| 20s \|/);
  assert.equal(result.stderr, "");
});

test("the step-durations command still requests a retry when the jobs API has no steps yet", () => {
  const result = spawnSync(process.execPath, [script], {
    input: JSON.stringify({ started_at: "2026-10-14T12:00:00Z" }),
    encoding: "utf8",
  });
  assert.equal(result.status, 3);
  assert.match(result.stdout, /Job took/);
  assert.equal(result.stderr, "");
});

test("the step-durations command prints nothing for empty input", () => {
  const result = spawnSync(process.execPath, [script], { input: "", encoding: "utf8" });
  assert.equal(result.status, 0);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "");
});
