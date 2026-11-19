import { app } from "electron";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { keptVersionHistory, readKeptVersionHistory, readVersionHistory } from "@wave/core";
import type { DesktopVersionHistory } from "../../shared/bridge.ts";
import { UPDATES_ORIGIN } from "../../../../updates/src/layout.ts";
import { desktopBuild } from "./updater.ts";

export const loadVersionHistory = async (): Promise<DesktopVersionHistory> => {
  const version = app.getVersion();
  const channel = desktopBuild?.channel ?? null;
  if (!channel) return { version, channel, releases: [] };
  const cache = join(app.getPath("userData"), `desktop-versions-${channel}.json`);
  try {
    const response = await fetch(`${UPDATES_ORIGIN}/v1/desktop/${channel}/history.json`, {
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error("Version history unavailable");
    const releases = readVersionHistory(await response.json());
    if (releases === null) throw new Error("Version history is invalid");
    await writeFile(cache, keptVersionHistory(releases)).catch(() => {});
    return { version, channel, releases };
  } catch {
    return {
      version,
      channel,
      releases: readKeptVersionHistory(await readFile(cache, "utf8").catch(() => null)),
    };
  }
};
