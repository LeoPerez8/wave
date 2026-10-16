import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { releaseTag } from "./release-tag.ts";

const script = fileURLToPath(new URL("./release-tag.ts", import.meta.url));
const run = (args: string[], stdin: string) =>
  execFileSync(process.execPath, [script, ...args], {
    input: stdin,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "ignore"],
  });

const tags = ["latest", "ti-latest", "pr-204", "v0.5.1-ti", "v0.5.3-ti"];

describe("releaseTag", () => {
  it("releases an untagged stable version pushed to main", () => {
    assert.equal(releaseTag({ ref: "refs/heads/main", version: "0.5.0", tags }).tag, "v0.5.0");
  });

  it("publishes nothing when the version is already tagged, and says so", () => {
    const decision = releaseTag({ ref: "refs/heads/ti", version: "0.5.3-ti", tags });
    assert.equal(decision.tag, undefined);
    assert.match(decision.reason, /v0\.5\.3-ti already exists/);
  });

  it("publishes nothing when the version belongs to the other branch", () => {
    const onMain = releaseTag({ ref: "refs/heads/main", version: "0.5.4-ti", tags });
    assert.equal(onMain.tag, undefined);
    assert.match(onMain.reason, /0\.5\.4-ti is released from ti, not main/);
    const onTi = releaseTag({ ref: "refs/heads/ti", version: "0.6.0", tags });
    assert.equal(onTi.tag, undefined);
    assert.match(onTi.reason, /0\.6\.0 is released from main, not ti/);
  });

  it("publishes nothing from pull requests or other branches", () => {
    for (const ref of ["refs/pull/12/merge", "refs/heads/feat/295-auto-release"]) {
      const decision = releaseTag({ ref, version: "0.5.0", tags });
      assert.equal(decision.tag, undefined);
      assert.match(decision.reason, /Only pushes to main and ti/);
    }
  });

  it("releases a version tag pushed by hand under that tag", () => {
    const decision = releaseTag({ ref: "refs/tags/v0.5.3-ti", version: "0.5.3-ti", tags });
    assert.equal(decision.tag, "v0.5.3-ti");
  });

  it("releases an untagged -ti version pushed to ti", () => {
    assert.equal(releaseTag({ ref: "refs/heads/ti", version: "0.5.4-ti", tags }).tag, "v0.5.4-ti");
  });
});

describe("release-tag.ts", () => {
  it("prints the GitHub output line for the tags on stdin", () => {
    const listed = "latest\nv0.5.1-ti\nv0.5.3-ti\n";
    assert.equal(run(["refs/heads/main", "0.5.0"], listed), "tag=v0.5.0\n");
    assert.equal(run(["refs/heads/ti", "0.5.3-ti"], listed), "tag=\n");
  });
});
