/**
 * The real browser, files and socket under YouTube's sign-in (`ytBrowserSignIn.ts`): the
 * installed browser started as its own process, a profile folder under Wave's data that lasts
 * only as long as the sign-in, and Node's `WebSocket` to the headless browser's DevTools.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { rm } from "node:fs/promises";
import { basename, join } from "node:path";
import type { CdpSocket } from "./cdp.ts";
import { findSignInBrowser } from "./signInBrowser.ts";
import {
  startYtBrowserSignIn,
  type BrowserProcess,
  type YtBrowserSignIn,
} from "./ytBrowserSignIn.ts";

/** What a sign-in's profile folder is called, so one left by a crash is found and deleted. */
const PROFILE_PREFIX = "yt-sign-in-";

const startBrowser = (path: string, args: readonly string[]): BrowserProcess => {
  const child = spawn(path, [...args], { stdio: "ignore" });
  return {
    exited: new Promise((resolve) => {
      child.once("error", () => resolve("failed"));
      child.once("exit", () => resolve("exited"));
    }),
    kill: () => {
      if (child.exitCode === null && child.signalCode === null) child.kill();
    },
  };
};

/** A browser holds its profile's files for a moment after it exits, so the delete retries. */
const removeFolder = (folder: string) =>
  rm(folder, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });

export interface YtSignInSystemOptions {
  /** Wave's data folder. */
  readonly userData: string;
  readonly home: string;
  readonly platform: NodeJS.Platform;
  readonly env: NodeJS.ProcessEnv;
  readonly log?: (line: string) => void;
}

export interface YtSignInSystem {
  /** Opens the browser on Google's sign-in. */
  readonly start: () => YtBrowserSignIn;
  /** Deletes the profile folders a run that crashed left behind. */
  readonly sweep: () => Promise<void>;
}

export const ytSignInSystem = (options: YtSignInSystemOptions): YtSignInSystem => {
  const { userData, home, platform, env } = options;
  /**
   * Where [browser]'s profile folder goes: Wave's data folder, except for a browser installed as
   * a snap, which sees neither hidden folders nor the system's temporary one and gets its own
   * folder under `~/snap`.
   */
  const profileRoot = (browser: string): string => {
    if (platform === "linux" && browser.startsWith("/snap/")) {
      const own = join(home, "snap", basename(browser), "common");
      if (existsSync(own)) return own;
    }
    return userData;
  };
  const snapRoots = (): string[] => {
    if (platform !== "linux") return [];
    try {
      return readdirSync(join(home, "snap")).map((name) => join(home, "snap", name, "common"));
    } catch {
      return [];
    }
  };
  return {
    start: () => {
      const browser = findSignInBrowser({ platform, env, exists: existsSync });
      return startYtBrowserSignIn({
        browser,
        spawn: startBrowser,
        files: {
          makeProfile: () => {
            const root = profileRoot(browser ?? "");
            mkdirSync(root, { recursive: true });
            return mkdtempSync(join(root, PROFILE_PREFIX));
          },
          read: (path) => {
            try {
              return readFileSync(path, "utf8");
            } catch {
              return undefined;
            }
          },
          remove: removeFolder,
          join,
        },
        connect: (url) => new WebSocket(url) as unknown as CdpSocket,
        ...(options.log === undefined ? {} : { log: options.log }),
      });
    },
    sweep: async () => {
      for (const root of [userData, ...snapRoots()]) {
        let names: string[];
        try {
          names = readdirSync(root);
        } catch {
          continue;
        }
        for (const name of names)
          if (name.startsWith(PROFILE_PREFIX)) await removeFolder(join(root, name)).catch(() => {});
      }
    },
  };
};
