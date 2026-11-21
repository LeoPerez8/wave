import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { releaseBody } from "./release-notes.ts";

const repoFile = (path: string) => fileURLToPath(new URL(`../../${path}`, import.meta.url));

const SHA = "a".repeat(40);

/** The stub `gh`'s release body: `create` and `edit` write their notes file into it. */
const keepBody = (dir: string) => `case "$2" in create|edit)
  while [ $# -gt 0 ]; do [ "$1" = "--notes-file" ] && cp "$2" "${dir}/body.txt"; shift; done ;;
esac`;

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
    case "$*" in *"--json body"*) cat "${dir}/body.txt" 2> /dev/null; exit 0 ;; esac
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
echo "gh $*" >> "${dir}/gh.log"
${keepBody(dir)}`,
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
        RELEASE_NOTES_SETTLE: "0",
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
    assert.equal(
      readFileSync(notes, "utf8"),
      releaseBody("", "android", "- Fixed a thing\n\n## Source for Wave 1.3.0-ti\n"),
    );
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

describe("the release jobs", () => {
  it("prepares the release source only when the owner turned source delivery on", () => {
    const workflow = readFileSync(repoFile(".github/workflows/mobile.yml"), "utf8");
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
      assert.match(step, /if: vars\.RELEASE_SOURCE_DELIVERY == 'on' && inputs\.release_tag != ''/);
      assert.doesNotMatch(step, /secrets\./);
    }
    for (const command of ["manifest", "verify", "directions"])
      assert.match(steps[prepare]!, new RegExp(`release-source\\.ts ${command} `));
    assert.match(steps[prepare]!, /SOURCE_MANIFEST_FILE=.*>> "\$GITHUB_ENV"/);
    assert.match(steps[prepare]!, /SOURCE_DIRECTIONS_FILE=.*>> "\$GITHUB_ENV"/);
  });

  it("publish updates only after the GitHub Release exists, each app its own", () => {
    const after = {
      "mobile.yml": [
        "Move the latest build",
        "Publish the release notes",
        "Publish the latest APK",
        "Fetch the over-the-air update",
        "Check the update against the gate's record",
        "Publish the over-the-air update",
      ],
      "desktop.yml": ["Publish the desktop update"],
    };
    for (const [file, expected] of Object.entries(after)) {
      const workflow = readFileSync(repoFile(`.github/workflows/${file}`), "utf8");
      const afterRelease = workflow.slice(workflow.indexOf("- name: Publish the release\n"));
      const steps = afterRelease.split(/\n(?= {6}- )/).slice(1);
      const names = steps.map((step) => /name: (.*)/.exec(step)?.[1] ?? "");
      assert.deepEqual(names, expected, file);
      for (const [index, step] of steps.entries()) {
        assert.match(step, /if: .*steps\.published\.outputs\.url != ''/, names[index]);
      }
    }
  });
});

/**
 * Runs the script for a branch push against a GitHub Release that holds `assets` once it exists.
 * The release is missing for the first `missing` views; `failCreate` makes `gh release create`
 * fail, as when the other app's release job created it first. `record` is what a downloaded
 * record holds.
 */
const publishTo = (
  app: "android" | "desktop",
  {
    assets = [] as string[],
    missing = 0,
    failCreate = false,
    record = "",
    body = "",
    notes = "",
    lose = false,
  } = {},
) => {
  const dir = mkdtempSync(join(tmpdir(), "wave-release-"));
  const script = (name: string, body: string) => {
    writeFileSync(join(dir, name), `#!/bin/sh\n${body}\n`);
    chmodSync(join(dir, name), 0o755);
  };
  script("git", `printf '%s\trefs/tags/v1.3.0-ti\n' "${SHA}"`);
  writeFileSync(join(dir, "assets.txt"), assets.map((name) => `${name}\n`).join(""));
  writeFileSync(join(dir, "record.json"), record);
  writeFileSync(join(dir, "views"), "0");
  writeFileSync(join(dir, "body.txt"), body);
  // With `lose`, the other app's job writes the body it read before this job's first edit.
  writeFileSync(join(dir, "before.txt"), body);
  if (lose) writeFileSync(join(dir, "lose"), "");
  script(
    "gh",
    `case "$2" in
  view)
    n="$(cat "${dir}/views")"; echo $((n + 1)) > "${dir}/views"
    [ "$n" -ge ${missing} ] || exit 1
    case "$*" in *"--json body"*) cat "${dir}/body.txt" ;; *--json*) cat "${dir}/assets.txt" ;; esac
    exit 0 ;;
  download)
    while [ $# -gt 0 ]; do
      [ "$1" = "--dir" ] && out="$2"; [ "$1" = "--pattern" ] && pattern="$2"; shift
    done
    mkdir -p "$out" && cp "${dir}/record.json" "$out/$pattern"
    exit 0 ;;
esac
echo "gh $*" >> "${dir}/gh.log"
case "$2" in create) ${failCreate ? "exit 1" : ":"} ;; esac
command="$2"
${keepBody(dir)}
if [ "$command" = edit ] && [ -e "${dir}/lose" ]; then
  rm "${dir}/lose"; cp "${dir}/before.txt" "${dir}/body.txt"
fi`,
  );
  writeFileSync(join(dir, "gh.log"), "");
  writeFileSync(join(dir, "provenance.json"), JSON.stringify({ source: SHA }));
  const files =
    app === "android"
      ? [join(dir, "app.apk")]
      : [join(dir, "wave-1.3.0-ti-win-x64.exe"), join(dir, "wave-1.3.0-ti-linux-x64.AppImage")];
  for (const file of files) writeFileSync(file, "installer");
  if (notes) writeFileSync(join(dir, "notes.md"), notes);
  const output = join(dir, "output");
  writeFileSync(output, "");
  const { status, stdout } = spawnSync(
    "bash",
    [repoFile("scripts/ci/publish-release.sh"), ...files],
    {
      encoding: "utf8",
      env: {
        PATH: `${dir}:${process.env.PATH}`,
        RUNNER_TEMP: dir,
        RELEASE_APP: app,
        RELEASE_TAG: "v1.3.0-ti",
        RELEASE_SHA: SHA,
        GITHUB_REF_TYPE: "branch",
        GITHUB_REPOSITORY: "o/r",
        GITHUB_OUTPUT: output,
        PROVENANCE_FILE: join(dir, "provenance.json"),
        RELEASE_NOTES_SETTLE: "0",
        ...(notes ? { RELEASE_NOTES_FILE: join(dir, "notes.md") } : {}),
      },
    },
  );
  return {
    dir,
    status,
    stdout,
    output: readFileSync(output, "utf8"),
    gh: readFileSync(join(dir, "gh.log"), "utf8"),
    body: readFileSync(join(dir, "body.txt"), "utf8"),
  };
};

