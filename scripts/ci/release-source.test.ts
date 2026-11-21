import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { appVersionAt, releaseSource, sourceDirections, verifySource } from "./release-source.ts";
import type { SourceManifest } from "./release-source.ts";

const REPO = "LeoPerez8/wave";
const SOURCE = "b".repeat(40);
const BASE = "a".repeat(40);
const KEY = `apk-v2-${"c".repeat(64)}`;

/** The release job's sealed record (docs/release-provenance.md) for a full build of v1.3.0-ti. */
const sealed = (artifact: Record<string, unknown> = {}, top: Record<string, unknown> = {}) => ({
  schema: "wave-release-provenance/1",
  source: SOURCE,
  releaseTag: "v1.3.0-ti",
  run: { repository: REPO, id: 123, attempt: 1, event: "push", ref: "refs/heads/main" },
  artifact: {
    build: "full",
    name: "unsigned-wave-bbbbbbb.apk",
    apk: "wave-bbbbbbb.apk",
    unsignedSha256: "d".repeat(64),
    bundleSha256: "e".repeat(64),
    runtimeVersion: KEY,
    updateChannel: "ti",
    updateSha256: "f".repeat(64),
    signedSha256: "1".repeat(64),
    ...artifact,
  },
  ...top,
});

const inputs = (record: unknown = sealed()) => ({
  record,
  repository: REPO,
  version: "1.3.0-ti",
  buildInputs: ["pnpm-lock.yaml", "apps/mobile/package.json", "docs/release-source.md"],
  components: [
    {
      id: "com.github.MetrolistGroup.innertubex:innertubex:0.8.6",
      kind: "native-library",
      status: "compatible" as const,
      licence: "GPL-3.0",
      correspondingSource:
        "https://github.com/MetrolistGroup/innertubex/tree/af31fd2ba65cb8cb56461c103517be96564cd91b",
    },
    { id: "asset:app-icons", kind: "asset", status: "compatible" as const },
  ],
  notices: [{ subject: "react@19.1.0", licence: "MIT", notices: ["LICENSE"] }],
  blockers: [{ subject: "gradle:release-closure", reason: "Pending: not observed." }],
});

describe("the release tag rules", () => {
  it("are apps/mobile/plugins/appVersion.ts's: the versionCode it derives and the tags it refuses", async () => {
    // A path tsc doesn't follow (it reads apps/mobile as CommonJS); Node runs the file as it is.
    const original = new URL("../../apps/mobile/plugins/appVersion.ts", import.meta.url).href;
    const app = (await import(original)) as {
      versionCode: (version: string) => number;
      releaseTagProblem: (tag: string, version: string) => string | undefined;
    };
    const { record: _, ...rest } = inputs();
    const copied = (tag: string, version: string) => {
      try {
        return releaseSource({ ...rest, version, legacy: { tag, commit: SOURCE } }).generated
          .versionCode;
      } catch {
        return "refused";
      }
    };
    const fromApp = (tag: string, version: string) => {
      if (app.releaseTagProblem(tag, version) !== undefined) return "refused";
      try {
        return app.versionCode(tag.slice(1));
      } catch {
        return "refused";
      }
    };
    const cases = [
      ["v0.5.0", "0.5.0"],
      ["v1.3.0-ti", "1.3.0-ti"],
      ["v1.3.0", "1.3.0-ti"],
      ["v12.34.56", "12.34.56"],
      ["v0.99.9-ti", "0.99.9-ti"],
      ["v1.3.0-ti", "1.3.0"],
      ["v1.3.1", "1.3.0"],
      ["v1.100.0", "1.100.0"],
      ["v1.3", "1.3"],
      ["vfoo", "foo"],
      ["1.3.0", "1.3.0"],
    ] as const;
    for (const [tag, version] of cases)
      assert.equal(copied(tag, version), fromApp(tag, version), `${tag} at ${version}`);
    assert.equal(fromApp("v12.34.56", "12.34.56"), 123456);
    assert.equal(fromApp("v1.3.1", "1.3.0"), "refused");
  });
});

