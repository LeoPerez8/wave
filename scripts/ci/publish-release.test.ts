import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const repoFile = (path: string) => fileURLToPath(new URL(`../../${path}`, import.meta.url));

const SHA = "a".repeat(40);

/** Runs the script for a branch push, with a `git` that says where the tag is and a stub `gh`. */
const publish = (tagged: string) => {
  const dir = mkdtempSync(join(tmpdir(), "wave-release-"));
  const script = (name: string, body: string) => {
    writeFileSync(join(dir, name), `#!/bin/sh\n${body}\n`);
    chmodSync(join(dir, name), 0o755);
  };
  script("git", `printf '%s\\trefs/tags/v1.3.0-ti\\n' "${tagged}"`);
  script("gh", `case "$2" in view) exit 1 ;; esac; echo "gh $*" >> "${dir}/gh.log"`);
  writeFileSync(join(dir, "gh.log"), "");
  writeFileSync(join(dir, "app.apk"), "apk");
  const output = join(dir, "output");
  writeFileSync(output, "");
  const { status, stdout } = spawnSync(
    "bash",
    [repoFile("scripts/ci/publish-release.sh"), join(dir, "app.apk")],
    {
      encoding: "utf8",
      env: {
        PATH: `${dir}:${process.env.PATH}`,
        RUNNER_TEMP: dir,
        RELEASE_TAG: "v1.3.0-ti",
        RELEASE_SHA: SHA,
        GITHUB_REF_TYPE: "branch",
        GITHUB_REPOSITORY: "o/r",
        GITHUB_OUTPUT: output,
      },
    },
  );
  return {
    status,
    stdout,
    output: readFileSync(output, "utf8"),
    gh: readFileSync(join(dir, "gh.log"), "utf8"),
  };
};

describe("publish-release.sh", () => {
  it("answers the APK's address when it publishes", () => {
    const { status, output, gh } = publish(SHA);
    assert.equal(status, 0);
    assert.match(gh, /release create v1\.3\.0-ti/);
    assert.match(output, /^url=https:.*wave-1\.3\.0-ti\.apk$/m);
  });

  it("answers nothing when the tag moved, so nothing after it publishes", () => {
    const { status, stdout, output, gh } = publish("b".repeat(40));
    assert.equal(status, 0);
    assert.match(stdout, /Publishing nothing/);
    assert.equal(gh, "");
    assert.equal(output, "");
  });
});

describe("the release job", () => {
  it("publishes nothing to phones unless the Release was published", () => {
    const workflow = readFileSync(repoFile(".github/workflows/ci.yml"), "utf8");
    const afterRelease = workflow.slice(workflow.indexOf("- name: Publish the release\n"));
    const steps = afterRelease.split(/\n(?= {6}- )/).slice(1);
    const names = steps.map((step) => /name: (.*)/.exec(step)?.[1] ?? "setup-node");
    assert.deepEqual(names, [
      "Move the latest build",
      "setup-node",
      "Publish the release notes",
      "Publish the latest APK",
      "Fetch the over-the-air update",
      "Publish the over-the-air update",
    ]);
    for (const [index, step] of steps.entries()) {
      assert.match(step, /if: .*steps\.published\.outputs\.url != ''/, names[index]);
    }
  });
});
