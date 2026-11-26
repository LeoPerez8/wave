/**
 * YouTube's sign-in on the desktop (docs/spec-desktop.md, Sign-in), in the installed browser and
 * in two steps, since Google refuses to sign in both an embedded window and a browser started
 * with a debugging port:
 *
 * 1. the browser opens as a plain window on a profile folder Wave owns, on Google's sign-in page.
 *    The owner signs in and closes the window;
 * 2. the same browser then runs headless on that profile, and Wave reads the session from it
 *    over the DevTools protocol: the cookies for music.youtube.com, and which account and channel
 *    the page is signed in as.
 *
 * The profile folder is deleted however it ends. Starting the browser, the files and the socket
 * are passed in (`ytSignInSystem.ts` has the real ones), so the tests need no browser.
 */
import { openCdp, type Cdp, type CdpSocket } from "./cdp.ts";

export const YT_SIGN_IN_URL =
  "https://accounts.google.com/ServiceLogin?continue=https%3A%2F%2Fmusic.youtube.com";
const YT_MUSIC_URL = "https://music.youtube.com/";
const YT_MUSIC_HOST = "music.youtube.com";

/** The file a browser started with `--remote-debugging-port=0` writes its port and path to. */
const PORT_FILE = "DevToolsActivePort";

/** A cookie as the DevTools protocol's `Storage.getCookies` gives it. */
export interface CdpCookie {
  readonly name: string;
  readonly value: string;
  readonly domain: string;
  /** Set on a cookie kept for one embedding site only, which the page itself doesn't get. */
  readonly partitionKey?: unknown;
}

export type YtBrowserOutcome =
  /** The session as read; `dataSyncId` and `sessionIndex` are the page config's, unparsed. */
  | {
      readonly kind: "signedIn";
      readonly cookie: string;
      readonly dataSyncId: string | null;
      readonly sessionIndex: string;
    }
  /** The window was closed with nobody signed in. */
  | { readonly kind: "closed" }
  | { readonly kind: "cancelled" }
  | { readonly kind: "noBrowser" }
  | { readonly kind: "failed" };

export interface BrowserProcess {
  /** Settles when the process is gone; "failed" when it never started. */
  readonly exited: Promise<"exited" | "failed">;
  readonly kill: () => void;
}

export interface YtBrowserSignInOptions {
  /** The browser's path (`findSignInBrowser`), null when none is installed. */
  readonly browser: string | null;
  readonly email?: string | null;
  readonly spawn: (path: string, args: readonly string[]) => BrowserProcess;
  readonly files: {
    /** Makes the empty profile folder and answers its path. */
    readonly makeProfile: () => string;
    readonly read: (path: string) => string | undefined;
    readonly remove: (folder: string) => Promise<void>;
    readonly join: (...parts: string[]) => string;
  };
  readonly connect: (url: string) => CdpSocket;
  readonly now?: () => number;
  readonly wait?: (ms: number) => Promise<void>;
  /** A line for the log. It never carries a cookie's value or an account's detail. */
  readonly log?: (line: string) => void;
}

export interface YtBrowserSignIn {
  readonly outcome: Promise<YtBrowserOutcome>;
  /** Closes whichever browser is running and ends as cancelled. */
  readonly cancel: () => void;
}

/** The cookies innertubex signs requests with: one of them means a signed-in session. */
const SESSION_COOKIES = ["SAPISID", "__Secure-3PAPISID", "__Secure-1PAPISID"];

export const forYtMusic = (cookie: CdpCookie): boolean => {
  if (cookie.partitionKey !== undefined) return false;
  const domain = cookie.domain.replace(/^\./, "");
  return YT_MUSIC_HOST === domain || YT_MUSIC_HOST.endsWith(`.${domain}`);
};

/** The `Cookie` header music.youtube.com gets from [cookies], each name once. */
export const ytCookieHeader = (cookies: readonly CdpCookie[]): string => {
  const values = new Map<string, string>();
  for (const cookie of cookies)
    if (forYtMusic(cookie) && !values.has(cookie.name)) values.set(cookie.name, cookie.value);
  return [...values].map(([name, value]) => `${name}=${value}`).join("; ");
};

