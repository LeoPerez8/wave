import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

test("both desktop CI runners measure performance and keep the run's memory at rest", () => {
  const workflow = readFileSync(
    new URL("../../../.github/workflows/desktop.yml", import.meta.url),
    "utf8",
  );
  const desktop = workflow.split("\n  desktop:")[1]!.split(/\n  [a-z-]+:/)[0]!;
  assert.match(desktop, /os: ubuntu-22\.04/);
  assert.match(desktop, /os: windows-latest/);
  assert.match(desktop, /xvfb-run -a pnpm --filter @wave\/desktop test:perf/);
  assert.match(desktop, /"Performance" pnpm --filter @wave\/desktop test:perf/);
  assert.match(desktop, /name: desktop-performance-\$\{\{ matrix.report \}\}/);
  assert.match(desktop, /path: apps\/desktop\/perf-results/);
  assert.match(desktop, /if-no-files-found: error/);
});
