// What a build's APK says about over-the-air updates (docs/spec.md, Build and CI). Prebuild
// writes placeholders from app.config.ts, so the generated project, and with it the kept APK's
// key (repack.ts), is the same on every channel. That key is the runtime version, which can't
// be known until the project exists, and a PR may repack a build kept on ti. So each run stamps
// its own channel and runtime version afterwards:
//   node scripts/ci/update-config.ts channel                `WAVE_UPDATE_CHANNEL=` for $GITHUB_ENV
//   node scripts/ci/update-config.ts stamp-source <AndroidManifest.xml>   before Gradle
//   node scripts/ci/update-config.ts stamp-apk <dir>                      in repack.sh
// <dir> holds the kept APK's AndroidManifest.xml (compiled) and assets/app.manifest.
// `channel` reads GITHUB_EVENT_NAME and GITHUB_REF; the stamps read WAVE_UPDATE_CHANNEL (empty
// is no channel) and WAVE_RUNTIME_VERSION.
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { withManifestMetaData } from "./apk-version.ts";

export type UpdateChannel = "ti" | "main";

/** The channel a run's APK follows. PR builds and any other branch have none: they never update. */
export const updateChannel = (run: { event: string; ref: string }): UpdateChannel | null => {
  if (run.event !== "push") return null;
  if (run.ref === "refs/heads/ti" || /^refs\/tags\/v\d+\.\d+\.\d+-ti$/.test(run.ref)) return "ti";
  if (run.ref === "refs/heads/main" || /^refs\/tags\/v\d+\.\d+\.\d+$/.test(run.ref)) return "main";
  return null;
};

/** The manifest's <meta-data> expo-updates reads for a channel and a runtime version. */
export const updateMetaData = (
  channel: UpdateChannel | null,
  runtimeVersion: string,
): Record<string, string | boolean> => ({
  "expo.modules.updates.ENABLED": channel !== null,
  "expo.modules.updates.EXPO_RUNTIME_VERSION": runtimeVersion,
  "expo.modules.updates.UPDATES_CONFIGURATION_REQUEST_HEADERS_KEY": JSON.stringify({
    "expo-channel-name": channel ?? "none",
  }),
});

const escapeXml = (text: string) =>
  text.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");

/** The generated AndroidManifest.xml with these <meta-data> values. */
export const stampManifestSource = (
  source: string,
  values: Record<string, string | boolean>,
): string =>
  Object.entries(values).reduce((current, [name, value]) => {
    const entry = new RegExp(
      `(android:name="${name.replaceAll(".", "\\.")}"\\s+android:value=")[^"]*"`,
    );
    if (!entry.test(current)) throw new Error(`The manifest has no <meta-data> called ${name}.`);
    return current.replace(entry, (_, start: string) => `${start}${escapeXml(String(value))}"`);
  }, source);

/**
 * The embedded update's manifest (assets/app.manifest) with a new identity. A repack swaps new
 * JS into the APK; under the kept build's id and time, expo-updates would take it for that old
 * build, and prefer any bundle published since over the newer JS it just installed.
 */
export const withEmbeddedUpdate = (
  manifest: string,
  update: { id: string; commitTime: number },
): string => JSON.stringify({ ...JSON.parse(manifest), ...update });

const envChannel = (): UpdateChannel | null => {
  const channel = process.env.WAVE_UPDATE_CHANNEL ?? "";
  if (channel === "") return null;
  if (channel === "ti" || channel === "main") return channel;
  throw new Error(`Unknown update channel: ${channel}`);
};

const envMetaData = () => {
  const runtimeVersion = process.env.WAVE_RUNTIME_VERSION;
  if (!runtimeVersion) throw new Error("WAVE_RUNTIME_VERSION isn't set.");
  return updateMetaData(envChannel(), runtimeVersion);
};

const cli = ([command, path = ""]: string[]) => {
  switch (command) {
    case "channel":
      console.log(
        `WAVE_UPDATE_CHANNEL=${
          updateChannel({
            event: process.env.GITHUB_EVENT_NAME ?? "",
            ref: process.env.GITHUB_REF ?? "",
          }) ?? ""
        }`,
      );
      return;
    case "stamp-source":
      writeFileSync(path, stampManifestSource(readFileSync(path, "utf8"), envMetaData()));
      return;
    case "stamp-apk": {
      const manifest = join(path, "AndroidManifest.xml");
      writeFileSync(manifest, withManifestMetaData(readFileSync(manifest), envMetaData()));
      const embedded = join(path, "assets/app.manifest");
      writeFileSync(
        embedded,
        withEmbeddedUpdate(readFileSync(embedded, "utf8"), {
          id: randomUUID(),
          commitTime: Date.now(),
        }),
      );
      return;
    }
    default:
      throw new Error(`Unknown command: ${command ?? "(none)"}`);
  }
};

if (process.argv[1] === fileURLToPath(import.meta.url)) cli(process.argv.slice(2));
