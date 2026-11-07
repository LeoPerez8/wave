import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { unpinnedActions } from "./action-pins.ts";

const sha = "fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09";

describe("unpinnedActions", () => {
  it("accepts actions pinned by a full commit SHA, with or without a version comment", () => {
    const workflow = [
      "jobs:",
      "  build:",
      "    steps:",
      `      - uses: actions/checkout@${sha} # v5.1.0`,
      `      - uses: gradle/actions/setup-gradle@${sha}`,
      `        uses: "actions/cache/restore@${sha}"`,
    ].join("\n");
    assert.deepEqual(unpinnedActions(workflow), []);
  });

  it("names each action pinned by a tag, a branch or a short SHA, with its line", () => {
    const workflow = [
      "steps:",
      "  - uses: actions/checkout@v5",
      "  - uses: 'pnpm/action-setup@main'",
      "  - uses: actions/setup-node@fbc6f39",
      "  - uses: actions/setup-java",
    ].join("\n");
    assert.deepEqual(unpinnedActions(workflow), [
      { line: 2, uses: "actions/checkout@v5" },
      { line: 3, uses: "pnpm/action-setup@main" },
      { line: 4, uses: "actions/setup-node@fbc6f39" },
      { line: 5, uses: "actions/setup-java" },
    ]);
  });

  it("accepts local actions and Docker images pinned by digest, not by tag", () => {
    const digest = "a".repeat(64);
    const workflow = [
      "  - uses: ./.github/actions/report",
      `  - uses: docker://alpine@sha256:${digest}`,
      "  - uses: docker://alpine:3.20",
    ].join("\n");
    assert.deepEqual(unpinnedActions(workflow), [{ line: 3, uses: "docker://alpine:3.20" }]);
  });

  it("checks reusable workflows too, and ignores comments", () => {
    const workflow = [
      "# uses: actions/checkout@v5 is how it was",
      "jobs:",
      "  call:",
      "    uses: octo/shared/.github/workflows/build.yml@v1",
    ].join("\n");
    assert.deepEqual(unpinnedActions(workflow), [
      { line: 4, uses: "octo/shared/.github/workflows/build.yml@v1" },
    ]);
  });
});