export const isSignedIn = (cookies: readonly CdpCookie[]): boolean =>
  cookies.some((cookie) => forYtMusic(cookie) && SESSION_COOKIES.includes(cookie.name));

/**
 * What the phone's `YtSignInPage.CONFIG_SCRIPT` reads from the page's config, and whether the
 * page has its config yet. Answers a JSON object as a string.
 */
const CONFIG_SCRIPT =
  "(function(){var c=(window.yt&&window.yt.config_)||(window.ytcfg&&window.ytcfg.data_)||{};" +
  "return JSON.stringify({loaded:Object.keys(c).length>0,dataSyncId:c.DATASYNC_ID||null," +
  "sessionIndex:String(c.SESSION_INDEX||0)});})()";

interface PageConfig {
  readonly loaded: boolean;
  readonly dataSyncId: string | null;
  readonly sessionIndex: string;
}
const NO_CONFIG: PageConfig = { loaded: false, dataSyncId: null, sessionIndex: "0" };

const parseConfig = (value: unknown): PageConfig => {
  if (typeof value !== "string") return NO_CONFIG;
  try {
    const config = JSON.parse(value) as Record<string, unknown>;
    const dataSyncId = config["dataSyncId"];
    const sessionIndex = config["sessionIndex"];
    return {
      loaded: config["loaded"] === true,
      dataSyncId: typeof dataSyncId === "string" && dataSyncId !== "" ? dataSyncId : null,
      sessionIndex: typeof sessionIndex === "string" ? sessionIndex : "0",
    };
  } catch {
    return NO_CONFIG;
  }
};

/** How long the headless browser gets to say where its DevTools port is. */
const PORT_WAIT_MS = 15_000;
/** It exits at once while the window's process still holds the profile, so it gets more tries. */
const HEADLESS_TRIES = 3;
/** How long the page gets to load its config. */
const CONFIG_WAIT_MS = 20_000;
/** How long a loaded, signed-in page gets to name its channel before the sign-in goes without. */
const CHANNEL_WAIT_MS = 6_000;
const POLL_MS = 500;
/** How long the headless browser gets to close by itself, so the profile's files are free. */
const CLOSE_WAIT_MS = 5_000;

class Cancelled extends Error {}

