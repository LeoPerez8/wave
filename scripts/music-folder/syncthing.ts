/**
 * Whether Syncthing has the music folder in sync, through its REST API
 * (https://docs.syncthing.net/dev/rest.html). The API key and the GUI address
 * come from Syncthing's own config.xml.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

/** One Syncthing folder at the music folder's path, as the check sees it. */
export interface FolderSync {
  readonly label: string;
  readonly paused: boolean;
  /** "idle" when nothing is being scanned or pulled. */
  readonly state: string;
  /** Items this PC still has to pull. */
  readonly needItems: number;
  /** Items that failed to sync here. */
  readonly errors: number;
  readonly devices: readonly DeviceSync[];
}

/** A device the folder is shared with, and how much of it that device has. */
export interface DeviceSync {
  readonly name: string;
  readonly connected: boolean;
  /** Percent of the folder the device has, as Syncthing last knew it. */
  readonly completion: number;
  readonly needItems: number;
}

/**
 * What keeps [folders] from being in sync, one line each; empty when every
 * folder is idle, needs nothing and every device (but [ignoredDevices], by
 * name, any case) has all of it.
 */
export const syncProblems = (
  folders: readonly FolderSync[],
  ignoredDevices: readonly string[],
): string[] => {
  const ignored = new Set(ignoredDevices.map((name) => name.toLowerCase()));
  return folders.flatMap((folder) => {
    const problems: string[] = [];
    if (folder.paused) problems.push("the folder is paused");
    else if (folder.state !== "idle") problems.push(`state is ${folder.state}, not idle`);
    if (folder.needItems > 0) problems.push(`this PC still needs ${folder.needItems} items`);
    if (folder.errors > 0) problems.push(`${folder.errors} item errors`);
    for (const device of folder.devices) {
      if (ignored.has(device.name.toLowerCase())) continue;
      if (device.completion < 100 || device.needItems > 0) {
        problems.push(
          `${device.name} is at ${device.completion}% (needs ${device.needItems} items)`,
        );
      }
    }
    return problems.map((problem) => `${folder.label}: ${problem}`);
  });
};

/** What the check found: Syncthing unreachable, or the folders and their problems. */
export type SyncCheck =
  | { readonly reachable: false; readonly reason: string }
  | {
      readonly reachable: true;
      readonly folders: readonly FolderSync[];
      readonly problems: readonly string[];
    };

const defaultConfig = (): string =>
  join(
    process.env.LOCALAPPDATA ?? join(process.env.HOME ?? "", "AppData", "Local"),
    "Syncthing",
    "config.xml",
  );

const tidyPath = (path: string): string =>
  path.replaceAll("\\", "/").replace(/\/+$/, "").normalize("NFC").toLowerCase();

const samePath = (a: string, b: string): boolean => tidyPath(a) === tidyPath(b);

interface ConfigFolder {
  id: string;
  label: string;
  path: string;
  paused: boolean;
  devices: { deviceID: string }[];
}

/** Asks the running Syncthing about every folder it syncs at [musicFolder]. */
export const checkSyncthing = async (
  musicFolder: string,
  ignoredDevices: readonly string[],
  configPath = defaultConfig(),
): Promise<SyncCheck> => {
  let xml: string;
  try {
    xml = readFileSync(configPath, "utf8");
  } catch {
    return { reachable: false, reason: `no Syncthing config at ${configPath}` };
  }
  const apiKey = /<apikey>([^<]+)<\/apikey>/.exec(xml)?.[1];
  const gui = /<gui\b([^>]*)>([\s\S]*?)<\/gui>/.exec(xml);
  const address = /<address>([^<]+)<\/address>/.exec(gui?.[2] ?? "")?.[1];
  if (apiKey === undefined || address === undefined) {
    return { reachable: false, reason: `no API key or GUI address in ${configPath}` };
  }
  const scheme = /\btls="true"/.test(gui?.[1] ?? "") ? "https" : "http";
  const base = `${scheme}://${address.replace(/^0\.0\.0\.0/, "127.0.0.1")}`;
  const get = async <T>(path: string): Promise<T> => {
    const response = await fetch(`${base}${path}`, {
      headers: { "X-API-Key": apiKey },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
    return (await response.json()) as T;
  };
  try {
    const { myID } = await get<{ myID: string }>("/rest/system/status");
    const configured = await get<ConfigFolder[]>("/rest/config/folders");
    const deviceNames = new Map(
      (await get<{ deviceID: string; name: string }[]>("/rest/config/devices")).map((d) => [
        d.deviceID,
        d.name,
      ]),
    );
    const { connections } = await get<{ connections: Record<string, { connected: boolean }> }>(
      "/rest/system/connections",
    );
    const folders: FolderSync[] = [];
    for (const folder of configured.filter((one) => samePath(one.path, musicFolder))) {
      const id = encodeURIComponent(folder.id);
      const status = await get<{
        state: string;
        needTotalItems: number;
        errors: number;
        pullErrors?: number;
      }>(`/rest/db/status?folder=${id}`);
      const devices: DeviceSync[] = [];
      for (const { deviceID } of folder.devices.filter((device) => device.deviceID !== myID)) {
        const completion = await get<{
          completion: number;
          needItems: number;
          needDeletes: number;
        }>(`/rest/db/completion?folder=${id}&device=${encodeURIComponent(deviceID)}`);
        devices.push({
          name: deviceNames.get(deviceID) ?? deviceID.slice(0, 7),
          connected: connections[deviceID]?.connected ?? false,
          completion: Math.floor(completion.completion * 10) / 10,
          needItems: completion.needItems + completion.needDeletes,
        });
      }
      folders.push({
        label: folder.label || folder.id,
        paused: folder.paused,
        state: status.state,
        needItems: status.needTotalItems,
        errors: Math.max(status.errors, status.pullErrors ?? 0),
        devices,
      });
    }
    if (folders.length === 0) {
      return { reachable: true, folders, problems: [`Syncthing has no folder at ${musicFolder}`] };
    }
    return { reachable: true, folders, problems: syncProblems(folders, ignoredDevices) };
  } catch (error) {
    return {
      reachable: false,
      reason: `Syncthing's API at ${base} didn't answer (${String(error)})`,
    };
  }
};
