export type DesktopChannel = "ti" | "main";
export type DesktopPlatform = "win32" | "linux";

export interface DesktopManifest {
  readonly channel: DesktopChannel;
  readonly platform: DesktopPlatform;
  readonly version: string;
  readonly serial: number;
  readonly rollback: boolean;
  readonly sha512: string;
  readonly size: number;
}

export interface SignedDesktopUpdate {
  readonly payload: string;
  readonly signature: string;
}

export const desktopPlatforms = ["win32", "linux"] as const;
export const desktopVersion = (version: string, channel: DesktopChannel): boolean =>
  /^(0|[1-9]\d{0,4})\.(0|[1-9]\d{0,4})\.(0|[1-9]\d{0,4})(-ti)?$/.test(version) &&
  version.endsWith("-ti") === (channel === "ti");
export const artifactName = (platform: DesktopPlatform, version: string): string =>
  platform === "win32" ? `wave-${version}-win-x64.exe` : `wave-${version}-linux-x64.AppImage`;

export const desktopLatestKey = (channel: DesktopChannel): string =>
  `desktop/${channel}/latest.json`;
export const desktopHistoryKey = (channel: DesktopChannel): string =>
  `desktop/${channel}/history.json`;
export const desktopFileKey = (
  channel: DesktopChannel,
  version: string,
  file: string,
  digest?: string,
): string => `desktop/${channel}/files/${version}/${digest ? `${digest}/` : ""}${file}`;
export const desktopPublishedKey = (channel: DesktopChannel, version: string): string =>
  `desktop/${channel}/versions/${version}.json`;

export const compareDesktopVersions = (left: string, right: string): number => {
  const a = left.split("-")[0]!.split(".").map(Number);
  const b = right.split("-")[0]!.split(".").map(Number);
  return a[0]! - b[0]! || a[1]! - b[1]! || a[2]! - b[2]!;
};
