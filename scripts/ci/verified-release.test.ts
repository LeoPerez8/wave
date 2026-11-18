// verified-release.sh: what promotion and rollback trust a published release through
// (docs/release-provenance.md). Runs it with a `gh` that serves one GitHub Release from a folder.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("./verified-release.sh", import.meta.url));
const COMMIT = "b".repeat(40);

/** v1.3.0-ti's GitHub Release: its sealed record and APK, each optional. */
const release = ({
  record = true,
  apk = "signed apk",
  source = COMMIT,
  fail = "",
}: {
  record?: boolean;
  apk?: string;
  source?: string;
  /** A gh call that fails as an unreachable GitHub would: `view` or `download`. */
  fail?: "" | "view" | "download";
} = {}) => {
  const dir = mkdtempSync(join(tmpdir(), "wave-verified-"));
  const assets = join(dir, "assets");
  mkdirSync(assets);
  writeFileSync(join(assets, "wave-1.3.0-ti.apk"), apk);
  if (record)
    writeFileSync(
      join(assets, "wave-1.3.0-ti.provenance.json"),
      JSON.stringify({
        schema: "wave-release-provenance/1",
        source,
        releaseTag: "v1.3.0-ti",
        artifact: {
          signedSha256: createHash("sha256").update("signed apk").digest("hex"),
          updateSha256: "",
        },
      }),
    );
  writeFileSync(
    join(dir, "gh"),
    `#!/bin/sh
case "$1 $2" in
  "api repos/o/r/commits/v1.3.0-ti") echo "${COMMIT}" ;;
  "release view")
    [ "${fail}" = view ] && { echo "HTTP 502" >&2; exit 1; }
    ls "${assets}" ;;
  "release download")
    [ "${fail}" = download ] && { echo "HTTP 502" >&2; exit 1; }
    while [ $# -gt 0 ]; do [ "$1" = "--dir" ] && out="$2"; shift; done
    mkdir -p "$out" && cp "${assets}"/* "$out"/ ;;
  *) echo "unexpected gh $*" >&2; exit 1 ;;
esac
`,
  );
  chmodSync(join(dir, "gh"), 0o755);
  const output = join(dir, "output");
  writeFileSync(output, "");
  const run = (...flags: string[]) => {
    const result = spawnSync("bash", [script, "v1.3.0-ti", join(dir, "out"), ...flags], {
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${dir}:${process.env.PATH}`,
        GITHUB_REPOSITORY: "o/r",
        GITHUB_OUTPUT: output,
      },
    });
    return { ...result, output: readFileSync(output, "utf8"), dir };
  };
  return run;
};

describe("verified-release.sh", () => {
  it("answers the record of a release whose tag, record and APK agree", () => {
    const { status, output, dir, stderr } = release()();
    assert.equal(status, 0, stderr);
    assert.equal(output, `file=${join(dir, "out")}/wave-1.3.0-ti.provenance.json\n`);
  });

  it("fails for a record of another source or an APK it didn't seal", () => {
    for (const run of [release({ source: "c".repeat(40) }), release({ apk: "another apk" })]) {
      const { status, output } = run();
      assert.notEqual(status, 0);
      assert.equal(output, "");
    }
  });

  it("fails for a release with no record, as one published before records", () => {
    const { status, stdout, output } = release({ record: false })();
    assert.notEqual(status, 0);
    assert.match(stdout, /::error::v1\.3\.0-ti has no provenance record/);
    assert.equal(output, "");
  });

  it("lets the owner's transition through for a release with no record, saying so", () => {
    const { status, stdout, output } = release({ record: false })("--allow-unrecorded");
    assert.equal(status, 0);
    assert.match(stdout, /::warning::v1\.3\.0-ti has no provenance record/);
    assert.equal(output, "file=\n");
  });

  it("never lets the transition skip the check of a release that has a record", () => {
    const { status } = release({ apk: "another apk" })("--allow-unrecorded");
    assert.notEqual(status, 0);
  });

  it("fails, even through the transition, when GitHub can't say what the release holds", () => {
    for (const flags of [[], ["--allow-unrecorded"]]) {
      const { status, stdout, output } = release({ fail: "view" })(...flags);
      assert.notEqual(status, 0);
      assert.doesNotMatch(stdout, /::warning::/);
      assert.equal(output, "");
    }
  });

  it("fails, even through the transition, when a release's record can't be downloaded", () => {
    for (const flags of [[], ["--allow-unrecorded"]]) {
      const { status, stdout, output } = release({ fail: "download" })(...flags);
      assert.notEqual(status, 0);
      assert.match(stdout, /::error::.*couldn't be downloaded/);
      assert.equal(output, "");
    }
  });
});
