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

  it("finds nothing in the repository's workflows", () => {
    const dir = fileURLToPath(new URL("../../.github/workflows/", import.meta.url));
    const files = readdirSync(dir).filter((file) => file.endsWith(".yml"));
    assert.ok(files.includes("ci.yml"));
    for (const file of files) {
      assert.deepEqual(untrustedCodeExposures(readFileSync(dir + file, "utf8")), [], file);
    }
  });
});
