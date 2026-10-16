/**
 * What JS tells the native download journal when it can't answer one of its
 * decisions. The failure's reason is what the Downloads page says; its cause,
 * the error behind it, stays on the job (`YtDownloadJournalJob.cause`) and in
 * the log so a failure can be told apart from the next.
 */

import type { DownloadFailurePlan } from "./downloadSource.ts";
import type { YtDownloadFailure } from "./ytDownloads.ts";

/** A decision the journal leases to JS. */
export type DownloadDecision = "prepare" | "confirm" | "publish" | "import";

/** The longest cause the journal keeps, as the native journal caps it. */
const MAX_CAUSE = 1_000;
/** How many errors of a cause chain a cause names. */
const MAX_CHAIN = 4;

const field = (value: unknown, key: string): unknown =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>)[key] : undefined;

const text = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined;

/** One error as "Class [code]: message". */
const describeOne = (error: unknown): string => {
  if (typeof error !== "object" || error === null) return String(error);
  const name =
    text(field(error, "_tag")) ?? text(field(error, "name")) ?? error.constructor?.name ?? "Error";
  const code = text(field(error, "code"));
  const message = text(field(error, "message"));
  const label = code === undefined ? name : `${name} [${code}]`;
  return message === undefined ? label : `${label}: ${message}`;
};

/**
 * [error] as the journal keeps it: each error's class (or tag), code and
 * message, then what it was caused by after " <- ", at most 1000 characters.
 * Null when nothing was thrown.
 */
export const downloadFailureCause = (error: unknown): string | null => {
  if (error === undefined || error === null) return null;
  if (typeof error === "string") return error.slice(0, MAX_CAUSE);
  const chain: string[] = [];
  let current: unknown = error;
  while (current !== undefined && current !== null && chain.length < MAX_CHAIN) {
    chain.push(describeOne(current));
    const next = field(current, "cause");
    current = next === current ? undefined : next;
  }
  return chain.join(" <- ").slice(0, MAX_CAUSE);
};

/** What SQLite and the file system say when the phone's storage is full. */
const STORAGE_FULL = ["SQLITE_FULL", "database or disk is full", "ENOSPC", "No space left"];

/**
 * Whether [error] (or what it was caused by) is the phone's storage being
 * full: the one Library failure a download fails with "storage" for. Any
 * other error is the download's own failure.
 */
export const downloadStorageFull = (error: unknown): boolean => {
  const cause = downloadFailureCause(error);
  return cause !== null && STORAGE_FULL.some((sign) => cause.includes(sign));
};

/** What the job holds that a failed prepare hands back, so the journal keeps its plans. */
export interface DownloadFailureHeld {
  readonly failurePlan?: DownloadFailurePlan;
  readonly fallback?: unknown;
  readonly tags?: unknown;
}

/** A decision's answer when JS couldn't make it. */
export interface DownloadFailureAnswer {
  readonly failure: YtDownloadFailure;
  readonly cause?: string;
  readonly failurePlan?: DownloadFailurePlan;
  readonly fallback?: unknown;
  readonly tags?: unknown;
}

/**
 * The answer to [decision] that failed with [failure], caused by [error]
 * (nothing for a failure decided on, such as no folder). A prepare answer
 * replaces the job's plans, so a failed one hands back the retry and fallback
 * plan and the tags the job [held]: the journal still tries again, or carries
 * on from YouTube Music, as the plan says.
 */
export const downloadFailureAnswer = (
  decision: DownloadDecision,
  failure: YtDownloadFailure,
  error: unknown,
  held: DownloadFailureHeld,
): DownloadFailureAnswer => {
  const cause = downloadFailureCause(error);
  return {
    failure,
    ...(cause === null ? {} : { cause }),
    ...(decision !== "prepare"
      ? {}
      : {
          ...(held.failurePlan === undefined ? {} : { failurePlan: held.failurePlan }),
          ...(held.fallback === undefined ? {} : { fallback: held.fallback }),
          ...(held.tags === undefined ? {} : { tags: held.tags }),
        }),
  };
};
