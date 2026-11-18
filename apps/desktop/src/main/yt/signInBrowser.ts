/**
 * The browser YouTube's sign-in runs in (docs/spec-desktop.md, Sign-in): an installed
 * Chromium-family one, since the sign-in needs its `--user-data-dir` and DevTools protocol.
 * Windows always has Edge; a Linux desktop may have none.
 */
import { posix, win32 } from "node:path";

export interface BrowserSearch {
  readonly platform: NodeJS.Platform;
  readonly env: Readonly<Record<string, string | undefined>>;
  /** Whether [path] is a file that can be started. */
  readonly exists: (path: string) => boolean;
}

/** Each browser's place under an install root, Chrome first. */
const WINDOWS_BROWSERS = [
  ["Google", "Chrome", "Application", "chrome.exe"],
  ["Microsoft", "Edge", "Application", "msedge.exe"],
  ["BraveSoftware", "Brave-Browser", "Application", "brave.exe"],
  ["Chromium", "Application", "chrome.exe"],
] as const;

/** Where Windows installs them: for everyone (64 and 32 bit) or for one user. */
const WINDOWS_ROOTS = ["ProgramFiles", "ProgramFiles(x86)", "LOCALAPPDATA"] as const;

/** The commands Linux packages install them as. */
const LINUX_COMMANDS = [
  "google-chrome-stable",
  "google-chrome",
  "microsoft-edge-stable",
  "microsoft-edge",
  "brave-browser",
  "chromium",
  "chromium-browser",
] as const;

/** Where snaps put their commands; a snap is confined, so it is the last choice. */
export const SNAP_BIN = "/snap/bin";

/** The path of the browser to sign in with, or null when none is installed. */
export const findSignInBrowser = ({ platform, env, exists }: BrowserSearch): string | null => {
  if (platform === "win32") {
    for (const browser of WINDOWS_BROWSERS)
      for (const root of WINDOWS_ROOTS) {
        const folder = env[root];
        if (folder === undefined || folder === "") continue;
        const path = win32.join(folder, ...browser);
        if (exists(path)) return path;
      }
    return null;
  }
  if (platform !== "linux") return null;
  const folders = (env["PATH"] ?? "").split(":").filter((folder) => folder !== "");
  const ordered = [
    ...folders.filter((folder) => folder !== SNAP_BIN),
    ...folders.filter((folder) => folder === SNAP_BIN),
  ];
  for (const folder of ordered)
    for (const command of LINUX_COMMANDS) {
      const path = posix.join(folder, command);
      if (exists(path)) return path;
    }
  return null;
};
