import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const repoFile = (path: string) => fileURLToPath(new URL(`../../${path}`, import.meta.url));

const SHA = "a".repeat(40);

/**
 * Runs the script for a branch push, with a `git` that says where the tag is and a stub `gh`.
 * `existing` is the record of a GitHub Release the tag already has ("" for one without a record);
 * `fail` makes GitHub fail to list that release's assets or to download its record.
 */
const publish = (
  tagged: string,
  extra: Record<string, string> = {},
  existing?: string,
  fail: "" | "list" | "download" = "",
) => {
  const dir = mkdtempSync(join(tmpdir(), "wave-release-"));
  const script = (name: string, body: string) => {
    writeFileSync(join(dir, name), `#!/bin/sh\n${body}\n`);
    chmodSync(join(dir, name), 0o755);
  };
  script("git", `printf '%s\\trefs/tags/v1.3.0-ti\\n' "${tagged}"`);
  if (existing !== undefined) writeFileSync(join(dir, "existing.json"), existing);
  script(
    "gh",
    existing === undefined
      ? `case "$2" in view) exit 1 ;; esac; echo "gh $*" >> "${dir}/gh.log"`
      : `case "$2" in
  view)
    case "$*" in *--json*)
      ${fail === "list" ? 'echo "HTTP 502" >&2; exit 1' : ":"}
      echo wave-1.3.0-ti.apk
      [ -s "${dir}/existing.json" ] && echo wave-1.3.0-ti.provenance.json ;;
    esac
    exit 0 ;;
  download)
    ${fail === "download" ? 'echo "HTTP 502" >&2; exit 1' : ":"}
    [ -s "${dir}/existing.json" ] || { echo "no assets match the file pattern" >&2; exit 1; }
    while [ $# -gt 0 ]; do [ "$1" = "--dir" ] && out="$2"; shift; done
    mkdir -p "$out" && cp "${dir}/existing.json" "$out/wave-1.3.0-ti.provenance.json"
    exit 0 ;;
esac
echo "gh $*" >> "${dir}/gh.log"`,
  );
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
        ...extra,
      },
    },
  );
  return {
    dir,
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

  it("attaches the release's provenance record beside the APK", () => {
    const record = join(mkdtempSync(join(tmpdir(), "wave-record-")), "provenance.json");
    writeFileSync(record, "{}");
    const { status, gh, dir } = publish(SHA, { PROVENANCE_FILE: record });
    assert.equal(status, 0);
    const asset = `${dir}/wave-1.3.0-ti.provenance.json`;
    assert.ok(gh.includes(`release create v1.3.0-ti ${dir}/wave-1.3.0-ti.apk ${asset} `), gh);
    assert.equal(readFileSync(asset, "utf8"), "{}");
  });

  it("attaches the source manifest and its directions, and puts the directions in the notes", () => {
    const dir = mkdtempSync(join(tmpdir(), "wave-source-"));
    writeFileSync(join(dir, "manifest.json"), '{"schema":"wave-release-source/1"}');
    writeFileSync(join(dir, "directions.md"), "## Source for Wave 1.3.0-ti\n");
    writeFileSync(join(dir, "notes.md"), "- Fixed a thing\n");
    const published = publish(SHA, {
      SOURCE_MANIFEST_FILE: join(dir, "manifest.json"),
      SOURCE_DIRECTIONS_FILE: join(dir, "directions.md"),
      RELEASE_NOTES_FILE: join(dir, "notes.md"),
    });
    assert.equal(published.status, 0);
    const manifest = `${published.dir}/wave-1.3.0-ti.source.json`;
    const directions = `${published.dir}/wave-1.3.0-ti.source.md`;
    assert.ok(published.gh.includes(` ${manifest} ${directions} `), published.gh);
    assert.equal(readFileSync(manifest, "utf8"), '{"schema":"wave-release-source/1"}');
    const notes = /--notes-file (\S+)/.exec(published.gh)?.[1] ?? "";
    assert.equal(readFileSync(notes, "utf8"), "- Fixed a thing\n\n## Source for Wave 1.3.0-ti\n");
  });

  it("publishes without source files when the release job made none", () => {
    const { status, gh } = publish(SHA);
    assert.equal(status, 0);
    assert.doesNotMatch(gh, /\.source\./);
  });

  it("answers nothing when the tag moved, so nothing after it publishes", () => {
    const { status, stdout, output, gh } = publish("b".repeat(40));
    assert.equal(status, 0);
    assert.match(stdout, /Publishing nothing/);
    assert.equal(gh, "");
    assert.equal(output, "");
  });
});