export const startYtBrowserSignIn = (options: YtBrowserSignInOptions): YtBrowserSignIn => {
  const { browser, spawn, files, connect } = options;
  if (browser === null)
    return { outcome: Promise.resolve({ kind: "noBrowser" }), cancel: () => {} };
  const now = options.now ?? Date.now;
  const wait =
    options.wait ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const log = options.log ?? (() => {});

  let cancelled = false;
  let running: BrowserProcess | null = null;
  let cdp: Cdp | null = null;
  const live = () => {
    if (cancelled) throw new Cancelled();
  };

  /** Starts the headless browser on [profile] and answers its DevTools address. */
  const startHeadless = async (profile: string): Promise<string> => {
    const portFile = files.join(profile, PORT_FILE);
    let stale = files.read(portFile);
    for (let attempt = 0; attempt < HEADLESS_TRIES; attempt++) {
      live();
      const child = spawn(browser, [
        `--user-data-dir=${profile}`,
        "--headless=new",
        "--remote-debugging-port=0",
        "--no-first-run",
        "--no-default-browser-check",
        "about:blank",
      ]);
      running = child;
      let gone = false;
      void child.exited.then(() => (gone = true));
      const started = now();
      while (!gone && now() - started < PORT_WAIT_MS) {
        const text = files.read(portFile);
        if (text !== undefined && text !== stale) {
          const [port, path] = text.split("\n").map((line) => line.trim());
          if (port !== undefined && /^\d+$/.test(port) && path?.startsWith("/") === true)
            return `ws://127.0.0.1:${port}${path}`;
        }
        await wait(100);
        live();
      }
      stale = files.read(portFile);
      child.kill();
      if (!gone) break;
      await wait(1_000);
    }
    throw new Error("The headless browser gave no DevTools port");
  };

  /** Reads the session the window left in [profile]. */
  const readSession = async (profile: string): Promise<YtBrowserOutcome> => {
    const address = await startHeadless(profile);
    const headless = running;
    const devTools = await openCdp(connect(address));
    cdp = devTools;
    live();
    const cookies = async () =>
      ((await devTools.send("Storage.getCookies"))["cookies"] ?? []) as readonly CdpCookie[];
    try {
      const version = await devTools.send("Browser.getVersion");
      const targets = ((await devTools.send("Target.getTargets"))["targetInfos"] ??
        []) as readonly { readonly targetId: string; readonly type: string }[];
      const targetId =
        targets.find((target) => target.type === "page")?.targetId ??
        ((await devTools.send("Target.createTarget", { url: "about:blank" }))[
          "targetId"
        ] as string);
      const attached = await devTools.send("Target.attachToTarget", { targetId, flatten: true });
      const page = attached["sessionId"] as string;
      // YouTube Music gives a browser that calls itself headless a page without its config.
      await devTools.send(
        "Emulation.setUserAgentOverride",
        { userAgent: String(version["userAgent"] ?? "").replace("HeadlessChrome", "Chrome") },
        page,
      );
      await devTools.send("Page.navigate", { url: YT_MUSIC_URL }, page);

      let config = NO_CONFIG;
      const started = now();
      let loadedAt: number | null = null;
      for (;;) {
        live();
        try {
          const evaluated = await devTools.send(
            "Runtime.evaluate",
            { expression: CONFIG_SCRIPT, returnByValue: true },
            page,
          );
          config = parseConfig((evaluated["result"] as { value?: unknown } | undefined)?.value);
        } catch {
          // The page is between two documents; the next read finds the new one.
          live();
        }
        if (config.dataSyncId !== null) break;
        if (config.loaded) {
          if (loadedAt === null) {
            loadedAt = now();
            if (!isSignedIn(await cookies())) break;
          }
          if (now() - loadedAt >= CHANNEL_WAIT_MS) break;
        }
        if (now() - started >= CONFIG_WAIT_MS) break;
        await wait(POLL_MS);
      }
      live();
      const read = await cookies();
      const names = read.filter(forYtMusic).length;
      if (!isSignedIn(read)) {
        log(`YouTube sign-in: no session among ${names} cookies`);
        return { kind: "closed" };
      }
      log(
        `YouTube sign-in: session read, ${names} cookies, channel ${config.dataSyncId === null ? "not named" : "named"}`,
      );
      return {
        kind: "signedIn",
        cookie: ytCookieHeader(read),
        dataSyncId: config.dataSyncId,
        sessionIndex: config.sessionIndex,
      };
    } finally {
      if (!cancelled) {
        await devTools.send("Browser.close").catch(() => {});
        if (headless !== null) await Promise.race([headless.exited, wait(CLOSE_WAIT_MS)]);
      }
      devTools.close();
    }
  };

  const run = async (): Promise<YtBrowserOutcome> => {
    let profile: string;
    try {
      profile = files.makeProfile();
    } catch {
      return { kind: "failed" };
    }
    try {
      const window = spawn(browser, [
        `--user-data-dir=${profile}`,
        "--no-first-run",
        "--no-default-browser-check",
        "--new-window",
        options.email
          ? `${YT_SIGN_IN_URL}&Email=${encodeURIComponent(options.email)}`
          : YT_SIGN_IN_URL,
      ]);
      running = window;
      const ended = await window.exited;
      live();
      if (ended === "failed") {
        log("YouTube sign-in: the browser didn't start");
        return { kind: "failed" };
      }
      return await readSession(profile);
    } catch {
      if (cancelled) return { kind: "cancelled" };
      log("YouTube sign-in failed");
      return { kind: "failed" };
    } finally {
      running?.kill();
      await files.remove(profile).catch(() => {});
    }
  };

  return {
    outcome: run(),
    cancel: () => {
      cancelled = true;
      running?.kill();
      cdp?.close();
    },
  };
};
