import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { untrustedCodeExposures } from "./untrusted-code.ts";

const job = [
  "jobs:",
  "  test:",
  "    runs-on: ubuntu-latest",
  "    permissions:",
  "      contents: read",
];

describe("untrustedCodeExposures", () => {
  it("names a trigger that runs a fork's input with the base repository's token and secrets", () => {
    const workflow = ["on:", "  pull_request_target:", "  push:", "permissions: {}", ...job].join(
      "\n",
    );
    assert.deepEqual(untrustedCodeExposures(workflow), ["trigger pull_request_target"]);
  });

  it("lets a workflow be called by another one, which runs it with its own event and token", () => {
    const workflow = ["on:", "  workflow_call:", "    inputs: {}", "permissions: {}", ...job].join(
      "\n",
    );
    assert.deepEqual(untrustedCodeExposures(workflow), []);
  });

  it("names a workflow that grants its jobs a token before they ask for one", () => {
    const missing = ["on:", "  pull_request:", ...job].join("\n");
    const broad = ["on: [push, pull_request]", "permissions: write-all", ...job].join("\n");
    assert.deepEqual(untrustedCodeExposures(missing), ["workflow permissions not {}"]);
    assert.deepEqual(untrustedCodeExposures(broad), ["workflow permissions not {}"]);
  });

  it("names each job that doesn't say which token permissions it uses", () => {
    const workflow = [
      "on:",
      "  pull_request:",
      "permissions: {}",
      ...job,
      "  lint:",
      "    runs-on: ubuntu-latest",
      "    steps:",
      "      - run: echo permissions:",
    ].join("\n");
    assert.deepEqual(untrustedCodeExposures(workflow), ["job lint has no permissions"]);
  });

  /** A workflow breaking a trigger rule and a job rule, written with [comments] on its keys. */
  const exposed = (comments: boolean) => {
    const note = (text: string) => (comments ? ` # ${text}` : "");
    return [
      `on:${note("when it runs")}`,
      `  pull_request_target:${note("the base token")}`,
      "  push:",
      `permissions: {}${note("none by default")}`,
      `jobs:${note("each job")}`,
      `  test:${note("the tests")}`,
      "    runs-on: ubuntu-latest",
      `    permissions:${note("read only")}`,
      "      contents: read",
      "  lint:",
      "    runs-on: ubuntu-latest",
    ];
  };
  const both = ["trigger pull_request_target", "job lint has no permissions"];

  it("reads a workflow saved with CRLF line endings", () => {
    assert.deepEqual(untrustedCodeExposures(exposed(false).join("\r\n")), both);
  });

  it("reads trailing comments on on:, jobs: and the trigger keys", () => {
    assert.deepEqual(untrustedCodeExposures(exposed(true).join("\n")), both);
    const inline = ["on: [push, pull_request] # both", "permissions: {}", ...job].join("\n");
    assert.deepEqual(untrustedCodeExposures(inline), []);
  });

  it("names a job that asks for every write permission", () => {
    const workflow = [
      "on:",
      "  push:",
      "permissions: {}",
      "jobs:",
      "  release:",
      "    runs-on: ubuntu-latest",
      "    permissions: write-all # everything",
    ].join("\n");
    assert.deepEqual(untrustedCodeExposures(workflow), ["job release permissions write-all"]);
  });

  it("names any top-level permissions besides {}, even beside a {} one", () => {
    const block = ["on: push", "permissions:", "  contents: write", ...job].join("\n");
    const twice = ["on: push", "permissions: {}", "permissions: write-all", ...job].join("\n");
    assert.deepEqual(untrustedCodeExposures(block), ["workflow permissions not {}"]);
    assert.deepEqual(untrustedCodeExposures(twice), ["workflow permissions not {}"]);
  });

  it("finds nothing in the repository's workflows", () => {
    const dir = fileURLToPath(new URL("../../.github/workflows/", import.meta.url));
    const files = readdirSync(dir).filter((file) => file.endsWith(".yml"));
    assert.ok(files.includes("ci.yml"));
    for (const file of files) {
      assert.deepEqual(untrustedCodeExposures(readFileSync(dir + file, "utf8")), [], file);
    }
  });
});
