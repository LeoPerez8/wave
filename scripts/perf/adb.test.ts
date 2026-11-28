import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { after, before, describe, it } from "node:test";

import { adbDevice, listDevices } from "./adb.ts";

// An `adb` that answers and exits without reading its input, as `adb devices` does.
describe("adb", () => {
  const dir = mkdtempSync(join(tmpdir(), "wave-adb-"));
  const path = process.env.PATH;
  before(() => {
    const adb = join(dir, "adb");
    writeFileSync(adb, '#!/bin/sh\nprintf "List of devices attached\\nemulator-5554\\tdevice\\n"\n');
    chmodSync(adb, 0o755);
    process.env.PATH = `${dir}${delimiter}${path ?? ""}`;
  });
  after(() => {
    process.env.PATH = path;
    rmSync(dir, { recursive: true, force: true });
  });

  it("reads the answer of an adb that exits before its input is written", async () => {
    for (let i = 0; i < 20; i++)
      assert.deepEqual(await listDevices(), [{ serial: "emulator-5554", state: "device" }]);
  });

  it("reads it when the input is too big to write before adb exits", async () => {
    const output = await adbDevice("emulator-5554").shell("true", "x".repeat(4 * 1024 * 1024));
    assert.match(output, /emulator-5554/);
  });
});
