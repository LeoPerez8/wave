import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import { FakeDevice } from "./fakeDevice.ts";
import { summarize, type StepRecord } from "./metrics.ts";
import { readResults } from "./results.ts";
import { runPerf, type RunOptions } from "./runner.ts";
import { ALL_SCENARIOS, GLASS_SCENARIOS } from "./scenarios.ts";

const dir = mkdtempSync(join(tmpdir(), "wave-perf-"));
after(() => rmSync(dir, { recursive: true, force: true }));

const options = (name: string, overrides: Partial<RunOptions> = {}): RunOptions => ({
  package: "dev.leoperez.wave",
  label: "test",
  scenarios: ALL_SCENARIOS,
  variants: ["idle"],
  iterations: 2,
  config: { tabs: ["Home", "Library", "Playlists"], artist: "Radiohead" },
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
  glass: null,
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
      "warm-start/idle/warm",
      "tab-first/idle/first",
      "tab-switch/idle/tab",
      "rapid-tabs/idle/burst",
      "push-settings/idle/push",
      "push-settings/idle/pop",
      "push-library/idle/push",
      "push-library/idle/pop",
      "push-tracklist/idle/push",
      "push-tracklist/idle/pop",
      "push-artist/idle/push",
      "push-artist/idle/pop",
      "push-empty/idle/push",
      "push-empty/idle/pop",
      "now-playing/idle/open",
      "now-playing/idle/close",
      "queue/idle/open",
      "queue/idle/close",
      "skip/idle/next",
      "scrub/idle/forward",
      "scrub/idle/back",
      "queue-drag/idle/down",
      "queue-drag/idle/up",
      "search-first-tap/idle/first-tap",
      "search-typing/idle/type",
    ]);
    const expecting = steps.filter((step) => step.expectMissing !== null);
    assert.ok(expecting.length > 0);
    for (const step of expecting) {
      assert.equal(step.expectMissing, false, `${step.scenario} ${step.measure} lost its mark`);
      assert.ok((step.responseMs ?? -1) > 0, `${step.scenario} ${step.measure} has no response`);
    }
    // Launches have no touch to count a first frame from.
    const launches = new Set(["startup", "warm-start"]);
    for (const step of steps.filter((measured) => !launches.has(measured.scenario))) {
      assert.ok(step.firstFrameMs !== null, `${step.scenario} ${step.measure} has no first frame`);
      assert.ok(step.frames.total > 0);
    }
    assert.equal(memory.length, ALL_SCENARIOS.length);
  });

  it("times a tab's commit and layout apart from its frames, on first and warm visits", async () => {
    const { out } = await runPerf(
      new FakeDevice(),
      options("tabs", { scenarios: ["tab-first", "tab-switch", "rapid-tabs"] }),
    );
    const { steps } = readResults(readFileSync(out, "utf8"));
    for (const step of steps.filter((tab) => tab.scenario !== "rapid-tabs")) {
      assert.ok((step.phasesMs?.["tab.commit"] ?? -1) > 0, `${step.scenario} has no commit`);
      assert.ok((step.phasesMs?.["tab.layout"] ?? -1) > 0, `${step.scenario} has no layout`);
    }
    // A burst counts from its last tap to the tabs settling on the tab it tapped.
    const bursts = steps.filter((step) => step.scenario === "rapid-tabs");
    assert.ok(bursts.length > 0);
    for (const step of bursts) assert.equal(step.expectMissing, false);
  });

  it("compiles with only the APK's shipped profile first when asked for the baseline state", async () => {
    const { out } = await runPerf(
      new FakeDevice({ savedProfile: ["Lcom/example/Learned;"] }),
      options("baseline", { scenarios: ["startup"], compile: "baseline" }),
    );
    const { run } = readResults(readFileSync(out, "utf8"));
    assert.deepEqual(run?.compilation, { status: "speed-profile", reason: "cmdline" });
    // The simulated APK ships two rules (one class, one method); what the phone learned is gone.
    assert.deepEqual(run?.artProfile, { install: "INSTALL_SUCCESS", classes: 1, methods: 1 });
  });

  it("drags in dp from its target, at the phone's density", async () => {
    const device = new FakeDevice();
    await runPerf(device, options("drag", { scenarios: ["scrub", "queue-drag"], iterations: 1 }));
    const swipes = device.commands.filter((command) => command.startsWith("input swipe"));
    // The simulated phone draws 3 px a dp. Its scrubber is centred at (720, 2248), and
    // the first Up Next row's Remove button at (1200, 900), with the handle 48 dp right of it.
    // A warm-up iteration, then the measured one, for each scenario.
    assert.equal(swipes.length, 8);
    assert.deepEqual(swipes.slice(0, 2), [
      "input swipe 360 2248 1080 2248 1000",
      "input swipe 1080 2248 360 2248 1000",
    ]);
    assert.deepEqual(swipes.slice(-2), [
      "input swipe 1344 900 1344 1404 800",
      "input swipe 1344 1404 1344 900 800",
    ]);
  });

  it("times cold launches", async () => {
    const { out } = await runPerf(new FakeDevice(), options("startup", { scenarios: ["startup"] }));
    const [launch] = readResults(readFileSync(out, "utf8")).steps as (StepRecord & {
      launch?: { totalTimeMs: number };
    })[];
    assert.equal(launch?.launch?.totalTimeMs, 742);
  });

  it("times warm launches back from the home screen, the process still alive", async () => {
    const { out } = await runPerf(new FakeDevice(), options("warm", { scenarios: ["warm-start"] }));
    const { steps, errors } = readResults(readFileSync(out, "utf8"));
    assert.deepEqual(errors, []);
    const launches = (steps as (StepRecord & { launch?: { launchState: string } })[]).map(
      (step) => step.launch?.launchState,
    );
    assert.deepEqual(launches, ["HOT", "HOT"]);
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

  it("records Search's index counters with each step of a perf build", async () => {
    const { out } = await runPerf(
      new FakeDevice(),
      options("search", { scenarios: ["search-typing"] }),
    );
    const { steps } = readResults(readFileSync(out, "utf8"));
    const search = (steps as (StepRecord & { search?: Record<string, unknown> })[]).map(
      (step) => step.search,
    );
    assert.ok(search.length > 0);
    assert.ok(search.every((counters) => typeof counters?.["prepared"] === "number"));
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

  it("records push-artist as one it can't run when the fixture names no artist", async () => {
    const { out } = await runPerf(
      new FakeDevice(),
      options("no-artist", {
        config: { tabs: ["Home", "Library", "Playlists"], artist: null },
        scenarios: ["push-artist", "push-settings"],
      }),
    );
    const { errors, steps } = readResults(readFileSync(out, "utf8"));
    assert.equal(errors[0]?.scenario, "push-artist");
    assert.match(errors[0]?.message ?? "", /artist/);
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

  it("measures flings under the glass and an idle screen (the glass scenarios)", async () => {
    const device = new FakeDevice();
    const { out } = await runPerf(device, options("glass", { scenarios: GLASS_SCENARIOS }));
    const { steps, errors } = readResults(readFileSync(out, "utf8"));
    assert.deepEqual(errors, []);
    assert.deepEqual(
      summarize(steps).map((row) => row.key),
      [
        "scroll-home/idle/fling-up",
        "scroll-home/idle/fling-down",
        "scroll-songs/idle/fling-up",
        "scroll-songs/idle/fling-down",
        "idle-home/idle/idle",
      ],
    );
    // A fling is a swipe across the middle of the screen, clear of the chrome at the bottom.
    assert.ok(device.commands.includes("input swipe 720 2184 720 936 120"));
    assert.ok(device.commands.includes("input swipe 720 936 720 2184 120"));
    for (const step of steps.filter((one) => one.measure.startsWith("fling"))) {
      assert.ok(step.touchAt !== null, "a fling is measured from its touch");
      assert.ok(step.frames.total > 120, "a fling renders more frames than gfxinfo keeps");
      assert.ok(step.frameParts.issueMs.frames > 0, "and splits the kept ones into their parts");
    }
    const idle = steps.filter((one) => one.scenario === "idle-home");
    assert.ok(idle.length > 0);
    for (const step of idle) assert.equal(step.frames.total, 0, "an idle screen draws nothing");
  });

  it("launches every time with the glass probe asked for, and records it", async () => {
    const device = new FakeDevice();
    const { out } = await runPerf(
      device,
      options("probe", { scenarios: ["push-settings"], glass: "off" }),
    );
    const { run } = readResults(readFileSync(out, "utf8"));
    assert.equal(run?.runner.glass, "off");
    assert.equal(run?.app?.["glass.probe"], "off");
    const launches = device.commands.filter((command) => command.startsWith("am start -W"));
    assert.ok(launches.length > 1);
    for (const launch of launches) assert.match(launch, / --es wave\.perf\.glass off\b/);
  });

  it("stops before measuring when the app didn't take the glass probe", async () => {
    await assert.rejects(
      runPerf(
        new FakeDevice({ ignoresGlassProbe: true }),
        options("probe-ignored", { scenarios: ["push-settings"], glass: "off" }),
      ),
      /glass probe "off".*live/,
    );
  });

  it("refuses a glass probe on an APK that isn't a perf build", async () => {
    await assert.rejects(
      runPerf(
        new FakeDevice({ perfBuild: false }),
        options("probe-plain", { scenarios: ["push-settings"], glass: "blur" }),
      ),
      /perf build/,
    );
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