describe("publish-release.sh over an existing release", () => {
  const record = (source: string) =>
    JSON.stringify({ schema: "wave-release-provenance/1", source });

  it("replaces the APK of a re-run from the same source and rewrites its notes", () => {
    const sources = mkdtempSync(join(tmpdir(), "wave-source-"));
    writeFileSync(join(sources, "directions.md"), "## Source for Wave 1.3.0-ti\n");
    const { status, gh } = publish(
      SHA,
      { SOURCE_DIRECTIONS_FILE: join(sources, "directions.md") },
      record(SHA),
    );
    assert.equal(status, 0);
    assert.match(gh, /release upload v1\.3\.0-ti .* --clobber/);
    const edit = /release edit v1\.3\.0-ti (.*)/.exec(gh)?.[1] ?? "";
    assert.match(edit, /--prerelease --latest=false/);
    const notes = /--notes-file (\S+)/.exec(edit)?.[1] ?? "";
    assert.match(readFileSync(notes, "utf8"), /## Source for Wave 1\.3\.0-ti/);
  });

  it("leaves a release built from another source as it is, and fails", () => {
    const { status, gh, output, stdout } = publish(SHA, {}, record("c".repeat(40)));
    assert.notEqual(status, 0);
    assert.match(stdout, /ccccccc/);
    assert.doesNotMatch(gh, /upload|create/);
    assert.equal(output, "");
  });

  it("keeps the APK of a release published before records, and fails saying so", () => {
    const { status, gh, output, stdout } = publish(SHA, {}, "");
    assert.notEqual(status, 0);
    assert.match(stdout, /::error::.*before provenance records/);
    assert.doesNotMatch(gh, /upload|edit|create/);
    assert.equal(output, "");
  });

  it("fails, replacing nothing, when GitHub can't say what the release holds", () => {
    const { status, gh, output } = publish(SHA, {}, record(SHA), "list");
    assert.notEqual(status, 0);
    assert.doesNotMatch(gh, /upload|edit|create/);
    assert.equal(output, "");
  });

  it("fails, replacing nothing, when the release's record can't be downloaded", () => {
    const { status, gh, output, stdout } = publish(SHA, {}, record(SHA), "download");
    assert.notEqual(status, 0);
    assert.match(stdout, /::error::.*couldn't be downloaded/);
    assert.doesNotMatch(gh, /upload|edit|create/);
    assert.equal(output, "");
  });
});

describe("the release job", () => {
  it("prepares the release source only when the owner turned source delivery on", () => {
    const workflow = readFileSync(repoFile(".github/workflows/ci.yml"), "utf8");
    const job = workflow.slice(workflow.indexOf("\n  release:\n"));
    const steps = job.split(/\n(?= {6}- )/);
    const at = (name: string) => steps.findIndex((step) => step.includes(`name: ${name}\n`));
    const prepare = at("Prepare the release source");
    assert.ok(prepare > at("Seal the provenance record"), "after the record is sealed");
    assert.ok(prepare < at("Publish the release"), "before the release is published");
    const checkout = steps[prepare - 1]!;
    assert.match(checkout, /uses: actions\/checkout@[0-9a-f]{40}/);
    assert.match(checkout, /ref: \$\{\{ needs\.release-gate\.outputs\.sha \}\}/);
    assert.match(checkout, /persist-credentials: false/);
    for (const step of [checkout, steps[prepare]!]) {
      assert.match(
        step,
        /if: vars\.RELEASE_SOURCE_DELIVERY == 'on' && needs\.checks\.outputs\.release_tag != ''/,
      );
      assert.doesNotMatch(step, /secrets\./);
    }
    for (const command of ["manifest", "verify", "directions"])
      assert.match(steps[prepare]!, new RegExp(`release-source\\.ts ${command} `));
    assert.match(steps[prepare]!, /SOURCE_MANIFEST_FILE=.*>> "\$GITHUB_ENV"/);
    assert.match(steps[prepare]!, /SOURCE_DIRECTIONS_FILE=.*>> "\$GITHUB_ENV"/);
  });

  it("publishes updates only after the GitHub Release exists", () => {
    const workflow = readFileSync(repoFile(".github/workflows/ci.yml"), "utf8");
    const afterRelease = workflow.slice(workflow.indexOf("- name: Publish the release\n"));
    const steps = afterRelease.split(/\n(?= {6}- )/).slice(1);
    const names = steps.map((step) => /name: (.*)/.exec(step)?.[1] ?? "");
    assert.deepEqual(names, [
      "Move the latest build",
      "Publish the release notes",
      "Publish the latest APK",
      "Fetch the over-the-air update",
      "Check the update against the gate's record",
      "Publish the over-the-air update",
      "Publish the desktop update",
    ]);
    for (const [index, step] of steps.entries()) {
      assert.match(step, /if: .*steps\.published\.outputs\.url != ''/, names[index]);
    }
  });
});
