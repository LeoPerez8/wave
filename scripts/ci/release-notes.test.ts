import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { releaseBody } from "./release-notes.ts";

const script = fileURLToPath(new URL("./release-notes.ts", import.meta.url));

const PHONE = "## New\n\n- [Lyrics follow the song](https://x/1)\n";
const DESKTOP = "## Fixes\n\n- [The window remembers its size](https://x/2)\n";

describe("releaseBody", () => {
  it("is the same whichever app publishes first", () => {
    const phoneFirst = releaseBody(releaseBody("", "android", PHONE), "desktop", DESKTOP);
    const desktopFirst = releaseBody(releaseBody("", "desktop", DESKTOP), "android", PHONE);
    assert.equal(phoneFirst, desktopFirst);
    assert.ok(phoneFirst.indexOf("Lyrics") < phoneFirst.indexOf("window"), "the phone's first");
  });

  it("heads each app's notes only when the release holds both", () => {
    const one = releaseBody("", "desktop", DESKTOP);
    assert.doesNotMatch(one, /^# /m);
    assert.match(one, /The window remembers its size/);
    const both = releaseBody(one, "android", PHONE);
    assert.match(both, /^# Android\n/m);
    assert.match(both, /^# Desktop\n/m);
  });

  it("replaces only its own app's notes on a re-run", () => {
    const body = releaseBody(releaseBody("", "android", PHONE), "desktop", DESKTOP);
    const rerun = releaseBody(body, "android", "## New\n\n- Another line\n");
    assert.match(rerun, /Another line/);
    assert.doesNotMatch(rerun, /Lyrics/);
    assert.match(rerun, /The window remembers its size/);
    assert.equal(releaseBody(body, "desktop", DESKTOP), body, "the same notes change nothing");
  });

  it("counts a body from before the sections as the phone's notes", () => {
    const body = releaseBody("Wave 1.2.0 for Android.\r\n", "desktop", DESKTOP);
    assert.match(body, /# Android\n[\s\S]*Wave 1\.2\.0 for Android\.[\s\S]*# Desktop\n/);
    assert.equal(releaseBody("Wave 1.2.0 for Android.", "android", PHONE), releaseBody("", "android", PHONE));
  });

  it("reads GitHub's copy of a body it wrote as the same body", () => {
    const body = releaseBody(releaseBody("", "android", PHONE), "desktop", DESKTOP);
    const fromGitHub = `${body.replaceAll("\n", "\r\n").trimEnd()}`;
    assert.equal(releaseBody(fromGitHub, "desktop", DESKTOP), body);
  });
});

describe("release-notes.ts", () => {
  const section = () => {
    const file = join(mkdtempSync(join(tmpdir(), "wave-notes-")), "notes.md");
    writeFileSync(file, DESKTOP);
    return file;
  };

  it("prints the merged body", () => {
    const { status, stdout } = spawnSync(process.execPath, [script, "desktop", section()], {
      input: "",
      encoding: "utf8",
    });
    assert.equal(status, 0);
    assert.equal(stdout, releaseBody("", "desktop", DESKTOP));
  });

  it("with --unchanged, says whether the body already holds the app's notes", () => {
    const file = section();
    const run = (input: string) =>
      spawnSync(process.execPath, [script, "desktop", file, "--unchanged"], {
        input,
        encoding: "utf8",
      }).status;
    assert.equal(run(releaseBody("", "desktop", DESKTOP)), 0);
    assert.equal(run(releaseBody("", "android", PHONE)), 1);
  });
});
