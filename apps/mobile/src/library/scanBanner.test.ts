import assert from "node:assert/strict";
import { test } from "node:test";

import { scanBannerScan } from "./scanBanner.ts";
import type { ScanState } from "./LibraryScan.ts";

const scanning = (patch: Partial<Extract<ScanState, { status: "scanning" }>>): ScanState => ({
  status: "scanning",
  kind: "incremental",
  phase: "discovering",
  filesFound: 0,
  filesRead: 0,
  filesUnchanged: 0,
  ...patch,
});

test("the banner follows a scan only while it shows it", () => {
  assert.equal(scanBannerScan({ status: "idle" }), null);
  assert.equal(scanBannerScan({ status: "done", filesFound: 3 }), null);
  const failed: ScanState = { status: "failed", message: "x" };
  assert.equal(scanBannerScan(failed), failed);
  // An incremental scan is quiet while it looks, and while it has nothing to read.
  assert.equal(scanBannerScan(scanning({ filesFound: 900 })), null);
  assert.equal(
    scanBannerScan(scanning({ phase: "reading", filesFound: 900, filesUnchanged: 900 })),
    null,
  );
  const reading = scanning({
    phase: "reading",
    filesFound: 900,
    filesUnchanged: 890,
    filesRead: 2,
  });
  assert.equal(scanBannerScan(reading), reading);
  const full = scanning({ kind: "full", filesFound: 12 });
  assert.equal(scanBannerScan(full), full);
});
