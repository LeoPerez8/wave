import type { ProviderRuntimeOptions } from "electron-updater/out/providers/Provider.js";
import { app } from "electron";
import updaterModule, { type ResolvedUpdateFileInfo, type UpdateInfo } from "electron-updater";
import { spawn } from "node:child_process";
import { createPublicKey } from "node:crypto";
import {
  chmod,
  copyFile,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import {
  artifactName,
  desktopFileKey,
  type DesktopChannel,
  type DesktopManifest,
} from "../../../../updates/src/desktopProtocol.ts";
import { UPDATES_ORIGIN } from "../../../../updates/src/layout.ts";
import { authorizeUpdate, verifyInstaller } from "./policy.ts";

declare const WAVE_DESKTOP_BUILD: {
  readonly channel: DesktopChannel;
  readonly publicKey: string;
  readonly builtAt: number;
} | null;

export const desktopBuild = WAVE_DESKTOP_BUILD;

const CHECK_INTERVAL = 60 * 60_000;
const { AppImageUpdater, NsisUpdater, Provider } = updaterModule;

export const startDesktopUpdates = () => {
  const build = desktopBuild;
  const platform = process.platform;
  if (!app.isPackaged || !build || (platform !== "linux" && platform !== "win32")) return;
  const appImage = process.env["APPIMAGE"];
  if (platform === "linux" && (!appImage || !isAbsolute(appImage))) return;

  const targetPlatform: "win32" | "linux" = platform;
  const { channel, builtAt } = build;
  const publicKey = createPublicKey(build.publicKey);
  const version = app.getVersion();
  const serialFile = join(app.getPath("userData"), `updates-${build.channel}-serial`);
  const fileUrl = (target: string, name: string, digest?: string) =>
    new URL(`/v1/${desktopFileKey(channel, target, name, digest)}`, UPDATES_ORIGIN);
  let admitted: DesktopManifest | null = null;
  let ready: { file: string; manifest: DesktopManifest } | undefined;
  let checking = false;
  let closing = false;
  let timer: ReturnType<typeof setTimeout>;

  class WaveProvider extends Provider<UpdateInfo> {
    constructor(_options: unknown, _updater: unknown, runtime: ProviderRuntimeOptions) {
      super({ ...runtime, isUseMultipleRangeRequest: false });
    }

    override async getLatestVersion(): Promise<UpdateInfo> {
      const current = { version, files: [], path: "", sha512: "", releaseDate: "" };
      const response = await fetch(`${UPDATES_ORIGIN}/v1/desktop/${channel}/latest.json`, {
        redirect: "error",
        signal: AbortSignal.timeout(15_000),
      });
      if (response.status === 404) return current;
      if (!response.ok) throw new Error(`Desktop update check failed (${response.status})`);
      const answer = (await response.json()) as Record<string, unknown>;
      const accepted = Number(
        await readFile(serialFile, "utf8").catch((error: NodeJS.ErrnoException) => {
          if (error.code !== "ENOENT") throw error;
          return "0";
        }),
      );
      if (!Number.isSafeInteger(accepted) || accepted < 0)
        throw new Error("Invalid desktop update serial");
      admitted = authorizeUpdate(
        answer[targetPlatform],
        publicKey,
        channel,
        targetPlatform,
        version,
        builtAt,
        accepted,
      );
      if (!admitted) return current;
      const path = artifactName(targetPlatform, admitted.version);
      return {
        version: admitted.version,
        path,
        releaseDate: new Date(admitted.serial).toISOString(),
        sha512: admitted.sha512,
        files: [{ url: path, sha512: admitted.sha512, size: admitted.size }],
      };
    }

    override resolveFiles(info: UpdateInfo): ResolvedUpdateFileInfo[] {
      return info.files.map((file) => ({
        url: fileUrl(info.version, file.url, Buffer.from(file.sha512, "base64").toString("hex")),
        info: file,
      }));
    }

    override getBlockMapFiles(_url: URL, previous: string, next: string): URL[] {
      return [previous, next].map((target) =>
        fileUrl(target, `${artifactName("win32", target)}.blockmap`),
      );
    }
  }

  const Updater = platform === "win32" ? NsisUpdater : AppImageUpdater;
  const updater = new Updater({ provider: "custom", updateProvider: WaveProvider });
  updater.autoDownload = false;
  updater.autoInstallOnAppQuit = false;
  updater.autoRunAppAfterInstall = false;
  updater.disableWebInstaller = true;
  updater.disableDifferentialDownload = platform === "linux";
  // Only signed, fresh rollback manifests ever reach electron-updater as older versions.
  updater.allowDowngrade = true;

  const report = (error: unknown) => console.error("[desktop update]", error);
  const check = async () => {
    if (checking || ready || closing) return;
    checking = true;
    try {
      admitted = null;
      const result = await updater.checkForUpdates();
      const manifest = admitted as DesktopManifest | null;
      if (!result?.isUpdateAvailable || !manifest || closing) return;
      const [file] = await updater.downloadUpdate();
      if (!file || closing) return;
      await verifyInstaller(file, manifest);
      // Persist before handing the installer to the OS. Equal serials can retry a failed install.
      await writeFile(`${serialFile}.tmp`, String(manifest.serial), { mode: 0o600 });
      await rename(`${serialFile}.tmp`, serialFile);
      ready = { file, manifest };
    } catch (error) {
      report(error);
    } finally {
      checking = false;
      if (!closing && !ready) timer = setTimeout(() => void check(), CHECK_INTERVAL);
    }
  };
  timer = setTimeout(() => void check(), 30_000);

  return async () => {
    closing = true;
    clearTimeout(timer);
    if (!ready) return;
    try {
      if (platform === "win32") {
        await verifyInstaller(ready.file, ready.manifest);
        await new Promise<void>((resolve, reject) => {
          const installer = spawn(ready!.file, ["/S", "--updated"], {
            detached: true,
            stdio: "ignore",
          });
          installer.once("error", reject);
          installer.once("spawn", () => {
            installer.unref();
            resolve();
          });
        });
      } else {
        // Copy on the destination filesystem, then atomically replace the running AppImage.
        // A failed write, verification or rename leaves the installed image intact.
        const destination = await realpath(appImage!);
        const staging = await mkdtemp(join(dirname(destination), ".wave-update-"));
        try {
          const file = join(staging, "Wave.AppImage");
          await copyFile(ready.file, file);
          await verifyInstaller(file, ready.manifest);
          await chmod(file, 0o755);
          await rename(file, destination);
        } finally {
          await rm(staging, { recursive: true, force: true });
        }
      }
    } catch (error) {
      report(error);
    }
  };
};