describe("releaseSource", () => {
  it("ties a sealed full build to its exact commit, never to a moving branch", () => {
    const manifest = releaseSource(inputs());
    assert.equal(manifest.schema, "wave-release-source/1");
    assert.equal(manifest.releaseTag, "v1.3.0-ti");
    assert.equal(manifest.provenance, "sealed-record");
    assert.equal(manifest.build, "full");
    assert.deepEqual(manifest.source, {
      revision: SOURCE,
      archive: `https://github.com/${REPO}/archive/${SOURCE}.tar.gz`,
      tree: `https://github.com/${REPO}/tree/${SOURCE}`,
    });
    assert.equal(manifest.nativeBase, null);
    assert.equal(
      manifest.instructions,
      `https://github.com/${REPO}/blob/${SOURCE}/docs/release-source.md`,
    );
    assert.deepEqual(manifest.generated, {
      versionName: "1.3.0-ti",
      versionCode: 10300,
      updateChannel: "ti",
      runtimeVersion: KEY,
    });
    assert.equal(manifest.artifacts?.signedSha256, "1".repeat(64));
    assert.deepEqual(manifest.buildInputs, inputs().buildInputs);
    assert.deepEqual(manifest.thirdPartySource, [
      {
        subject: "com.github.MetrolistGroup.innertubex:innertubex:0.8.6",
        licence: "GPL-3.0",
        source:
          "https://github.com/MetrolistGroup/innertubex/tree/af31fd2ba65cb8cb56461c103517be96564cd91b",
      },
    ]);
    assert.deepEqual(manifest.notices, inputs().notices);
    assert.deepEqual(manifest.pending, ["gradle:release-closure: Pending: not observed."]);
    for (const link of JSON.stringify(manifest).match(/https:\/\/github\.com\/LeoPerez8[^"]*/g)!)
      assert.ok(link.includes(SOURCE), link);
  });

  it("names a repack's native base, whose source the APK also carries", () => {
    const base = { source: BASE, run: 120, key: KEY, unsignedSha256: "9".repeat(64) };
    const manifest = releaseSource(inputs(sealed({ build: "repack", base })));
    assert.equal(manifest.build, "repack");
    assert.deepEqual(manifest.nativeBase, {
      revision: BASE,
      archive: `https://github.com/${REPO}/archive/${BASE}.tar.gz`,
      tree: `https://github.com/${REPO}/tree/${BASE}`,
      runtimeVersion: KEY,
    });
  });

  it("refuses a repack whose native base is missing or for another runtime", () => {
    assert.throws(() => releaseSource(inputs(sealed({ build: "repack" }))), /no native base/);
    const other = { source: BASE, run: 120, key: `apk-v2-${"0".repeat(64)}`, unsignedSha256: "" };
    assert.throws(
      () => releaseSource(inputs(sealed({ build: "repack", base: other }))),
      /another runtime/,
    );
  });

  it("refuses what doesn't name a published release", () => {
    assert.throws(() => releaseSource(inputs({ schema: "other" })), /not a release provenance/);
    assert.throws(
      () => releaseSource(inputs(sealed({ signedSha256: undefined }))),
      /signedSha256 is missing/,
    );
    assert.throws(() => releaseSource(inputs(sealed({}, { releaseTag: "" }))), /no release tag/);
    assert.throws(() => releaseSource(inputs(sealed({}, { source: "main" }))), /isn't a full SHA/);
    assert.throws(
      () => releaseSource({ ...inputs(), version: "1.4.0-ti" }),
      /doesn't match the app's version/,
    );
  });

  it("gives a promotion the stable version its build generated", () => {
    const manifest = releaseSource(
      inputs(sealed({ updateChannel: "main" }, { releaseTag: "v1.3.0" })),
    );
    assert.equal(manifest.version, "1.3.0");
    assert.equal(manifest.generated.versionName, "1.3.0");
    assert.equal(manifest.generated.versionCode, 10300);
    assert.equal(manifest.generated.updateChannel, "main");
    assert.equal(manifest.artifacts?.apk, "wave-1.3.0.apk");
  });

  it("links a promotion to the ti release it promotes, from the same source", () => {
    const promotedFrom = {
      releaseTag: "v1.3.0-ti",
      source: SOURCE,
      run: { repository: REPO, id: 120, attempt: 1 },
      signedSha256: "2".repeat(64),
    };
    const stable = (from: unknown) =>
      releaseSource(
        inputs(sealed({ updateChannel: "main" }, { releaseTag: "v1.3.0", promotedFrom: from })),
      );
    assert.deepEqual(stable(promotedFrom).promotedFrom, {
      releaseTag: "v1.3.0-ti",
      signedSha256: "2".repeat(64),
    });
    assert.throws(() => stable({ ...promotedFrom, source: BASE }), /promotes another source/);
    assert.equal(releaseSource(inputs()).promotedFrom, null);
  });

  it("copies nothing from a record beyond the fields it names", () => {
    const record = sealed({ keystorePassword: "hunter2" }, { token: "sekrit" });
    const manifest = JSON.stringify(releaseSource(inputs(record)));
    assert.doesNotMatch(manifest, /hunter2|sekrit|keystorePassword|token/);
  });

  it("covers a release from before the gate by its tag, saying what it can't know", () => {
    const manifest = releaseSource({
      ...inputs(),
      record: undefined,
      legacy: { tag: "v1.3.0-ti", commit: SOURCE },
      instructionsAt: BASE,
    } as never);
    assert.equal(manifest.provenance, "none");
    assert.equal(manifest.build, "unknown");
    assert.equal(manifest.source.revision, SOURCE);
    assert.equal(manifest.artifacts, null);
    assert.equal(
      manifest.instructions,
      `https://github.com/${REPO}/blob/${BASE}/docs/release-source.md`,
    );
    assert.match(manifest.pending[0]!, /before the release gate.*native base/);
    assert.equal(manifest.pending.length, 2);
  });

  it("says when an old release's notices come from a later inventory with another lockfile", () => {
    const legacy = (lockfileMatches: boolean) =>
      releaseSource({
        ...inputs(),
        record: undefined,
        legacy: { tag: "v1.3.0-ti", commit: SOURCE, inventoryAt: BASE, lockfileMatches },
        instructionsAt: BASE,
      } as never).pending;
    assert.ok(
      legacy(false).some((item) => item.includes(`notices come from the inventory at ${BASE}`)),
    );
    assert.ok(!legacy(true).some((item) => item.includes("notices come from")));
  });
});

describe("sourceDirections", () => {
  it("points a recipient at the exact source, the base of a repack and what's still open", () => {
    const base = { source: BASE, run: 120, key: KEY, unsignedSha256: "9".repeat(64) };
    const text = sourceDirections(releaseSource(inputs(sealed({ build: "repack", base }))));
    assert.match(text, /^## Source for Wave 1\.3\.0-ti$/m);
    assert.ok(text.includes(`https://github.com/${REPO}/archive/${SOURCE}.tar.gz`), text);
    assert.ok(text.includes(`https://github.com/${REPO}/archive/${BASE}.tar.gz`), text);
    assert.ok(text.includes(`https://github.com/${REPO}/blob/${SOURCE}/docs/release-source.md`));
    assert.ok(text.includes("MetrolistGroup/innertubex/tree/af31fd2b"), text);
    assert.match(text, /wave-1\.3\.0-ti\.source\.json/);
    assert.match(text, /gradle:release-closure/);
    assert.match(text, /own signing key/);
    assert.doesNotMatch(text, /\/(tree|blob|archive)\/(main|refs)/);
  });

  it("leaves the native base out of a full build's directions", () => {
    const text = sourceDirections(releaseSource(inputs()));
    assert.doesNotMatch(text, /native/i);
  });
});

/** A throwaway repository: a native base, then the release commit tagged v1.3.0-ti. */
const repository = () => {
  const dir = mkdtempSync(join(tmpdir(), "wave-source-"));
  const git = (...args: string[]) => {
    const result = spawnSync("git", ["-C", dir, ...args], {
      encoding: "utf8",
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "t",
        GIT_AUTHOR_EMAIL: "t@example.invalid",
        GIT_COMMITTER_NAME: "t",
        GIT_COMMITTER_EMAIL: "t@example.invalid",
      },
    });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  const commit = (files: Record<string, string>, message: string) => {
    for (const [path, content] of Object.entries(files)) {
      mkdirSync(join(dir, path, ".."), { recursive: true });
      writeFileSync(join(dir, path), content);
    }
    git("add", "-A");
    git("commit", "-q", "--no-gpg-sign", "-m", message);
    return git("rev-parse", "HEAD");
  };
  git("init", "-q");
  const base = commit(
    { "apps/mobile/package.json": '{"version":"1.2.0-ti"}', "pnpm-lock.yaml": "a" },
    "native base",
  );
  const source = commit(
    { "apps/mobile/package.json": '{"version":"1.3.0-ti"}', "docs/release-source.md": "how" },
    "Release Wave 1.3.0-ti",
  );
  git("tag", "v1.3.0-ti", source);
  const manifestFor = (sourceSha: string, baseSha = base) =>
    releaseSource(
      inputs(
        sealed(
          {
            build: "repack",
            base: { source: baseSha, run: 1, key: KEY, unsignedSha256: "9".repeat(64) },
          },
          { source: sourceSha },
        ),
      ),
    );
  return { dir, git, commit, base, source, manifestFor };
};

describe("verifySource", () => {
  it("accepts a manifest that matches the tag, the version, the inputs and the base", () => {
    const repo = repository();
    assert.deepEqual(verifySource(repo.manifestFor(repo.source), repo.dir), []);
  });

  it("reports a tag on another commit, a missing input and a base off the history", () => {
    const repo = repository();
    const manifest = repo.manifestFor(repo.source);
    repo.git("checkout", "-q", "--orphan", "elsewhere");
    const stray = repo.commit({ "apps/mobile/package.json": '{"version":"1.3.0-ti"}' }, "stray");
    repo.git("tag", "-f", "v1.3.0-ti", stray);
    const problems = verifySource(
      { ...manifest, buildInputs: [...manifest.buildInputs, "gone.txt"] },
      repo.dir,
    );
    assert.ok(
      problems.some((p) => /v1\.3\.0-ti is on .*, not on/.test(p)),
      problems.join(" | "),
    );
    assert.ok(
      problems.some((p) => /gone\.txt/.test(p)),
      problems.join(" | "),
    );

    const offHistory = repo.manifestFor(repo.source, stray);
    repo.git("tag", "-f", "v1.3.0-ti", repo.source);
    assert.ok(
      verifySource(offHistory, repo.dir).some((p) => /native base .* isn't in the history/.test(p)),
    );
  });

  it("reports a source whose app version isn't the tag's", () => {
    const repo = repository();
    const manifest = repo.manifestFor(repo.base);
    repo.git("tag", "-f", "v1.3.0-ti", repo.base);
    assert.ok(
      verifySource(manifest, repo.dir).some((p) => /doesn't match the app's version/.test(p)),
    );
  });

  it("reports a link that follows a branch instead of a commit", () => {
    const repo = repository();
    const manifest = repo.manifestFor(repo.source);
    const moving = {
      ...manifest,
      instructions: manifest.instructions.replace(repo.source, "main"),
    };
    assert.ok(verifySource(moving, repo.dir).some((p) => /doesn't name a commit/.test(p)));
  });
});

describe("release-source.ts manifest", () => {
  it("builds the manifest from a sealed record with this checkout's inventory and notices", () => {
    const root = fileURLToPath(new URL("../../", import.meta.url));
    const { version } = JSON.parse(
      readFileSync(join(root, "apps/mobile/package.json"), "utf8"),
    ) as { version: string };
    const record = join(mkdtempSync(join(tmpdir(), "wave-sealed-")), "sealed.json");
    writeFileSync(record, JSON.stringify(sealed({}, { releaseTag: `v${version}` })));
    const result = spawnSync(
      process.execPath,
      [join(root, "scripts/ci/release-source.ts"), "manifest", record],
      { cwd: root, encoding: "utf8", env: { ...process.env, GITHUB_REPOSITORY: REPO } },
    );
    assert.equal(result.status, 0, result.stderr);
    const manifest = JSON.parse(result.stdout) as SourceManifest;
    assert.equal(manifest.version, version);
    assert.ok(manifest.notices.some(({ subject }) => subject.startsWith("react@")));
    assert.ok(manifest.notices.some(({ subject }) => subject === "port:chfft-rfft"));
    assert.ok(manifest.buildInputs.includes("pnpm-lock.yaml"));
    assert.ok(manifest.buildInputs.includes("docs/release-source.md"));
    assert.deepEqual(
      manifest.thirdPartySource.map(({ subject }) => subject),
      [
        "com.github.MetrolistGroup.innertubex:innertubex:0.11.9",
        "com.github.MetrolistGroup.innertubex:innertubex:0.8.6",
        "com.github.MetrolistGroup.quackjs:quackjs:0.1.4",
        "net.jthink:jaudiotagger:3.0.1",
        "crate:symphonia-codec-alac",
        "crate:oxideav-aac",
      ],
    );
    assert.deepEqual(manifest.pending, []);
  });
});

describe("appVersionAt", () => {
  it("reads package.json's version, or app.config.ts's constant on the earliest tags", () => {
    assert.equal(appVersionAt('{"version":"0.68.0-ti"}', ""), "0.68.0-ti");
    assert.equal(appVersionAt('{"name":"@wave/mobile"}', 'const version = "0.5.0";\n'), "0.5.0");
    assert.equal(appVersionAt("{}", "no version here"), "");
  });
});
