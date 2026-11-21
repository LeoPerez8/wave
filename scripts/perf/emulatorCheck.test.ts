import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { speedSummaryLine, type TimingKind } from "../../packages/core/src/index.ts";
import { TAP_KIND_NAMES, checkLog, formatVerdict, runEmulatorCheck } from "./emulatorCheck.ts";
import type { Device } from "./runner.ts";

const SINCE = "2026-11-21T10:00:00.000Z";

/** App log lines as `formatLogEntry` writes them. */
const line = (at: string, message: string, level = "W"): string =>
  `${at} ${level} WaveTiming: ${message}\n`;

const SUMMARY =
  "Speed since 10:00 (Wave 0.81.0-ti @ abc1234): 30 taps; tab 12 first frame median 30 ms p90 45 ms, response median 20 ms p90 40 ms; slow 0, lost 0, hitches 0 (longest 0 ms)";

describe("checkLog", () => {
  it("fails on a JS block over 50 ms and names its work and screen", () => {
    const verdict = checkLog(
      line("2026-11-21T10:01:00.000Z", "JS blocked 72 ms on /library by build Home's mixes") +
        line("2026-11-21T10:02:00.000Z", SUMMARY, "I"),
      { since: SINCE, noiseMs: 25 },
    );
    assert.equal(verdict.ok, false);
    assert.deepEqual(verdict.blocks, [
      { at: "2026-11-21T10:01:00.000Z", durationMs: 72, screen: "/library", work: "build Home's mixes" },
    ]);
    assert.deepEqual(verdict.failures, [
      "JS blocked 72 ms on /library by build Home's mixes",
    ]);
  });

  it("reads each tap kind's first-frame p90 and fails one past its budget by more than the noise", () => {
    const summary = speedSummaryLine({
      since: Date.parse(SINCE),
      version: "0.81.0-ti",
      commit: "abc1234",
      taps: [],
      measurements: [
        // tab: p90 70 ms, 20 over its 50 ms budget, within 25 ms of noise.
        ...[30, 40, 70].map((firstFrameMs) => ({ kind: "tab" as const, firstFrameMs, responseMs: 20 })),
        // Now Playing open: p90 1.2 s.
        { kind: "nowPlayingOpen", firstFrameMs: 1_240, responseMs: 30 },
        // Queue: only a response was seen.
        { kind: "queue", responseMs: 80 },
      ],
      screens: [],
    });
    assert.ok(summary !== null);
    const verdict = checkLog(line("2026-11-21T10:05:00.000Z", summary, "I"), {
      since: SINCE,
      noiseMs: 25,
    });
    assert.deepEqual(verdict.kinds, [
      { kind: "tab", taps: 3, p90Ms: 70, budgetMs: 50, over: false },
      { kind: "nowPlayingOpen", taps: 1, p90Ms: 1_200, budgetMs: 50, over: true },
      { kind: "queue", taps: 1, p90Ms: null, budgetMs: 50, over: false },
    ]);
    assert.deepEqual(verdict.failures, [
      "Now Playing open: first-frame p90 1200 ms, past its 50 ms budget by more than 25 ms",
    ]);
    assert.equal(verdict.ok, false);
  });

  it("passes a run with no block and every p90 within budget, and skips entries before it began", () => {
    const verdict = checkLog(
      line("2026-11-21T09:59:59.000Z", "JS blocked 300 ms on / by sync") +
        line("2026-11-21T10:01:00.000Z", "JS blocked 40 ms on / by sync") +
        line("2026-11-21T10:02:00.000Z", SUMMARY, "I"),
      { since: SINCE, noiseMs: 25 },
    );
    assert.deepEqual(verdict.blocks, []);
    assert.deepEqual(verdict.kinds, [
      { kind: "tab", taps: 12, p90Ms: 45, budgetMs: 50, over: false },
    ]);
    assert.equal(verdict.ok, true);
  });

  it("fails when the run left no Speed since summary", () => {
    const verdict = checkLog("", { since: SINCE, noiseMs: 25 });
    assert.equal(verdict.ok, false);
    assert.match(verdict.failures[0] ?? "", /no "Speed since" summary/);
  });

  it("knows the name the summary prints for every tap kind", () => {
    for (const kind of Object.keys(TAP_KIND_NAMES) as TimingKind[]) {
      const summary = speedSummaryLine({
        since: Date.parse(SINCE),
        version: "v",
        commit: "c",
        taps: [],
        measurements: [{ kind, firstFrameMs: 10, responseMs: 10 }],
        screens: [],
      });
      const verdict = checkLog(line("2026-11-21T10:05:00.000Z", summary ?? "", "I"), {
        since: SINCE,
        noiseMs: 25,
      });
      assert.equal(verdict.kinds[0]?.kind, kind);
    }
  });
});

