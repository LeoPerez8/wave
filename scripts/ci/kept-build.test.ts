import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("./kept-build.ts", import.meta.url));
const KEY = `apk-v2-${"c".repeat(64)}`;
const SOURCE = "a".repeat(40);

const keptBuild = (...args: string[]) => {
  const { status, stdout, stderr } = spawnSync(process.execPath, [script, ...args], {
    encoding: "utf8",
  });
  return { status, stdout, stderr };
};

/** A kept folder holding a full build's unsigned APK, as the Android job keeps it. */
const kept = () => {
  const dir = mkdtempSync(join(tmpdir(), "wave-kept-"));
  writeFileSync(join(dir, "app-release.apk"), "full build");
  return dir;
};

/** The `base=` line a check prints, parsed. */
const baseOf = (stdout: string) => {
  const line = /^base=(.*)$/m.exec(stdout)?.[1];
  assert.notEqual(line, undefined, stdout);
  return line ? JSON.parse(line) : "";
};

describe("kept-build.ts", () => {
  it("records the full build's source, run and APK beside it, and nothing else", () => {
    const dir = kept();
    assert.equal(keptBuild("keep", dir, KEY, SOURCE, "41").status, 0);
    assert.deepEqual(readdirSync(dir).sort(), ["app-release.apk", "kept-build.json"]);
    const check = keptBuild("check", dir, KEY);
    assert.equal(check.status, 0, check.stderr);
    assert.deepEqual(baseOf(check.stdout), {
      source: SOURCE,
      run: 41,
      key: KEY,
      unsignedSha256: createHash("sha256").update("full build").digest("hex"),
    });
  });

  it("offers no base for a kept APK without a record, so the run builds in full", () => {
    const check = keptBuild("check", kept(), KEY);
    assert.equal(check.status, 0);
    assert.match(check.stdout, /^base=$/m);
    assert.match(check.stderr, /no record/);
  });

  it("offers no base when the kept APK isn't the one its record names", () => {
    const dir = kept();
    keptBuild("keep", dir, KEY, SOURCE, "41");
    writeFileSync(join(dir, "app-release.apk"), "another build");
    assert.match(keptBuild("check", dir, KEY).stdout, /^base=$/m);
  });

  it("offers no base for another native side's record", () => {
    const dir = kept();
    keptBuild("keep", dir, `apk-v2-${"0".repeat(64)}`, SOURCE, "41");
    assert.match(keptBuild("check", dir, KEY).stdout, /^base=$/m);
  });

  it("refuses to keep a build it can't name", () => {
    for (const [source, run] of [
      ["", "41"],
      [SOURCE, "0"],
      [SOURCE, ""],
    ] as const) {
      assert.notEqual(keptBuild("keep", kept(), KEY, source, run).status, 0, `${source} ${run}`);
    }
  });
});
