import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import type { PublishedRelease } from "./changes.ts";
import { promotableSource, promotedApps, promotion } from "./promote-version.ts";

const TAGS = ["latest", "ti-latest", "v0.9.0-ti", "v0.9.0", "v0.10.0-ti", "v0.10.1", "v0.11.0-ti"];

describe("promotion", () => {
  it("takes the newest -ti release, by version, when none is asked for", () => {
    assert.deepEqual(promotion({ requested: "", tags: TAGS }), {
      from: "v0.11.0-ti",
      to: "v0.11.0",
    });
  });

  it("takes the version asked for, however it's written", () => {
    const tags = ["v0.10.1", "v0.11.0-ti", "v0.11.1-ti", "v0.12.0-ti"];
    const expected = { from: "v0.11.1-ti", to: "v0.11.1" };
    for (const requested of ["0.11.1-ti", "0.11.1", "v0.11.1-ti", "v0.11.1", " 0.11.1 "])
      assert.deepEqual(promotion({ requested, tags }), expected, requested);
  });

  it("refuses a version with no -ti release, and says so", () => {
    assert.throws(
      () => promotion({ requested: "0.12.0", tags: TAGS }),
      /v0\.12\.0-ti doesn't exist/,
    );
  });

  it("refuses what isn't a version", () => {
    assert.throws(() => promotion({ requested: "newest", tags: TAGS }), /isn't a version/);
  });

  it("refuses a version already promoted, and says how to retry its publishing", () => {
    assert.throws(
      () => promotion({ requested: "0.9.0", tags: ["v0.9.0-ti", "v0.9.0"] }),
      /v0\.9\.0 already exists.*re-run/s,
    );
  });

  it("refuses by default when the newest -ti release is already promoted", () => {
    assert.throws(
      () => promotion({ requested: "", tags: ["v0.9.0-ti", "v0.9.0"] }),
      /v0\.9\.0 already exists/,
    );
  });

  it("refuses a version below the newest stable one, which phones wouldn't install", () => {
    assert.throws(() => promotion({ requested: "0.10.0", tags: TAGS }), /v0\.10\.1 is already out/);
  });

  it("refuses when no -ti release exists", () => {
    assert.throws(() => promotion({ requested: "", tags: ["v0.9.0"] }), /No -ti release/);
  });
});

const phone = (version: string): PublishedRelease => ({
  tagName: `v${version}`,
  assets: [`wave-${version}.apk`, `wave-${version}.provenance.json`],
});
const desktop = (version: string): PublishedRelease => ({
  tagName: `v${version}`,
  assets: [
    `wave-${version}-win-x64.exe`,
    `wave-${version}-linux-x64.AppImage`,
    `wave-${version}.desktop.provenance.json`,
  ],
});
const both = (version: string): PublishedRelease => ({
  tagName: `v${version}`,
  assets: [...phone(version).assets, ...desktop(version).assets],
});
const apps = (
  releases: readonly PublishedRelease[],
  app: "both" | "mobile" | "desktop" = "both",
  desktopMain = true,
) => promotedApps({ to: "v0.12.0", app, releases, desktopMain });

describe("promotedApps", () => {
  it("promotes both apps from the version's own release when it holds both", () => {
    assert.deepEqual(apps([both("0.11.0-ti"), both("0.12.0-ti")]).sources, {
      mobile: "v0.12.0-ti",
      desktop: "v0.12.0-ti",
    });
  });

  it("promotes each app from its own newest release at or below the version", () => {
    const releases = [both("0.11.0-ti"), phone("0.12.0-ti"), both("0.13.0-ti")];
    assert.deepEqual(apps(releases).sources, { mobile: "v0.12.0-ti", desktop: "v0.11.0-ti" });
    const newerDesktop = [both("0.10.0-ti"), phone("0.11.0-ti"), desktop("0.12.0-ti")];
    assert.deepEqual(apps(newerDesktop).sources, { mobile: "v0.11.0-ti", desktop: "v0.12.0-ti" });
  });

  it("takes the phone only from a release with its APK and its record", () => {
    const unrecorded = { tagName: "v0.12.0-ti", assets: ["wave-0.12.0-ti.apk"] };
    assert.equal(apps([both("0.11.0-ti"), unrecorded]).sources.mobile, "v0.11.0-ti");
  });

  it("takes the desktop only from a release with both installers", () => {
    const linuxOnly = { tagName: "v0.12.0-ti", assets: ["wave-0.12.0-ti-linux-x64.AppImage"] };
    assert.equal(apps([both("0.11.0-ti"), linuxOnly]).sources.desktop, "v0.11.0-ti");
  });

  it("promotes only the app asked for", () => {
    const releases = [both("0.12.0-ti")];
    assert.deepEqual(apps(releases, "mobile").sources, { mobile: "v0.12.0-ti" });
    assert.deepEqual(apps(releases, "desktop").sources, { desktop: "v0.12.0-ti" });
  });

  it("leaves out the desktop while RELEASE_DESKTOP_MAIN is off, and says so", () => {
    const { sources, skipped } = apps([both("0.12.0-ti")], "both", false);
    assert.deepEqual(sources, { mobile: "v0.12.0-ti" });
    assert.match(skipped.join(" "), /RELEASE_DESKTOP_MAIN/);
    assert.throws(() => apps([both("0.12.0-ti")], "desktop", false), /RELEASE_DESKTOP_MAIN/);
  });

  it("leaves out an app with no release at or below the version, and says so", () => {
    const { sources, skipped } = apps([phone("0.12.0-ti"), desktop("0.13.0-ti")]);
    assert.deepEqual(sources, { mobile: "v0.12.0-ti" });
    assert.match(skipped.join(" "), /desktop has no -ti release at or below v0\.12\.0-ti/);
    assert.throws(
      () => apps([phone("0.12.0-ti")], "desktop"),
      /desktop has no -ti release at or below/,
    );
  });

  it("leaves out an app whose release is already on main", () => {
    const releases = [both("0.11.0-ti"), both("0.11.0"), phone("0.12.0-ti")];
    const { sources, skipped } = apps(releases);
    assert.deepEqual(sources, { mobile: "v0.12.0-ti" });
    assert.match(skipped.join(" "), /v0\.11\.0 already has the desktop/);
    assert.throws(() => apps(releases, "desktop"), /v0\.11\.0 already has the desktop/);
  });

  it("still promotes an app the previous stable release left out", () => {
    const releases = [both("0.11.0-ti"), phone("0.11.0"), phone("0.12.0-ti")];
    assert.equal(apps(releases).sources.desktop, "v0.11.0-ti");
  });

  it("fails when neither app has anything to promote", () => {
    assert.throws(() => apps([both("0.11.0-ti"), both("0.11.0")]), /Nothing to promote/);
  });

  it("refuses an app that isn't one", () => {
    assert.throws(
      () => promotedApps({ to: "v0.12.0", app: "tv" as "both", releases: [], desktopMain: true }),
      /both, mobile or desktop/,
    );
  });
});

describe("promotableSource", () => {
  it("accepts a -ti release at or below the stable version", () => {
    assert.equal(promotableSource("v0.12.0", "v0.12.0-ti"), undefined);
    assert.equal(promotableSource("v0.12.0", "v0.11.3-ti"), undefined);
  });

  it("refuses a newer release, a stable one or something else", () => {
    assert.match(promotableSource("v0.12.0", "v0.12.1-ti") ?? "", /above v0\.12\.0/);
    assert.match(promotableSource("v0.12.0", "v0.11.0") ?? "", /isn't a -ti release/);
    assert.match(promotableSource("v0.12.0-ti", "v0.11.0-ti") ?? "", /isn't a stable tag/);
  });
});

describe("the command line", () => {
  const run = (...args: string[]) => {
    const tags = join(mkdtempSync(join(tmpdir(), "wave-promote-")), "tags.txt");
    writeFileSync(tags, `${TAGS.join("\n")}\n`);
    return spawnSync(
      process.execPath,
      [fileURLToPath(new URL("promote-version.ts", import.meta.url)), tags, ...args],
      { encoding: "utf8" },
    );
  };

  it("prints the tags for $GITHUB_OUTPUT", () => {
    assert.equal(run("0.11.0").stdout, "from=v0.11.0-ti\nto=v0.11.0\n");
  });

  it("fails with the reason alone", () => {
    const { status, stderr, stdout } = run("0.10.0");
    assert.equal(status, 1);
    assert.equal(stdout, "");
    assert.match(stderr, /^::error::.*v0\.10\.1 is already out/);
  });

  it("prints each app's release when given the releases", () => {
    const dir = mkdtempSync(join(tmpdir(), "wave-promote-"));
    const releases = join(dir, "releases.txt");
    writeFileSync(
      releases,
      [both("0.10.0-ti"), phone("0.11.0-ti")].map((release) => JSON.stringify(release)).join("\n"),
    );
    const { status, stdout, stderr } = run("0.11.0", releases, "both", "off");
    assert.equal(status, 0, stderr);
    assert.equal(stdout, "from=v0.11.0-ti\nto=v0.11.0\nmobile=v0.11.0-ti\n");
    assert.match(stderr, /RELEASE_DESKTOP_MAIN/);
  });

  it("checks a promotion's source", () => {
    const script = fileURLToPath(new URL("promote-version.ts", import.meta.url));
    const check = (...args: string[]) =>
      spawnSync(process.execPath, [script, "--check-source", ...args], { encoding: "utf8" });
    assert.equal(check("v0.12.0", "v0.11.0-ti").status, 0);
    const refused = check("v0.12.0", "v0.13.0-ti");
    assert.equal(refused.status, 1);
    assert.match(refused.stderr, /above v0\.12\.0/);
  });
});
