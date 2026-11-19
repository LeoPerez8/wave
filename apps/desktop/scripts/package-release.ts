import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import builder from "electron-builder";
import { artifactName, desktopVersion } from "../../updates/src/desktopProtocol.ts";

import { desktopKeyDigest, recordDesktopBuild } from "../../updates/src/desktopEvidence.ts";
import { UPDATES_ORIGIN } from "../../updates/src/layout.ts";

const [tag, output] = process.argv.slice(2);
const version = tag?.replace(/^v/, "") ?? "";
const channel = version.endsWith("-ti") ? "ti" : "main";
const platform = process.platform;
if (
  !output ||
  !desktopVersion(version, channel) ||
  (platform !== "win32" && platform !== "linux")
) {
  throw new Error("usage: package-release.ts v<version> <output directory>, on Windows or Linux");
}
const mobile = JSON.parse(
  readFileSync(new URL("../../mobile/package.json", import.meta.url), "utf8"),
);
if (mobile.version !== `${version.replace(/-ti$/, "")}-ti` && mobile.version !== version) {
  throw new Error("Desktop and Android release versions differ");
}
if (process.env["WAVE_DESKTOP_CHANNEL"] !== channel)
  throw new Error("Desktop release channel differs from tag");

const windows = platform === "win32";
const { Arch, Platform, build } = builder;
await build({
  targets: (windows ? Platform.WINDOWS : Platform.LINUX).createTarget(
    windows ? "nsis" : "AppImage",
    Arch.x64,
  ),
  publish: "never",
  config: {
    appId: "app.wave.desktop",
    productName: "Wave",
    extraMetadata: { name: "wave-desktop", version },
    artifactName: artifactName(platform, version),
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
    // The private update key never enters packaging. #1165 can sign the Windows installer
    // between the verified build and final release evidence.
    forceCodeSigning: false,
    win: { signAndEditExecutable: false },
    nsis: { oneClick: true, perMachine: false },
    linux: { category: "AudioVideo" },
    publish: { provider: "generic", url: UPDATES_ORIGIN, channel },
  },
});

const source = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
await recordDesktopBuild(
  output,
  platform,
  source,
  tag!,
  desktopKeyDigest(process.env["WAVE_DESKTOP_UPDATE_PUBLIC_KEY"] ?? ""),
);
