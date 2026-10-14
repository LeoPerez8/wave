// The step fields we read from GitHub's "list jobs for a workflow run attempt" API.
export interface Step {
  name: string;
  status: string;
  conclusion: string | null;
  started_at: string | null;
  completed_at: string | null;
}

export interface Job {
  started_at: string;
  steps?: Step[];
}

// The jobs API lags behind the runner. Steps run in order, so once it shows the named
// step (the one reporting) as started, every step before it has its final state.
export function reachedStep(job: Job, name: string): boolean {
  return (job.steps ?? []).some(
    (step) => step.name === name && step.status !== "pending" && step.status !== "queued",
  );
}

export function formatStepDurations(job: Job, now: Date): string {
  const total = formatDuration(now.getTime() - Date.parse(job.started_at));
  const rows = (job.steps ?? [])
    .filter((step) => step.status === "completed")
    .map((step) => `| ${step.name} | ${stepTime(step)} |`);
  return [
    "<details>",
    `<summary>⏱️ Job took ${total} up to this report</summary>`,
    "",
    "| Step | Time |",
    "|---|---|",
    ...rows,
    "",
    "</details>",
  ].join("\n");
}

function stepTime(step: Step): string {
  if (step.conclusion === "skipped") return "skipped";
  const time = formatDuration(
    Date.parse(step.completed_at ?? "") - Date.parse(step.started_at ?? ""),
  );
  return step.conclusion === "failure" ? `${time} ❌` : time;
}

function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${String(seconds % 60).padStart(2, "0")}s`;
}
