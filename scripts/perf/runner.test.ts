import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import { FakeDevice } from "./fakeDevice.ts";
import { summarize, type StepRecord } from "./metrics.ts";
import { readResults } from "./results.ts";
import { runPerf, type RunOptions } from "./runner.ts";
import { ALL_SCENARIOS } from "./scenarios.ts";

const dir = mkdtempSync(join(tmpdir(), "wave-perf-"));
after(() => rmSync(dir, { recursive: true, force: true }));

const options = (name: string, overrides: Partial<RunOptions> = {}): RunOptions => ({
  package: "dev.leoperez.wave",
  label: "test",
  scenarios: ALL_SCENARIOS,
  variants: ["idle"],
  iterations: 2,
  config: { tabs: ["Home", "Library", "Playlists"] },
  importLink: "https://music.youtube.com/playlist?list=PLdryrun",
  settleMs: 1_200,
  windowMs: 2_500,
  launchSettleMs: 6_000,
  memoryIdleMs: 3_000,
  flushTimeoutMs: 3_000,
  commit: null,
  runnerCommit: "abc1234",
  apkFile: null,
  manual: {},
  compile: null,
  perfetto: null,
  out: join(dir, `${name}.jsonl`),
  dryRun: true,
  log: () => {},
  now: () => new Date("2026-10-16T12:00:00Z"),
  ...overrides,
});

describe("runPerf on the simulated phone", () => {
  it("records the run's metadata first", async () => {
    const { out } = await runPerf(
      new FakeDevice(),
      options("meta", { scenarios: ["push-settings"] }),
    );
    const { run } = readResults(readFileSync(out, "utf8"));
    assert.equal(run?.apk.versionName, "0.5.3-ti");
    assert.equal(run?.apk.commit, "0000000");
    assert.equal(run?.device.model, "SM-DRYRUN");
    assert.equal(run?.device.android, "16");
    assert.equal(run?.display.refreshRateHz, 120);
    assert.deepEqual(run?.compilation, { status: "speed-profile", reason: "install-dm" });
    assert.equal(run?.perfBuild, true);
    assert.deepEqual(run?.library, {
      tracks: 12_345,
      playlists: 40,
      playlistItems: 6_000,
      largestPlaylist: 2_500,
      playEvents: 54_321,
    });
  });

  it("measures every step of every scenario from its touch", async () => {
    const { out } = await runPerf(new FakeDevice(), options("all"));
    const { steps, errors, memory } = readResults(readFileSync(out, "utf8"));
    assert.deepEqual(errors, []);
    const keys = summarize(steps).map((row) => row.key);
    assert.deepEqual(keys, [
      "startup/idle/cold",
      "tab-switch/idle/tab",
      "rapid-tabs/idle/burst",
      "push-settings/idle/push",
      "push-settings/idle/pop",
      "push-library/idle/push",
      "push-library/idle/pop",
      "push-tracklist/idle/push",
      "push-tracklist/idle/pop",
      "push-empty/idle/push",
      "push-empty/idle/pop",
      "now-playing/idle/open",
      "now-playing/idle/close",
      "queue/idle/open",
      "queue/idle/close",
      "search-first-tap/idle/first-tap",
    ]);
    const expecting = steps.filter((step) => step.expectMissing !== null);
    assert.ok(expecting.length > 0);
    for (const step of expecting) {
      assert.equal(step.expectMissing, false, `${step.scenario} ${step.measure} lost its mark`);
      assert.ok((step.responseMs ?? -1) > 0, `${step.scenario} ${step.measure} has no response`);
    }
    for (const step of steps.filter((measured) => measured.scenario !== "startup")) {
      assert.ok(step.firstFrameMs !== null, `${step.scenario} ${step.measure} has no first frame`);
      assert.ok(step.frames.total > 0);
    }
    assert.equal(memory.length, ALL_SCENARIOS.length);
  });

  it("times cold launches", async () => {
    const { out } = await runPerf(new FakeDevice(), options("startup", { scenarios: ["startup"] }));
    const [launch] = readResults(readFileSync(out, "utf8")).steps as (StepRecord & {
      launch?: { totalTimeMs: number };
    })[];
    assert.equal(launch?.launch?.totalTimeMs, 742);
  });

  it("runs the import first in the import variant, and every step reports its progress", async () => {
    const { out } = await runPerf(
      new FakeDevice(),
      options("import", { scenarios: ["push-settings"], variants: ["import"] }),
    );
    const { steps } = readResults(readFileSync(out, "utf8"));
    assert.deepEqual(
      [...new Set(steps.map((step) => `${step.scenario}/${step.variant}`))],
      ["import/import", "push-settings/import"],
    );
    const pushes = steps.filter((step) => step.scenario === "push-settings") as (StepRecord & {
      importProgress?: { running: boolean };
    })[];
    assert.ok(pushes.every((step) => step.importProgress?.running === true));
  });

  it("records the shared Library queries' counters with each step of a perf build", async () => {
    const { out } = await runPerf(
      new FakeDevice(),
      options("queries", { scenarios: ["push-settings"] }),
    );
    const { steps } = readResults(readFileSync(out, "utf8"));
    const queries = (steps as (StepRecord & { libraryQueries?: Record<string, unknown> })[]).map(
      (step) => step.libraryQueries,
    );
    assert.ok(queries.length > 0);
    assert.ok(queries.every((counters) => typeof counters?.["reads"] === "number"));
    assert.ok(queries.every((counters) => typeof counters?.["paused"] === "number"));
  });

  it("records a scenario it can't run and goes on", async () => {
    const { out } = await runPerf(
      new FakeDevice(),
      options("no-link", {
        importLink: null,
        scenarios: ["push-settings"],
        variants: ["import", "idle"],
      }),
    );
    const { errors, steps } = readResults(readFileSync(out, "utf8"));
    assert.equal(errors[0]?.scenario, "import");
    assert.match(errors[0]?.message ?? "", /importLink/);
    assert.ok(steps.some((step) => step.scenario === "push-settings"));
  });

  it("still measures frames, startup and memory without a perf build", async () => {
    const device = new FakeDevice({ perfBuild: false });
    const { out } = await runPerf(device, options("plain", { scenarios: ["push-settings"] }));
    const { run, steps } = readResults(readFileSync(out, "utf8"));
    assert.equal(run?.perfBuild, false);
    assert.ok(steps.length > 0);
    for (const step of steps) {
      assert.equal(step.responseMs, null);
      assert.ok(step.burstMs !== null);
    }
  });

  it("captures a Perfetto trace per scenario when asked", async () => {
    const { out } = await runPerf(
      new FakeDevice(),
      options("trace", {
        scenarios: ["push-settings"],
        perfetto: { dir: join(dir, "traces"), config: "duration_ms: 1000" },
      }),
    );
    const { traces } = readResults(readFileSync(out, "utf8"));
    assert.equal(traces.length, 1);
    assert.ok(readFileSync(traces[0]?.file ?? "", "utf8").length > 0);
  });
});
