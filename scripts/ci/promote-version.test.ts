import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { promotion } from "./promote-version.ts";

const TAGS = ["latest", "ti-latest", "v0.9.0-ti", "v0.9.0", "v0.10.0-ti", "v0.10.1", "v0.11.0-ti"];

describe("promotion", () => {
  it("takes the newest -ti release, by version, when none is asked for", () => {
    assert.deepEqual(promotion({ requested: "", tags: TAGS }), {
      from: "v0.11.0-ti",
      to: "v0.11.0",
    });
  });

  it("takes the version asked for, however it's written", () => {
    const tags = ["v0.10.1", "v0.11.0-ti", "v0.11.1-ti", "v0.12.0-ti"];
    const expected = { from: "v0.11.1-ti", to: "v0.11.1" };
    for (const requested of ["0.11.1-ti", "0.11.1", "v0.11.1-ti", "v0.11.1", " 0.11.1 "])
      assert.deepEqual(promotion({ requested, tags }), expected, requested);
  });

  it("refuses a version with no -ti release, and says so", () => {
    assert.throws(
      () => promotion({ requested: "0.12.0", tags: TAGS }),
      /v0\.12\.0-ti doesn't exist/,
    );
  });

  it("refuses what isn't a version", () => {
    assert.throws(() => promotion({ requested: "newest", tags: TAGS }), /isn't a version/);
  });

  it("refuses a version already promoted, and says how to retry its publishing", () => {
    assert.throws(
      () => promotion({ requested: "0.9.0", tags: ["v0.9.0-ti", "v0.9.0"] }),
      /v0\.9\.0 already exists.*re-run/s,
    );
  });

  it("refuses by default when the newest -ti release is already promoted", () => {
    assert.throws(
      () => promotion({ requested: "", tags: ["v0.9.0-ti", "v0.9.0"] }),
      /v0\.9\.0 already exists/,
    );
  });

  it("refuses a version below the newest stable one, which phones wouldn't install", () => {
    assert.throws(() => promotion({ requested: "0.10.0", tags: TAGS }), /v0\.10\.1 is already out/);
  });

  it("refuses when no -ti release exists", () => {
    assert.throws(() => promotion({ requested: "", tags: ["v0.9.0"] }), /No -ti release/);
  });
});

describe("the command line", () => {
  const run = (...args: string[]) => {
    const tags = join(mkdtempSync(join(tmpdir(), "wave-promote-")), "tags.txt");
    writeFileSync(tags, `${TAGS.join("\n")}\n`);
    return spawnSync(
      process.execPath,
      [fileURLToPath(new URL("promote-version.ts", import.meta.url)), tags, ...args],
      { encoding: "utf8" },
    );
  };

  it("prints the tags for $GITHUB_OUTPUT", () => {
    assert.equal(run("0.11.0").stdout, "from=v0.11.0-ti\nto=v0.11.0\n");
  });

  it("fails with the reason alone", () => {
    const { status, stderr, stdout } = run("0.10.0");
    assert.equal(status, 1);
    assert.equal(stdout, "");
    assert.match(stderr, /^::error::.*v0\.10\.1 is already out/);
  });
});