/** An emulator whose app log [log] returns, rooted or not. */
const emulator = (log: (calls: readonly string[]) => string, rooted = true) => {
  const calls: string[] = [];
  const device: Device = {
    serial: "emulator-5554",
    shell: async (command) => {
      calls.push(command);
      if (command.startsWith("date ")) return "2026-11-21T10:00:00.000Z\n";
      if (command === "getprop ro.boot.qemu.avd_name") return "wave-run-903\n";
      if (command.startsWith("su 0 "))
        return rooted ? log(calls) : "/system/bin/sh: su: inaccessible or not found\n";
      if (command.startsWith("run-as ")) return rooted ? "" : log(calls);
      if (command.startsWith("cmd package resolve-activity --brief"))
        return "priority=0 preferredOrder=0 match=0x108000\ndev.leoperez.wave/.Main\n";
      return "";
    },
    pull: async () => {},
    sleep: async () => {},
  };
  return { device, calls };
};

describe("runEmulatorCheck", () => {
  it("runs the scenario, sends Wave home and back so it writes its summary, then judges the log since the start", async () => {
    let ran = false;
    // Paused, Wave runs no JS timer: the summary waits for its return to the front.
    const { device, calls } = emulator((sent) =>
      sent.slice(sent.indexOf("input keyevent 3")).includes("am start -n dev.leoperez.wave/.Main")
        ? line("2026-11-21T09:00:00.000Z", "JS blocked 900 ms on / by sync") +
          line("2026-11-21T10:01:00.000Z", "JS blocked 64 ms on /dj by prepare a DJ batch") +
          line("2026-11-21T10:03:00.000Z", SUMMARY, "I")
        : "",
    );
    const result = await runEmulatorCheck(device, {
      package: "dev.leoperez.wave",
      noiseMs: 25,
      runScenario: async () => {
        ran = true;
      },
    });
    assert.ok(ran);
    assert.equal(result.avd, "wave-run-903");
    assert.equal(result.since, "2026-11-21T10:00:00.000Z");
    assert.deepEqual(result.verdict.failures, ["JS blocked 64 ms on /dj by prepare a DJ batch"]);
    assert.ok(calls.indexOf("input keyevent 3") > -1);
  });

  it("reads the log through run-as when the emulator has no root", async () => {
    const { device } = emulator(() => line("2026-11-21T10:03:00.000Z", SUMMARY, "I"), false);
    const result = await runEmulatorCheck(device, {
      package: "dev.leoperez.wave",
      noiseMs: 25,
      runScenario: async () => {},
    });
    assert.equal(result.verdict.ok, true);
  });
});

describe("formatVerdict", () => {
  it("prints every tap kind's p90 against its budget, every block, and the verdict", () => {
    const text = formatVerdict(
      checkLog(
        line("2026-11-21T10:01:00.000Z", "JS blocked 1.4 s on /library by scan reconciliation") +
          line("2026-11-21T10:02:00.000Z", SUMMARY, "I"),
        { since: SINCE, noiseMs: 25 },
      ),
      25,
    );
    assert.match(text, /tab +12 taps +p90 45 ms +budget 50 ms \(\+25 ms noise\) +ok/);
    assert.match(text, /1400 ms on \/library by scan reconciliation/);
    assert.match(text, /FAIL/);
  });
});
