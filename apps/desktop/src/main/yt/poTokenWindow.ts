/**
 * The hidden window BotGuard runs in for proof-of-origin tokens, the desktop's
 * `YtPoTokenWebView`: the phone's `wave_po_token.html`, served as `https://www.youtube.com/`
 * (BotGuard checks its origin) from an in-memory session whose network is cut off. Main makes
 * BotGuard's requests itself (`botguardPost`), so the page reaches nothing.
 */
import { BrowserWindow, session } from "electron";

import page from "../../../../mobile/modules/wave-native/android/src/main/assets/wave_po_token.html?raw";
import { PO_TOKEN_USER_AGENT, type PoTokenPage } from "./poTokens.ts";

const PAGE_URL = "https://www.youtube.com/";
/** Not `persist:`, so nothing the page stores outlives the app. */
const PARTITION = "wave-po-token";

let sessionReady = false;

const poTokenSession = () => {
  const ses = session.fromPartition(PARTITION, { cache: false });
  if (!sessionReady) {
    sessionReady = true;
    ses.setUserAgent(PO_TOKEN_USER_AGENT);
    ses.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    ses.webRequest.onBeforeRequest((details, callback) =>
      callback({ cancel: details.url !== PAGE_URL }),
    );
    for (const scheme of ["https", "http"])
      ses.protocol.handle(scheme, (request) =>
        request.url === PAGE_URL
          ? new Response(page, { headers: { "content-type": "text/html; charset=utf-8" } })
          : new Response(null, { status: 403 }),
      );
  }
  return ses;
};

/** Opens the page; resolves once it has loaded. */
export const openPoTokenPage = async (): Promise<PoTokenPage> => {
  const window = new BrowserWindow({
    show: false,
    width: 320,
    height: 240,
    webPreferences: {
      session: poTokenSession(),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: false,
      backgroundThrottling: false,
      spellcheck: false,
    },
  });
  const contents = window.webContents;
  let dead = false;
  contents.on("will-navigate", (event) => event.preventDefault());
  contents.on("will-redirect", (event) => event.preventDefault());
  contents.on("will-attach-webview", (event) => event.preventDefault());
  contents.setWindowOpenHandler(() => ({ action: "deny" }));
  contents.on("render-process-gone", () => {
    dead = true;
  });
  contents.on("unresponsive", () => {
    dead = true;
  });
  // The page logs its steps; only a thrown error counts, and nothing it logs is passed on.
  contents.on("console-message", (details) => {
    if (details.level === "error" && details.message.includes("Uncaught")) dead = true;
  });
  window.on("closed", () => {
    dead = true;
  });
  try {
    await window.loadURL(PAGE_URL);
  } catch (error) {
    window.destroy();
    throw error;
  }
  return {
    run: (script) => {
      if (dead || window.isDestroyed()) return Promise.reject(new Error("The page is gone"));
      return contents.executeJavaScript(script, true) as Promise<unknown>;
    },
    dead: () => dead || window.isDestroyed(),
    close: () => {
      dead = true;
      if (!window.isDestroyed()) window.destroy();
    },
  };
};
