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
  readonly isChromiumSnapWrapper?: (path: string) => boolean;
  /**
   * The user's default browser as a Linux package command (from `defaultBrowserCommand`), tried
   * before the rest when it is a Chromium-family one, so the sign-in opens where the user is
   * already signed in to Google. Ignored on other platforms and when it names no known browser.
   */
  readonly preferred?: string;
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

/** Linux package commands in browser preference order. */
const LINUX_BROWSERS = [
  ["google-chrome-stable", "google-chrome"],
  ["microsoft-edge-stable", "microsoft-edge"],
  ["brave-browser", "brave"],
  ["chromium", "chromium-browser"],
] as const;

/** A default-browser `.desktop` name (as `xdg-settings get default-web-browser` gives it) to its
 * {@link LINUX_BROWSERS} command, or undefined when it is not a Chromium-family browser Wave signs
 * in with. Both the plain packages and their Snap ids (`brave_brave`, `chromium_chromium`) map. */
export const defaultBrowserCommand = (desktopEntry: string | undefined): string | undefined => {
  switch (desktopEntry?.trim()) {
    case "google-chrome.desktop":
      return "google-chrome";
    case "microsoft-edge.desktop":
      return "microsoft-edge";
    case "brave-browser.desktop":
    case "brave_brave.desktop":
      return "brave-browser";
    case "chromium.desktop":
    case "chromium_chromium.desktop":
      return "chromium";
    default:
      return undefined;
  }
};

const SNAP_BINS = ["/snap/bin", "/var/lib/snapd/snap/bin"];

const signInSnap = (browser: string): string | undefined =>
  SNAP_BINS.includes(posix.dirname(browser)) ? posix.basename(browser).split(".")[0] : undefined;

/** A Snap browser needs a visible, writable profile, even on its first launch. */
export const signInProfileRoot = (browser: string, home: string, userData: string): string => {
  const snap = signInSnap(browser);
  return snap ? posix.join(home, "snap", snap, "common") : userData;
};

/** The path of the browser to sign in with, or null when none is installed. */
export const findSignInBrowser = ({
  platform,
  env,
  exists,
  isChromiumSnapWrapper,
  preferred,
}: BrowserSearch): string | null => {
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
  const folders = (env["PATH"] ?? "").split(":").filter(posix.isAbsolute);
  // The default browser's family goes first when it is one Wave knows; the rest keep their order.
  const preferredFamily =
    preferred === undefined
      ? undefined
      : LINUX_BROWSERS.find((commands) => (commands as readonly string[]).includes(preferred));
  const families = preferredFamily
    ? [preferredFamily, ...LINUX_BROWSERS.filter((commands) => commands !== preferredFamily)]
    : LINUX_BROWSERS;
  for (const commands of families) {
    let snap: string | undefined;
    for (const folder of folders) {
      for (const command of commands) {
        const path = posix.join(folder, command);
        if (!exists(path)) continue;
        if (signInSnap(path)) {
          snap ??= path;
        } else if (command.startsWith("chromium") && isChromiumSnapWrapper?.(path)) {
          // Ubuntu's transitional package is a launcher for this Snap, not a browser itself.
          snap ??= SNAP_BINS.map((bin) => posix.join(bin, "chromium")).find(exists);
        } else {
          return path;
        }
      }
    }
    if (snap) return snap;
  }
  return null;
};
