import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isTrustedMainBuild, keptApkRunIds } from "./kept-apk.ts";

const key = "apk-v1-key";
const artifact = {
  name: `kept-${key}`,
  expired: false,
  workflow_run: { id: 12, head_branch: "main", repository_id: 1, head_repository_id: 1 },
};
const build = {
  event: "push",
  head_branch: "main",
  path: ".github/workflows/ci.yml",
  status: "completed",
  conclusion: "success",
  repository: { full_name: "LeoPerez8/wave" },
};

describe("keptApkRunIds", () => {
  it("finds matching native builds, newest first without duplicate runs", () => {
    const newer = { ...artifact, workflow_run: { ...artifact.workflow_run, id: 20 } };
    assert.deepEqual(keptApkRunIds({ artifacts: [artifact, newer, newer] }, key), [20, 12]);
  });

  it("ignores another native key, expired APKs, other branches and fork artifacts", () => {
    const artifacts = [
      { ...artifact, name: "kept-another-key" },
      { ...artifact, expired: true },
      { ...artifact, workflow_run: { ...artifact.workflow_run, head_branch: "ti" } },
      { ...artifact, workflow_run: { ...artifact.workflow_run, head_repository_id: 2 } },
    ];
    assert.deepEqual(keptApkRunIds({ artifacts }, key), []);
  });

  it("rejects malformed lists and ignores malformed entries", () => {
    for (const value of [null, [], {}, { artifacts: {} }])
      assert.throws(() => keptApkRunIds(value, key), /artifact listing/);
    assert.deepEqual(
      keptApkRunIds({ artifacts: [null, {}, { ...artifact, workflow_run: { id: "12" } }] }, key),
      [],
    );
  });
});

describe("isTrustedMainBuild", () => {
  it("accepts only a successful CI push from this repository's main branch", () => {
    assert.equal(isTrustedMainBuild(build, "leoperez8/wave"), true);
    for (const value of [
      null,
      {},
      { ...build, event: "pull_request" },
      { ...build, event: "workflow_dispatch" },
      { ...build, head_branch: "ti" },
      { ...build, path: ".github/workflows/other.yml" },
      { ...build, conclusion: "failure" },
      { ...build, status: "in_progress" },
      { ...build, repository: { full_name: "someone/wave" } },
    ])
      assert.equal(isTrustedMainBuild(value, "LeoPerez8/wave"), false);
  });
});
