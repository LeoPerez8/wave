import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { comparability, readResults, type RunRecord } from "./results.ts";

const RUN: RunRecord = {
  type: "run",
  schema: 1,
  run: "baseline",
  label: "baseline",
  startedAt: "2026-10-16T12:00:00.000Z",
  dryRun: false,
  runner: {},
  apk: {
    package: "dev.leoperez.wave",
    versionName: "0.5.3-ti",
    versionCode: 503,
    lastUpdateTime: null,
    commit: "6f32163",
    file: null,
  },
  device: {
    serial: "RQCX208NW4R",
    manufacturer: "samsung",
    model: "SM-S926B",
    android: "16",
    sdk: 36,
    fingerprint: "samsung/x/y:16/A/1:user/release-keys",
  },
  display: {
    refreshRateHz: 120,
    peakRefreshRate: "120.0",
    minRefreshRate: null,
    refreshRateMode: "1",
  },
  animationScales: { window: "1.0", transition: "1.0", animator: "1.0" },
  compilation: { status: "speed-profile", reason: "bg-dexopt" },
  perfBuild: true,
  library: {
    tracks: 10_000,
    playlists: 30,
    playlistItems: 5_000,
    largestPlaylist: 2_000,
    playEvents: 50_000,
  },
  importLink: null,
  app: null,
  thermalStatus: 0,
  manual: {},
};

describe("comparability", () => {
  it("has nothing to say about two runs on the same phone, set up the same way", () => {
    assert.deepEqual(comparability(RUN, { ...RUN, apk: { ...RUN.apk, commit: "abc1234" } }), []);
  });

  it("warns when the phone, its refresh rate or the compiler filter differ", () => {
    const after: RunRecord = {
      ...RUN,
      device: { ...RUN.device, model: "Pixel 8" },
      display: { ...RUN.display, refreshRateHz: 60 },
      compilation: { status: "verify", reason: "install" },
    };
    assert.deepEqual(comparability(RUN, after), [
      "Different phones: SM-S926B, then Pixel 8.",
      "Refresh rate: 120 Hz, then 60 Hz.",
      "Compiler filter: speed-profile, then verify.",
    ]);
  });

  it("warns when the Library grew or shrank by more than 1%", () => {
    const after: RunRecord = {
      ...RUN,
      library: { ...RUN.library, tracks: 10_050, playEvents: 60_000 },
    };
    assert.deepEqual(comparability(RUN, after), ["Play history: 50000, then 60000."]);
  });

  it("warns when one run is a perf build and the other isn't, or either is a dry run", () => {
    assert.deepEqual(comparability(RUN, { ...RUN, perfBuild: false, dryRun: true }), [
      "Perf build: yes, then no.",
      "A dry run's numbers are simulated: don't compare them.",
    ]);
  });
});

describe("readResults", () => {
  it("sorts a file's records by type", () => {
    const text = [
      JSON.stringify(RUN),
      JSON.stringify({
        type: "error",
        run: "baseline",
        scenario: "import",
        variant: "import",
        message: "no link",
      }),
      "",
      JSON.stringify({ type: "end", run: "baseline", finishedAt: "x", thermalStatus: 1 }),
    ].join("\n");
    const results = readResults(text);
    assert.equal(results.run?.label, "baseline");
    assert.equal(results.errors[0]?.message, "no link");
    assert.equal(results.end?.thermalStatus, 1);
    assert.deepEqual(results.steps, []);
  });
});
