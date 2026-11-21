/** What Wave's window may load and where it may go. */
import type { WebContents } from "electron";

/** The window's Content-Security-Policy. Dev adds what Vite's hot reload needs, never eval. */
export const contentSecurityPolicy = (dev: boolean): string =>
  [
    "default-src 'none'",
    dev ? "script-src 'self' 'unsafe-inline'" : "script-src 'self'",
    dev ? "style-src 'self' 'unsafe-inline'" : "style-src 'self'",
    "img-src 'self' data: blob:",
    "media-src blob:",
    "font-src 'self'",
    dev ? "connect-src 'self' ws://localhost:*" : "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join("; ");

/** What every Wave window's page runs with: the main window and the mini player alike. */
export const windowWebPreferences = (preload: string) =>
  ({
    preload,
    contextIsolation: true,
    sandbox: true,
    nodeIntegration: false,
    webviewTag: false,
    autoplayPolicy: "no-user-gesture-required",
  }) as const;

/** The http(s) URL to hand the system browser, or nothing for any other link. */
const webLink = (url: string): string | undefined => {
  try {
    const { protocol } = new URL(url);
    return protocol === "https:" || protocol === "http:" ? url : undefined;
  } catch {
    return undefined;
  }
};

/** The part of Electron's WebContents the guard uses. */
export type GuardedContents = Pick<WebContents, "on" | "setWindowOpenHandler">;

/** Keeps the window on Wave: no navigation, no new windows, no webviews; web links go to the browser. */
export const guardWindow = (
  contents: GuardedContents,
  openExternal: (url: string) => void,
): void => {
  const toBrowser = (url: string) => {
    const link = webLink(url);
    if (link !== undefined) openExternal(link);
  };
  contents.on("will-navigate", (event, url) => {
    event.preventDefault();
    toBrowser(url);
  });
  contents.on("will-redirect", (event) => event.preventDefault());
  contents.on("will-attach-webview", (event) => event.preventDefault());
  contents.setWindowOpenHandler(({ url }) => {
    toBrowser(url);
    return { action: "deny" };
  });
};
