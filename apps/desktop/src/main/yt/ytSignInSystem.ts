/**
 * The real browser, files and socket under YouTube's sign-in (`ytBrowserSignIn.ts`): the
 * installed browser started as its own process, a temporary profile that lasts
 * only as long as the sign-in, and Node's `WebSocket` to the headless browser's DevTools.
 */
import { execFileSync, spawn } from "node:child_process";
import {
  accessSync,
  closeSync,
  constants,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  statSync,
} from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import type { CdpSocket } from "./cdp.ts";
import {
  defaultBrowserCommand,
  findSignInBrowser,
  linuxCookieDbCandidates,
  linuxKeyringApp,
  signInProfileRoot,
} from "./signInBrowser.ts";
import {
  startYtBrowserSignIn,
  type BrowserProcess,
  type YtBrowserSignIn,
} from "./ytBrowserSignIn.ts";
import { readBrowserSession, type SealedCookieRow } from "./ytCookieSession.ts";
import { readSafeStorageSecret } from "./secretService.ts";
import { startYtSignIn } from "./ytSignIn.ts";

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

const isChromiumSnapWrapper = (path: string): boolean => {
  try {
    const file = openSync(path, "r");
    try {
      const header = Buffer.alloc(4096);
      const length = readSync(file, header);
      const script = header.toString("utf8", 0, length);
      return script.startsWith("#!") && script.includes("/snap/bin/chromium");
    } finally {
      closeSync(file);
    }
  } catch {
    return false;
  }
};

/**
 * The Linux desktop's default web browser as a sign-in command, or undefined when there is none,
 * it cannot be read, or it is not a Chromium-family browser. `xdg-settings` prints a `.desktop`
 * name like `brave-browser.desktop`, which {@link defaultBrowserCommand} maps.
 */
const linuxDefaultBrowser = (platform: NodeJS.Platform): string | undefined => {
  if (platform !== "linux") return undefined;
  try {
    const entry = execFileSync("xdg-settings", ["get", "default-web-browser"], {
      encoding: "utf8",
      timeout: 2_000,
      stdio: ["ignore", "pipe", "ignore"],
    });
    return defaultBrowserCommand(entry);
  } catch {
    return undefined;
  }
};

/** A browser holds its profile's files for a moment after it exits, so the delete retries. */
const removeFolder = (folder: string) =>
  rm(folder, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });

/**
 * The YouTube and Google cookie rows of the default browser's store, hot-copied and read read-only,
 * or null when there is no such store or it cannot be read. The live store may be write-locked, so
 * it is copied first; the values stay sealed — {@link readBrowserSession} decrypts them.
 */
const readDefaultBrowserCookies = (
  command: string | undefined,
  home: string,
): readonly SealedCookieRow[] | null => {
  const dbPath = linuxCookieDbCandidates(command, home).find(existsSync);
  if (dbPath === undefined) return null;
  let scratch: string | undefined;
  try {
    scratch = mkdtempSync(join(tmpdir(), "wave-yt-cookies-"));
    const copy = join(scratch, "Cookies");
    copyFileSync(dbPath, copy);
    const db = new Database(copy, { readonly: true, fileMustExist: true });
    try {
      return db
        .prepare(
          "select host_key as host, name, encrypted_value as encrypted from cookies " +
            "where host_key like '%youtube.com' or host_key like '%google.com'",
        )
        .all() as SealedCookieRow[];
    } finally {
      db.close();
    }
  } catch {
    return null;
  } finally {
    if (scratch !== undefined) void rm(scratch, { recursive: true, force: true }).catch(() => {});
  }
};

/**
 * The default browser's "Safe Storage" keyring password from the Secret Service, or null when it
 * has no entry for the browser or cannot be reached — the sign-in then opens the window. This reads
 * the keyring directly over D-Bus, so it needs no `secret-tool` on the system.
 */
const readKeyringSecret = (command: string | undefined): Promise<string | null> => {
  const app = linuxKeyringApp(command);
  if (app === undefined) return Promise.resolve(null);
  return readSafeStorageSecret(app);
};

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
  readonly start: (email: string | null) => YtBrowserSignIn;
  /** Deletes the profile folders a run that crashed left behind. */
  readonly sweep: () => Promise<void>;
}

export const ytSignInSystem = (options: YtSignInSystemOptions): YtSignInSystem => {
  const { userData, home, platform, env } = options;
  const snapRoots = (): string[] => {
    if (platform !== "linux") return [];
    try {
      return readdirSync(join(home, "snap")).map((name) => join(home, "snap", name, "common"));
    } catch {
      return [];
    }
  };
  return {
    start: (email) => {
      const command = linuxDefaultBrowser(platform);
      const startWindow = (): YtBrowserSignIn => {
        const browser = findSignInBrowser({
          platform,
          env,
          isChromiumSnapWrapper,
          preferred: command,
          exists: (path) => {
            try {
              if (platform === "linux") accessSync(path, constants.X_OK);
              return statSync(path).isFile();
            } catch {
              return false;
            }
          },
        });
        return startYtBrowserSignIn({
          browser,
          email,
          spawn: startBrowser,
          files: {
            makeProfile: () => {
              const root =
                platform === "linux" && browser
                  ? signInProfileRoot(browser, home, userData)
                  : userData;
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
      };
      return startYtSignIn({
        // Linux only: on other platforms the browser cookie store is sealed in a way another app
        // cannot open, so the sign-in goes straight to the window.
        readExistingSession: () =>
          platform === "linux"
            ? readBrowserSession({
                readCookieRows: () => readDefaultBrowserCookies(command, home),
                secret: () => readKeyringSecret(command),
                ...(options.log === undefined ? {} : { log: options.log }),
              })
            : Promise.resolve(null),
        startWindow,
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