describe("publish-release.sh for either app alone", () => {
  const PHONE = ["wave-1.3.0-ti.apk", "wave-1.3.0-ti.provenance.json"];
  const DESKTOP = [
    "wave-1.3.0-ti-win-x64.exe",
    "wave-1.3.0-ti-linux-x64.AppImage",
    "wave-1.3.0-ti.desktop.provenance.json",
  ];

  it("creates the release with the desktop's installers and record when the phone hasn't", () => {
    const { status, gh, output, dir } = publishTo("desktop", { missing: 99 });
    assert.equal(status, 0);
    const create = /release create (.*)/.exec(gh)?.[1] ?? "";
    assert.ok(create.includes(join(dir, "wave-1.3.0-ti-win-x64.exe")), create);
    assert.ok(create.includes(join(dir, "wave-1.3.0-ti-linux-x64.AppImage")), create);
    assert.ok(create.includes(`${dir}/wave-1.3.0-ti.desktop.provenance.json`), create);
    assert.doesNotMatch(create, /\.apk|wave-1\.3\.0-ti\.provenance\.json/);
    assert.match(create, /--prerelease --latest=false --title Wave 1\.3\.0-ti/);
    assert.match(output, /^url=https:.*\/releases\/tag\/v1\.3\.0-ti$/m);
  });

  it("adds the desktop's installers to the phone's release and keeps its notes", () => {
    const body = releaseBody("", "android", "- Phone line\n");
    const published = publishTo("desktop", { assets: PHONE, body, notes: "- Desktop line\n" });
    assert.equal(published.status, 0);
    assert.match(published.gh, /release upload v1\.3\.0-ti .*win-x64\.exe.* --clobber/);
    assert.doesNotMatch(published.gh, /create|\.apk/);
    assert.equal(published.body, releaseBody(body, "desktop", "- Desktop line\n"));
  });

  it("gives the release the same notes whichever app publishes first", () => {
    const [phone, desktop] = ["- Phone line\n", "- Desktop line\n"];
    const phoneFirst = publishTo("android", { missing: 99, notes: phone });
    const thenDesktop = publishTo("desktop", {
      assets: PHONE,
      body: phoneFirst.body,
      notes: desktop,
    });
    const desktopFirst = publishTo("desktop", { missing: 99, notes: desktop });
    const thenPhone = publishTo("android", {
      assets: DESKTOP,
      body: desktopFirst.body,
      notes: phone,
    });
    for (const run of [phoneFirst, thenDesktop, desktopFirst, thenPhone])
      assert.equal(run.status, 0, run.stdout);
    assert.equal(thenDesktop.body, thenPhone.body);
    assert.match(thenPhone.body, /Phone line[\s\S]*Desktop line/);
  });

  it("writes its notes again when the other app's write took them out", () => {
    const published = publishTo("desktop", {
      assets: PHONE,
      body: releaseBody("", "android", "- Phone line\n"),
      notes: "- Desktop line\n",
      lose: true,
    });
    assert.equal(published.status, 0);
    assert.equal(published.gh.match(/release edit/g)?.length, 2);
    assert.match(published.body, /Phone line[\s\S]*Desktop line/);
  });

  it("adds the APK to the desktop's release, writing the phone's notes", () => {
    const { status, gh, output } = publishTo("android", { assets: DESKTOP });
    assert.equal(status, 0);
    assert.match(gh, /release upload v1\.3\.0-ti .*wave-1\.3\.0-ti\.apk .*--clobber/);
    assert.match(gh, /release edit v1\.3\.0-ti --notes-file/);
    assert.doesNotMatch(gh, /create/);
    assert.match(output, /^url=https:.*wave-1\.3\.0-ti\.apk$/m);
  });

  it("adds to the release when the other app created it first", () => {
    for (const app of ["android", "desktop"] as const) {
      const { status, gh, output } = publishTo(app, { missing: 1, failCreate: true });
      assert.equal(status, 0, app);
      assert.match(gh, /release create v1\.3\.0-ti/, app);
      assert.match(gh, /release upload v1\.3\.0-ti .* --clobber/, app);
      assert.match(output, /^url=/m, app);
    }
  });

  it("fails when the release can't be created and still isn't there", () => {
    const { status, gh, output } = publishTo("desktop", { missing: 2, failCreate: true });
    assert.notEqual(status, 0);
    assert.doesNotMatch(gh, /upload/);
    assert.equal(output, "");
  });

  it("re-publishes the desktop's installers only over its own record from the same source", () => {
    const same = publishTo("desktop", {
      assets: [...PHONE, ...DESKTOP],
      record: JSON.stringify({ source: SHA }),
    });
    assert.equal(same.status, 0);
    assert.match(same.gh, /release upload v1\.3\.0-ti .*AppImage.* --clobber/);
    const other = publishTo("desktop", {
      assets: [...PHONE, ...DESKTOP],
      record: JSON.stringify({ source: "c".repeat(40) }),
    });
    assert.notEqual(other.status, 0);
    assert.match(other.stdout, /ccccccc/);
    assert.doesNotMatch(other.gh, /upload|create|edit/);
  });

  it("keeps desktop installers published before the desktop had its own record", () => {
    const { status, gh, stdout } = publishTo("desktop", {
      assets: [...PHONE, ...DESKTOP.slice(0, 2)],
    });
    assert.notEqual(status, 0);
    assert.match(stdout, /::error::.*before/);
    assert.doesNotMatch(gh, /upload|create|edit/);
  });
});
