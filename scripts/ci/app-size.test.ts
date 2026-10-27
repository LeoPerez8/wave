import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { sizeReport, type SizeBudget } from "./app-size.ts";

const budget: SizeBudget = {
  release: "v0.33.5",
  apkBytes: 77_022_799,
  bundleBytes: 16_833_905,
  headroom: 0.05,
};

describe("sizeReport", () => {
  it("shows the APK and the Hermes bundle against their budgets and the measured release", () => {
    const { markdown, over } = sizeReport(
      { apkBytes: 77_212_799, bundleBytes: 16_833_905 },
      budget,
    );
    assert.deepEqual(over, []);
    assert.equal(
      markdown,
      [
        "**App size** (budget: v0.33.5 + 5%)",
        "",
        "| | Size | Budget | Since v0.33.5 |",
        "| --- | --: | --: | --: |",
        "| APK | 77.21 MB | ✅ 80.87 MB | +0.19 MB (+0.2%) |",
        "| Hermes bundle | 16.83 MB | ✅ 17.68 MB | 0.00 MB (0.0%) |",
      ].join("\n"),
    );
  });

  it("flags what is over its budget, and says what shrank", () => {
    const { markdown, over } = sizeReport(
      { apkBytes: 75_000_000, bundleBytes: 18_000_000 },
      budget,
    );
    assert.deepEqual(over, ["Hermes bundle"]);
    assert.match(markdown, /\| APK \| 75\.00 MB \| ✅ 80\.87 MB \| -2\.02 MB \(-2\.6%\) \|/);
    assert.match(
      markdown,
      /\| Hermes bundle \| 18\.00 MB \| ⚠️ 17\.68 MB, over by 0\.32 MB \| \+1\.17 MB \(\+6\.9%\) \|/,
    );
  });

  it("is a budget exactly at its limit", () => {
    const limit = Math.floor(budget.apkBytes * 1.05);
    assert.deepEqual(sizeReport({ apkBytes: limit, bundleBytes: 1 }, budget).over, []);
    assert.deepEqual(sizeReport({ apkBytes: limit + 1, bundleBytes: 1 }, budget).over, ["APK"]);
  });
});

describe("the app-size command", () => {
  it("measures the files, warns about each size over budget and writes the report", () => {
    const dir = mkdtempSync(join(tmpdir(), "app-size-"));
    const apk = join(dir, "wave.apk");
    const bundle = join(dir, "index.android.bundle");
    const budgetFile = join(dir, "budget.json");
    writeFileSync(apk, Buffer.alloc(3_000_000));
    writeFileSync(bundle, Buffer.alloc(500_000));
    writeFileSync(
      budgetFile,
      JSON.stringify({ release: "v1.0.0", apkBytes: 2_000_000, bundleBytes: 500_000, headroom: 0 }),
    );
    const out = execFileSync(
      process.execPath,
      [fileURLToPath(new URL("./app-size.ts", import.meta.url)), apk, bundle, join(dir, "size.md")],
      { env: { WAVE_SIZE_BUDGET: budgetFile }, encoding: "utf8" },
    );
    assert.match(
      out,
      /^::warning::The APK is 3\.00 MB, over its 2\.00 MB budget \(v1\.0\.0 \+ 0%\)\.$/m,
    );
    assert.match(
      out,
      /\| APK \| 3\.00 MB \| ⚠️ 2\.00 MB, over by 1\.00 MB \| \+1\.00 MB \(\+50\.0%\) \|/,
    );
    assert.match(out, /\| Hermes bundle \| 0\.50 MB \| ✅ 0\.50 MB \| 0\.00 MB \(0\.0%\) \|/);
    const written = readFileSync(join(dir, "size.md"), "utf8");
    assert.ok(written.startsWith("**App size** (budget: v1.0.0 + 0%)\n"));
    assert.ok(!written.includes("::warning::"));
  });

  it("reads the repo's budget, set from a measured release", () => {
    const saved = JSON.parse(
      readFileSync(new URL("./size-budget.json", import.meta.url), "utf8"),
    ) as SizeBudget;
    assert.match(saved.release, /^v\d+\.\d+\.\d+(-ti)?$/);
    assert.ok(saved.apkBytes > saved.bundleBytes && saved.bundleBytes > 0);
    assert.ok(saved.headroom >= 0 && saved.headroom < 1);
  });
});
