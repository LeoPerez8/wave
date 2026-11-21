import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import builder from "electron-builder";
import { artifactName, desktopVersion } from "../../updates/src/desktopProtocol.ts";

import {
  desktopKeyDigest,
  recordDesktopBuild,
  windowsSigningInput,
} from "../../updates/src/desktopEvidence.ts";
import { UPDATES_ORIGIN } from "../../updates/src/layout.ts";
import { verifyAuthenticodePayload } from "./authenticode-payload.ts";
import { LINUX_MIME_TYPES, windowsOpenWithScript } from "./file-types.ts";

const [tag, output, mode, input] = process.argv.slice(2);
const version = tag?.replace(/^v/, "") ?? "";
const channel = version.endsWith("-ti") ? "ti" : "main";
const platform = process.platform;
if (
  !output ||
  !tag?.startsWith("v") ||
  !desktopVersion(version, channel) ||
  (platform !== "win32" && platform !== "linux") ||
  (mode !== undefined &&
    (platform !== "win32" ||
      !["prepare", "installer", "finalize"].includes(mode) ||
      (mode !== "prepare" && !input)))
) {
  throw new Error(
    "usage: package-release.ts v<version> <output directory> [prepare|installer|finalize] [SignPath return directory]",
  );
}
const mobile = JSON.parse(
  readFileSync(new URL("../../mobile/package.json", import.meta.url), "utf8"),
);
if (mobile.version !== `${version.replace(/-ti$/, "")}-ti` && mobile.version !== version) {
  throw new Error("Desktop and Android release versions differ");
}
if (process.env["WAVE_DESKTOP_CHANNEL"] !== channel)
  throw new Error("Desktop release channel differs from tag");
// A build without the sync service and Google's Desktop client has no Sign In (#1158), so a
// release refuses it rather than ship an installer with no Wave account. The SignPath steps reuse
// the app the first step built.
if (mode === undefined || mode === "prepare") {
  const sync = process.env["MAIN_VITE_WAVE_SYNC_URL"]?.trim() ?? "";
  if (
    !sync.startsWith("https://") ||
    !process.env["MAIN_VITE_WAVE_GOOGLE_DESKTOP_CLIENT_ID"]?.trim()
  )
    throw new Error(
      "Desktop release has no Wave account: set the WAVE_SYNC_URL and WAVE_GOOGLE_DESKTOP_CLIENT_ID repository variables",
    );
}

const windows = platform === "win32";
const prepare = mode === "prepare";
const installer = artifactName(platform, version);
const unpacked = join(output, "win-unpacked");
const source = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const key = desktopKeyDigest(process.env["WAVE_DESKTOP_UPDATE_PUBLIC_KEY"] ?? "");
const require = createRequire(import.meta.url);
const builderRequire = createRequire(require.resolve("electron-builder/package.json"));

function acceptSignedFile(directory: string, name: string, destination: string) {
  const path = resolve(directory, name);
  const files = readdirSync(directory);
  if (files.length !== 1 || files[0] !== name || !lstatSync(path).isFile())
    throw new Error(`Expected SignPath to return exactly ${name}`);
  verifyAuthenticodePayload(readFileSync(destination), readFileSync(path));
  execFileSync(
    "pwsh",
    [
      "-NoProfile",
      "-NonInteractive",
      "-File",
      fileURLToPath(new URL("./verify-authenticode.ps1", import.meta.url)),
      path,
    ],
    { stdio: "inherit" },
  );
  copyFileSync(path, destination);
}

if (mode === "finalize") {
  const finalInstaller = join(output, installer);
  acceptSignedFile(input!, installer, finalInstaller);
  // Use the pinned builder's NSIS blockmap implementation on the signed bytes.
  const { buildBlockMap } = builderRequire("app-builder-lib/out/targets/blockmap/blockmap.js");
  await buildBlockMap(finalInstaller, "gzip", `${finalInstaller}.blockmap`);
  await recordDesktopBuild(output, platform, source, tag, key);
  process.exit(0);
}

if (mode === "installer") acceptSignedFile(input!, "Wave.exe", join(unpacked, "Wave.exe"));

// The installer's "Open with" registration, kept out of the output folder the release uploads.
const openWith = join(mkdtempSync(join(tmpdir(), "wave-installer-")), "open-with.nsh");
writeFileSync(openWith, windowsOpenWithScript());

const { Arch, Platform, build } = builder;
await build({
  targets: (windows ? Platform.WINDOWS : Platform.LINUX).createTarget(
    windows ? (prepare ? "dir" : "nsis") : "AppImage",
    Arch.x64,
  ),
  publish: "never",
  ...(mode === "installer" ? { prepackaged: resolve(unpacked) } : {}),
  config: {
    appId: "app.wave.desktop",
    productName: "Wave",
    extraMetadata: { name: "wave-desktop", version },
    artifactName: installer,
    directories: { output: resolve(output) },
    files: ["out/**/*"],
    // better-sqlite3 ships platform-specific N-API prebuilds that work in Electron.
    npmRebuild: false,
    extraResources: [
      { from: "../../LICENSE", to: "LICENSE" },
      { from: "../../NOTICE.md", to: "NOTICE.md" },
      {
        from: "native",
        to: "native",
        filter: windows ? ["wave-audio.node"] : ["wave-audio.node", "wave-media.node"],
      },
      { from: "jvm", to: "jvm", filter: ["wave-kotlin.jar", "runtime/**/*"] },
    ],
    forceCodeSigning: false,
    win: { signAndEditExecutable: prepare, signExecutable: false },
    nsis: {
      oneClick: true,
      perMachine: false,
      // Keep differential-friendly compression. Finalization replaces the unsigned blockmap.
      differentialPackage: true,
      include: openWith,
    },
    linux: { category: "AudioVideo", mimeTypes: LINUX_MIME_TYPES },
    publish: { provider: "generic", url: UPDATES_ORIGIN, channel },
  },
});

if (prepare) {
  // NSIS uses the release version including its channel suffix in the ProductVersion string.
  // Keep the executable's numeric version fields and match that string before signing.
  const appBuilderRequire = createRequire(builderRequire.resolve("app-builder-lib/package.json"));
  const { NtExecutable, NtExecutableResource, Resource } = appBuilderRequire("resedit");
  const executablePath = join(unpacked, "Wave.exe");
  const executable = NtExecutable.from(readFileSync(executablePath));
  const resources = NtExecutableResource.from(executable);
  const [versionInfo] = Resource.VersionInfo.fromEntries(resources.entries);
  for (const language of versionInfo.getAllLanguagesForStringValues()) {
    versionInfo.setStringValues(language, { ProductVersion: version });
  }
  versionInfo.outputToResourceEntries(resources.entries);
  resources.outputResource(executable);
  writeFileSync(executablePath, Buffer.from(executable.generate()));

  const tar = join(process.env["SystemRoot"] ?? "C:/Windows", "System32", "tar.exe");
  execFileSync(tar, [
    "-cf",
    resolve(output, windowsSigningInput),
    "-C",
    resolve(output),
    "win-unpacked",
  ]);
}
if (mode !== "installer") await recordDesktopBuild(output, platform, source, tag, key, prepare);
