import assert from "node:assert/strict";
import { test } from "node:test";

import { libraryOnceScanned } from "./libraryOnceScanned.ts";

test("with no scan running the Library is read at once", async () => {
  assert.equal(
    await libraryOnceScanned(
      () => null,
      async () => "read",
    ),
    "read",
  );
});

test("a Library being scanned is read once the scan is through, not halfway", async () => {
  const saved: string[] = ["first batch"];
  let end!: () => void;
  let scan: Promise<void> | null = new Promise<void>((resolve) => (end = resolve)).then(() => {
    scan = null;
  });
  const listed = libraryOnceScanned(
    () => scan,
    async () => [...saved],
  );
  saved.push("second batch");
  end();
  assert.deepEqual(await listed, ["first batch", "second batch"]);
});

test("a scan that starts as the first ends is waited for too, and a failed one doesn't stop the read", async () => {
  const scans: (Promise<void> | null)[] = [
    Promise.reject(new Error("scan failed")),
    Promise.resolve(),
  ];
  let reads = 0;
  const listed = await libraryOnceScanned(
    () => scans.shift() ?? null,
    async () => ++reads,
  );
  assert.equal(listed, 1);
  assert.equal(scans.length, 0);
});
