import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  distributedPackages,
  gradleCoordinates,
  installedLicences,
  licenceVerdict,
  requiredNotices,
  rightsReport,
} from "./rights-inventory.ts";

const lockfile = `lockfileVersion: '9.0'

importers:

  .:
    devDependencies:
      prettier:
        specifier: 3.9.10
        version: 3.9.10

  apps/mobile:
    dependencies:
      '@scope/ui':
        specifier: ^1.0.0
        version: 1.2.0(react@19.3.0)
      '@wave/core':
        specifier: workspace:*
        version: link:../../packages/core
    devDependencies:
      typescript:
        specifier: 7.0.2
        version: 7.0.2

  packages/core:
    dependencies:
      tiny:
        specifier: 2.0.0
        version: 2.0.0

packages:

  '@scope/ui@1.2.0':
    resolution: {integrity: sha512-x}

snapshots:

  '@scope/ui@1.2.0(react@19.3.0)':
    dependencies:
      react: 19.3.0
    optionalDependencies:
      fsevents: 2.3.3

  fsevents@2.3.3: {}

  prettier@3.9.10: {}

  react@19.3.0:
    dependencies:
      loose: 1.0.0

  loose@1.0.0: {}

  tiny@2.0.0: {}

  typescript@7.0.2: {}
`;

describe("distributedPackages", () => {
  it("lists the exact versions an importer ships, through workspace links and peers, without its dev tools", () => {
    assert.deepEqual(distributedPackages(lockfile, "apps/mobile"), [
      { name: "@scope/ui", version: "1.2.0" },
      { name: "fsevents", version: "2.3.3" },
      { name: "loose", version: "1.0.0" },
      { name: "react", version: "19.3.0" },
      { name: "tiny", version: "2.0.0" },
    ]);
  });
});

describe("licenceVerdict", () => {
  // Expected verdicts follow the FSF's licence list (https://www.gnu.org/licenses/license-list.html).
  it("accepts licences the FSF lists as compatible with GPLv3, alone or as one choice of several", () => {
    for (const expression of [
      "MIT",
      "ISC",
      "BSD-3-Clause",
      "Apache-2.0",
      "0BSD",
      "LGPL-2.1-only",
      "GPL-3.0-or-later",
      "(MIT OR GPL-2.0-only)",
      "MIT AND Zlib",
    ])
      assert.equal(licenceVerdict(expression), "compatible", expression);
  });

  it("leaves pending what isn't known to combine with GPL-3.0-only", () => {
    for (const expression of [
      undefined,
      "",
      "UNLICENSED",
      "SEE LICENSE IN LICENSE.md",
      "GPL-2.0-only",
      "Apache-2.0 AND GPL-2.0-only",
      "CC-BY-NC-4.0",
      "CC-BY-3.0",
      // Compatible only without an "Incompatible With Secondary Licenses" notice, checked per file.
      "MPL-2.0",
    ])
      assert.equal(licenceVerdict(expression), "pending", String(expression));
  });
});

describe("rightsReport", () => {
  it("blocks readiness on a shipped package whose licence is pending, unless a review of that exact version resolves it", () => {
    const report = rightsReport({
      packages: [
        { name: "plain", version: "1.0.0", licence: "MIT" },
        { name: "unknown", version: "2.0.0", licence: undefined },
        { name: "mozilla", version: "3.0.0", licence: "MPL-2.0" },
        { name: "mozilla-old", version: "0.9.0", licence: "MPL-2.0" },
      ],
      reviews: [
        { package: "mozilla@3.0.0", status: "compatible", evidence: "no Exhibit B notice" },
        { package: "mozilla-old@1.0.0", status: "compatible", evidence: "another version" },
      ],
      components: [],
      gradle: [],
    });
    assert.equal(report.ready, false);
    assert.deepEqual(
      report.blockers.map((blocker) => blocker.subject),
      ["mozilla-old@0.9.0", "unknown@2.0.0"],
    );
  });

  it("blocks readiness on each hand-kept component that isn't compatible and each Gradle library it doesn't cover", () => {
    const report = rightsReport({
      packages: [],
      reviews: [],
      components: [
        { id: "ported-ok", kind: "ported-code", status: "compatible" },
        { id: "font", kind: "asset", status: "action-required" },
        { id: "sdk", kind: "native-library", status: "incompatible", coordinates: ["g:sdk:1.0"] },
        { id: "lib", kind: "native-library", status: "compatible", coordinates: ["g:lib:2.0"] },
      ],
      gradle: ["g:lib:2.0", "g:sdk:1.0", "g:lib:2.1", "g:new:1.0"],
    });
    assert.equal(report.ready, false);
    assert.deepEqual(
      report.blockers.map((blocker) => blocker.subject),
      ["font", "g:lib:2.1", "g:new:1.0", "sdk"],
    );
  });

  it("is ready when every shipped package, component and Gradle library is compatible", () => {
    const report = rightsReport({
      packages: [{ name: "plain", version: "1.0.0", licence: "MIT" }],
      reviews: [],
      components: [
        { id: "lib", kind: "native-library", status: "compatible", coordinates: ["g:lib:2.0"] },
      ],
      gradle: ["g:lib:2.0"],
    });
    assert.deepEqual(report, { ready: true, blockers: [] });
  });
});

