import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, test } from "node:test";

import { updateSigning } from "./updateSigning.ts";

describe("updateSigning", () => {
  const project = () => mkdtempSync(join(tmpdir(), "wave-app-"));

  test("a build with no certificate in the repo isn't configured for signing", () => {
    assert.deepEqual(updateSigning(project()), {});
  });

  test("a build with the certificate expects updates signed by CI's key", () => {
    const root = project();
    mkdirSync(join(root, "certs"));
    writeFileSync(join(root, "certs/certificate.pem"), "certificate");
    assert.deepEqual(updateSigning(root), {
      codeSigningCertificate: "./certs/certificate.pem",
      codeSigningMetadata: { keyid: "main", alg: "rsa-v1_5-sha256" },
    });
  });
});
