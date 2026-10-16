import {
  APP_LOG_LIMITS,
  describeLogArgs,
  formatLogEntry,
  logFileName,
  logHeader,
  trimLog,
  type LogEntry,
  type LogLevel,
} from "@wave/core";
import { AppState } from "react-native";

import { WaveAppLog } from "@/native/waveAppLog";

/**
 * Wave's app log (docs/spec.md, "App log"): unhandled errors and rejections, the
 * errors React reports, and every `console.warn` / `console.error`, in a file in
 * Wave's private storage that Settings › Developer › Export Logs shares. Core's
 * `appLog.ts` decides what a line looks like, what's redacted and what goes when
 * the log is full; this module only collects entries and hands them to the file.
 *
 * Entries wait in memory and are written together a moment later, off the JS
 * thread (the native module's background queue), so logging costs a render or a
 * scroll no more than an array push. A fatal error is written at once instead,
 * before the process goes.
 */

/** How long entries wait to be written together. */
const FLUSH_DELAY_MS = 2_000;

/** Waiting entries past which they're written at the next turn. */
const FLUSH_SOON_ENTRIES = 100;

// console's own functions, before the log wraps them: the log's own failures go
// there, never back into the log.
const consoleWarn = console.warn.bind(console);
const consoleError = console.error.bind(console);

let pending: LogEntry[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let writing: Promise<void> = Promise.resolve();

const takePending = (): string | null => {
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
  if (pending.length === 0) return null;
  const entries = pending;
  pending = [];
  return entries.map(formatLogEntry).join("");
};

const writePending = async (): Promise<void> => {
  const text = takePending();
  if (text === null || WaveAppLog === null) return;
  const size = await WaveAppLog.append(text);
  if (size <= APP_LOG_LIMITS.maxBytes) return;
  const { droppedBytes } = trimLog(await WaveAppLog.read());
  if (droppedBytes > 0) await WaveAppLog.dropHead(droppedBytes);
};

/** Writes the waiting entries; one write at a time, so a trim never races another. */
export const flushAppLog = (): Promise<void> => {
  writing = writing
    .then(writePending)
    .catch((error: unknown) => consoleWarn("[wave] Couldn't write the app log", error));
  return writing;
};

/** Writes the waiting entries at once, on the JS thread: for an error that may end the process. */
const flushAppLogNow = (): void => {
  const text = takePending();
  if (text === null || WaveAppLog === null) return;
  try {
    WaveAppLog.appendNow(text);
  } catch (error) {
    consoleError("[wave] Couldn't write the app log", error);
  }
};

const schedule = (delay: number): void => {
  if (timer !== null) {
    if (delay > 0) return;
    clearTimeout(timer);
  }
  timer = setTimeout(() => {
    timer = null;
    void flushAppLog();
  }, delay);
};

/** Notes something in the log; it's written with the next batch. */
export const appLog = (level: LogLevel, tag: string, message: string): void => {
  pending.push({ at: Date.now(), level, tag, message });
  schedule(pending.length >= FLUSH_SOON_ENTRIES ? 0 : FLUSH_DELAY_MS);
};

/** Writes what's waiting, then opens the share sheet with the log and its header. */
export const exportAppLog = async (): Promise<void> => {
  if (WaveAppLog === null) throw new Error("This build of Wave has no app log");
  await flushAppLog();
  const now = Date.now();
  const device = WaveAppLog.device();
  await WaveAppLog.share(logHeader(device, now), logFileName(device.appVersion, now));
};

/** An error React reported (`isComponentError`): an uncaught one ends the process. */
const isComponentError = (value: unknown): boolean =>
  value instanceof Error && (value as { isComponentError?: unknown }).isComponentError === true;

/** Set while the log reports something itself, so the console calls it makes aren't logged twice. */
let reporting = false;

const reportQuietly = (report: () => void): void => {
  reporting = true;
  try {
    report();
  } finally {
    reporting = false;
  }
};

const captureConsole = (level: "warn" | "error", write: (...args: unknown[]) => void) =>
  function logged(...args: unknown[]): void {
    write(...args);
    if (reporting) return;
    reportQuietly(() => {
      const fromReact = args.some(isComponentError);
      appLog(level, fromReact ? "react" : "console", describeLogArgs(args));
      if (fromReact) flushAppLogNow();
    });
  };

interface ErrorUtilsGlobal {
  getGlobalHandler(): (error: unknown, isFatal?: boolean) => void;
  setGlobalHandler(handler: (error: unknown, isFatal?: boolean) => void): void;
}

interface HermesRejectionTracker {
  enablePromiseRejectionTracker?(options: {
    allRejections: boolean;
    onUnhandled: (id: number, rejection: unknown) => void;
    onHandled: (id: number) => void;
  }): void;
}

const globals = globalThis as typeof globalThis & {
  ErrorUtils?: ErrorUtilsGlobal;
  HermesInternal?: HermesRejectionTracker;
};

/** Unhandled errors go in the log with their stack, then on to React Native's handler. */
const captureUncaughtErrors = (): void => {
  const errorUtils = globals.ErrorUtils;
  if (errorUtils === undefined) return;
  const previous = errorUtils.getGlobalHandler();
  errorUtils.setGlobalHandler((error, isFatal) => {
    reportQuietly(() => {
      appLog(isFatal === true ? "fatal" : "error", "uncaught", describeLogArgs([error]));
      flushAppLogNow();
      // React Native's handler logs the error to the console itself: it's in the log already.
      previous(error, isFatal);
    });
  });
};

/**
 * Promise rejections nothing handled go in the log with their stack. React Native
 * tracks them only in development (as warnings); this tracks them in every build.
 */
const captureUnhandledRejections = (): void => {
  globals.HermesInternal?.enablePromiseRejectionTracker?.({
    allRejections: true,
    onUnhandled: (_id, rejection) => {
      reportQuietly(() => {
        appLog(
          "error",
          "rejection",
          `Unhandled promise rejection: ${describeLogArgs([rejection])}`,
        );
        if (__DEV__) consoleWarn("Possible unhandled promise rejection:", rejection);
      });
    },
    onHandled: () => {},
  });
};

let installed = false;

/**
 * Starts the log: wraps `console.warn` and `console.error`, catches unhandled
 * errors and rejections, and writes what's waiting whenever Wave leaves the
 * screen. Once per JS runtime, first thing (index.ts), so the app and Android
 * Auto's headless start both get it.
 */
export const installAppLog = (): void => {
  if (installed || WaveAppLog === null) return;
  installed = true;
  console.warn = captureConsole("warn", consoleWarn);
  console.error = captureConsole("error", consoleError);
  captureUncaughtErrors();
  captureUnhandledRejections();
  AppState.addEventListener("change", (state) => {
    if (state !== "active") void flushAppLog();
  });
  try {
    const { appVersion, appBuild } = WaveAppLog.device();
    appLog("info", "app", `Wave ${appVersion} (build ${appBuild}) started`);
  } catch {
    appLog("info", "app", "Wave started");
  }
};
