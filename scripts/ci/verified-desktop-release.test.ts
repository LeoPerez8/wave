// verified-desktop-release.sh: what promotion and rollback trust a desktop release through
// (docs/release-provenance.md). Runs it with a `gh` that serves one GitHub Release from a folder.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  admitDesktop,
  desktopArtifact,
  desktopReleaseFiles,
  recordDesktopBuild,
} from "../../apps/updates/src/desktopEvidence.ts";
import { desktopPlatforms } from "../../apps/updates/src/desktopProtocol.ts";

const script = fileURLToPath(new URL("./verified-desktop-release.sh", import.meta.url));
const COMMIT = "b".repeat(40);
const OLDER = "c".repeat(40);

/**
 * A GitHub Release holding the desktop's installers and record, built from `source` and admitted
 * for `tag`, whose tag is on `tagged`. `promotedFrom` links a stable one to its ti release, whose
 * tag is on `source`.
 */
const release = async ({
  tag = "v1.3.0-ti",
  source = COMMIT,
  tagged = COMMIT,
  promotedFrom = "",
  legacy = false,
  swap = false,
}: {
  tag?: string;
  source?: string;
  tagged?: string;
  promotedFrom?: string;
  /** Before #1336: the desktop's admission inside the phone's record. */
  legacy?: boolean;
  /** An installer replaced after the gate admitted it. */
  swap?: boolean;
} = {}) => {
  const dir = mkdtempSync(join(tmpdir(), "wave-desktop-verified-"));
  const built = join(dir, "built");
  const assets = join(dir, "assets");
  mkdirSync(assets);
  for (const platform of desktopPlatforms) {
    const folder = join(built, desktopArtifact(platform));
    mkdirSync(folder, { recursive: true });
    for (const file of desktopReleaseFiles(platform, tag))
      writeFileSync(join(folder, file), `${platform} ${file}`);
    await recordDesktopBuild(folder, platform, source, tag, "d".repeat(64));
    for (const file of desktopReleaseFiles(platform, tag))
      cpSync(join(folder, file), join(assets, file));
  }
  const desktop = await admitDesktop(built, source, tag);
  const version = tag.slice(1);
  writeFileSync(
    join(
      assets,
      legacy ? `wave-${version}.provenance.json` : `wave-${version}.desktop.provenance.json`,
    ),
    JSON.stringify({
      schema: "wave-release-provenance/1",
      source,
      releaseTag: tag,
      desktop,
      ...(promotedFrom ? { promotedFrom: { releaseTag: promotedFrom, source } } : {}),
    }),
  );
  if (swap) writeFileSync(join(assets, desktopReleaseFiles("linux", tag)[0]!), "another AppImage");
  writeFileSync(
    join(dir, "gh"),
    `#!/bin/sh
case "$1 $2" in
  "api repos/o/r/commits/${tag}") echo "${tagged}" ;;
  "api repos/o/r/commits/${promotedFrom || "none"}") echo "${source}" ;;
  "release view") ls "${assets}" ;;
  "release download")
    while [ $# -gt 0 ]; do [ "$1" = "--dir" ] && out="$2"; shift; done
    mkdir -p "$out" && cp "${assets}"/* "$out"/ ;;
  *) echo "unexpected gh $*" >&2; exit 1 ;;
esac
`,
  );
  chmodSync(join(dir, "gh"), 0o755);
  const output = join(dir, "output");
  writeFileSync(output, "");
  const result = spawnSync("bash", [script, tag, join(dir, "out")], {
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

describe("verified-desktop-release.sh", () => {
  it("answers the record of a desktop release whose tag, record and installers agree", async () => {
    const { status, output, dir, stderr } = await release();
    assert.equal(status, 0, stderr);
    assert.equal(output, `file=${join(dir, "out")}/wave-1.3.0-ti.desktop.provenance.json\n`);
  });

  it("needs no APK: a version the desktop released alone holds none", async () => {
    const { status, stderr } = await release();
    assert.equal(status, 0, stderr);
    assert.doesNotMatch(stderr, /apk/i);
  });

  it("reads the desktop's admission from the phone's record for a release from before #1336", async () => {
    const { status, output, stderr } = await release({ legacy: true });
    assert.equal(status, 0, stderr);
    assert.match(output, /wave-1\.3\.0-ti\.provenance\.json/);
  });

  it("trusts a stable desktop built from the older ti release its record links", async () => {
    const promoted = { tag: "v1.3.0", source: OLDER, tagged: COMMIT, promotedFrom: "v1.2.9-ti" };
    const { status, stderr } = await release(promoted);
    assert.equal(status, 0, stderr);
  });

  it("fails for a record of another source, or installers it didn't admit", async () => {
    for (const options of [{ tagged: OLDER }, { swap: true }]) {
      const { status, output } = await release(options);
      assert.notEqual(status, 0, JSON.stringify(options));
      assert.equal(output, "");
    }
  });
});