describe("requiredNotices", () => {
  it("lists each shipped package's licence and notice files once, then each hand-kept component's notice, unknown files kept unknown", () => {
    const notices = requiredNotices(
      [
        { name: "b", version: "1.0.0", licence: "MIT", notices: ["LICENSE"] },
        { name: "a", version: "2.0.0", licence: "ISC", notices: null },
        { name: "b", version: "1.0.0", licence: "MIT", notices: ["LICENSE"] },
      ],
      [
        {
          id: "ported",
          kind: "ported-code",
          status: "action-required",
          licence: "MPL-2.0",
          notice: "keep the MPL header",
        },
        { id: "owned", kind: "first-party", status: "compatible" },
      ],
    );
    assert.deepEqual(notices, [
      { subject: "a@2.0.0", licence: "ISC", notices: null },
      { subject: "b@1.0.0", licence: "MIT", notices: ["LICENSE"] },
      { subject: "ported", licence: "MPL-2.0", notices: ["keep the MPL header"] },
    ]);
  });
});

describe("gradleCoordinates", () => {
  it("lists what a module ships, including platforms and unversioned libraries, but not test libraries or comments", () => {
    const gradle = [
      "dependencies {",
      "  // implementation 'old:commented:1.0'",
      "  implementation 'net.jthink:jaudiotagger:3.0.1'",
      '  implementation "androidx.core:core:1.16.0"',
      "  implementation platform('com.squareup.okhttp3:okhttp-bom:5.5.0')",
      "  api 'g:exposed:2.0'",
      "  implementation 'com.facebook.react:react-android'",
      "  testImplementation 'junit:junit:4.13.2'",
      "}",
    ].join("\n");
    assert.deepEqual(gradleCoordinates(gradle), [
      "androidx.core:core:1.16.0",
      "com.facebook.react:react-android",
      "com.squareup.okhttp3:okhttp-bom:5.5.0",
      "g:exposed:2.0",
      "net.jthink:jaudiotagger:3.0.1",
    ]);
  });
});

describe("installedLicences", () => {
  it("reads each installed version's declared licence, old-style fields included, and its notice files", () => {
    const root = mkdtempSync(join(tmpdir(), "rights-"));
    const install = (dir: string, name: string, manifest: object, files: string[] = []): void => {
      const at = join(root, ".pnpm", dir, "node_modules", ...name.split("/"));
      mkdirSync(at, { recursive: true });
      writeFileSync(join(at, "package.json"), JSON.stringify({ name, ...manifest }));
      for (const file of files) writeFileSync(join(at, file), "text");
    };
    install("@scope+ui@1.2.0_abc123", "@scope/ui", { version: "1.2.0", license: "MIT" }, [
      "LICENSE",
      "index.js",
    ]);
    install("legacy@0.1.0", "legacy", { version: "0.1.0", licenses: [{ type: "BSD-2-Clause" }] }, [
      "NOTICE.txt",
      "COPYING",
    ]);
    install("objecty@2.0.0", "objecty", { version: "2.0.0", license: { type: "ISC" } }, [
      "LICENSE_FONT",
      "licensed-things.js",
    ]);
    install("bare@3.0.0", "bare", { version: "3.0.0" });
    // pnpm shortens long store names with a hash; the package's linked dependencies sit beside it.
    install("@react-native+virtualized-l_bf1cc5a5", "@react-native/virtualized-lists", {
      version: "0.88.0",
      license: "MIT",
    });
    symlinkSync(
      join(root, ".pnpm", "bare@3.0.0", "node_modules", "bare"),
      join(root, ".pnpm", "@react-native+virtualized-l_bf1cc5a5", "node_modules", "bare"),
      "junction",
    );
    try {
      assert.deepEqual(installedLicences(root), {
        "@react-native/virtualized-lists@0.88.0": { licence: "MIT", notices: [] },
        "@scope/ui@1.2.0": { licence: "MIT", notices: ["LICENSE"] },
        "bare@3.0.0": { licence: undefined, notices: [] },
        "legacy@0.1.0": { licence: "BSD-2-Clause", notices: ["COPYING", "NOTICE.txt"] },
        "objecty@2.0.0": { licence: "ISC", notices: ["LICENSE_FONT"] },
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
