/**
 * Why something failed, for the app log (docs/spec.md, "App log"): the
 * original error under the wrappers it reached the log through (Effect's
 * `TaggedError`s and `UnknownError`, an Expo module's rejection), by class and
 * message.
 */

import { downloadJobKind } from "./downloadJobKind.ts";

/** The original error under a failure's wrappers. */
export interface FailureCause {
  /** Its class: a native exception's (`java.io.IOException`), else the error's name; null for a bare value. */
  readonly kind: string | null;
  readonly message: string;
  /** The HTTP status a request answered with, when that's what failed. */
  readonly httpStatus: number | null;
}

/** How many wrappers deep a cause is followed. */
const MAX_DEPTH = 8;

/** What an Expo module's rejection puts before the native exception. */
const EXPO_REJECTION = /^Call to function '[^']*' has been rejected\.\s*→ Caused by: /;

/** A Java or Kotlin exception's `toString()`: its class, then its message. */
const JAVA_EXCEPTION = /^((?:[a-z_$][\w$]*\.)+[A-Z][\w$]*)(?::\s?([\s\S]*))?$/;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

/** The value's own message: an error's, an object's `message`, a string as it is. */
const messageOf = (value: unknown): string => {
  if (typeof value === "string") return value;
  if (isObject(value)) return typeof value.message === "string" ? value.message : "";
  return String(value);
};

/** Where an Effect error (`Data.TaggedError`, `Cause.UnknownError`) keeps its class. */
const EFFECT_TAG = "_tag";

const nameOf = (value: Record<string, unknown>): string | null => {
  const tag = value[EFFECT_TAG];
  if (typeof tag === "string") return tag;
  const name = typeof value.name === "string" ? value.name : null;
  if ((name === null || name === "Error") && typeof value.code === "string") return value.code;
  return name;
};

const statusOf = (value: unknown): number | null => {
  if (!isObject(value)) return null;
  const status = value.status;
  return typeof status === "number" && status >= 100 && status <= 599 ? status : null;
};

/**
 * The original error under [error]: its `cause` followed through every wrapper
 * (an Effect `TaggedError`, an `UnknownError`) to the last, and an Expo
 * rejection's message read for the native exception's class and message. The
 * HTTP status is the first one found on the way.
 */
export const failureCause = (error: unknown): FailureCause => {
  let current = error;
  let httpStatus = statusOf(current);
  const seen = new Set<unknown>();
  for (let depth = 0; depth < MAX_DEPTH; depth++) {
    if (!isObject(current) || current.cause === undefined || current.cause === null) break;
    if (seen.has(current)) break;
    seen.add(current);
    current = current.cause;
    httpStatus ??= statusOf(current);
  }
  const message = messageOf(current).replace(EXPO_REJECTION, "");
  const java = JAVA_EXCEPTION.exec(message);
  if (java !== null) return { kind: java[1] ?? null, message: java[2] ?? "", httpStatus };
  return { kind: isObject(current) ? nameOf(current) : null, message, httpStatus };
};

/** The longest cause message a line keeps: the log's lines stay short. */
const MAX_CAUSE_CHARS = 1_000;

/**
 * [error]'s original error on one line: `Class: message` (or the message
 * alone for a bare value), cut short past a thousand characters.
 */
export const describeCause = (error: unknown): string => {
  const { kind, message } = failureCause(error);
  const flat = message.replace(/\s+/g, " ").trim();
  const text = kind === null ? flat : flat === "" ? kind : `${kind}: ${flat}`;
  return text.length <= MAX_CAUSE_CHARS ? text : `${text.slice(0, MAX_CAUSE_CHARS)}…`;
};

/** The online services a lookup asks. */
export type LookupService = "LRCLIB" | "Deezer" | "YT Music";

/**
 * The log line for [what] (a Fix Song lookup, a lyrics search) failing on
 * [service]: `<what> failed (<service>[, HTTP <status>]): <original error>`.
 */
export const lookupFailureLine = (what: string, service: LookupService, error: unknown): string => {
  const { httpStatus } = failureCause(error);
  const status = httpStatus === null ? "" : `, HTTP ${httpStatus}`;
  return `${what} failed (${service}${status}): ${describeCause(error)}`;
};

/** Which step of filling in a song's tags failed: reading its file, writing the tags, or re-indexing it. */
export type TagWriteStep = "read" | "write" | "reindex";

/**
 * Where a song being filled in came from: a quality replacement's new copy
 * (which way), an ordinary download, a Fix Song run, or the Lyrics view's
 * search writing the lyrics it found.
 */
export type TagWriteOrigin = "upgrade" | "downgrade" | "download" | "fixSong" | "lyricsSearch";

/** Where download job [jobId]'s song came from: a quality replacement (which way) or a download. */
export const downloadTagWriteOrigin = (jobId: string): TagWriteOrigin => {
  const job = downloadJobKind(jobId);
  return job.kind === "quality" ? job.direction : "download";
};

/** The file as it was when the write failed: whether it was there, and its size. */
export interface TagWriteFile {
  readonly exists: boolean;
  readonly bytes: number | null;
}

/** A tag write that failed, as its log line says it. */
export interface TagWriteFailure {
  readonly path: string;
  readonly origin: TagWriteOrigin;
  /** Null when the failure didn't say (a rejection from outside the steps). */
  readonly step: TagWriteStep | null;
  /** Null when the failure didn't say. */
  readonly file: TagWriteFile | null;
  readonly cause: unknown;
}

const STEP_FAILED: Record<TagWriteStep, string> = {
  read: "reading the file failed",
  write: "writing the tags failed",
  reindex: "re-indexing failed",
};

const ORIGIN: Record<TagWriteOrigin, string> = {
  upgrade: "a quality replacement, upgrade",
  downgrade: "a quality replacement, downgrade",
  download: "a download",
  fixSong: "a Fix Song run",
  lyricsSearch: "the Lyrics view's search",
};

/** [path]'s extension with its dot, lower-cased, or "no extension". */
const extensionOf = (path: string): string => {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? "no extension" : name.slice(dot).toLowerCase();
};

const fileFacts = (file: TagWriteFile | null, path: string): string => {
  const extension = extensionOf(path);
  if (file === null) return extension;
  if (!file.exists) return `file missing, ${extension}`;
  const size = file.bytes === null ? "" : ` ${file.bytes} bytes,`;
  return `file present,${size} ${extension}`;
};

/**
 * The log line for a song's tags not being filled in: the step that failed,
 * where the song came from, the file's presence, size and extension, and the
 * original error under the wrappers (`describeCause`).
 */
export const tagWriteFailureLine = ({
  path,
  origin,
  step,
  file,
  cause,
}: TagWriteFailure): string => {
  const what =
    origin === "lyricsSearch"
      ? `couldn't write the lyrics found into ${path}`
      : `couldn't fill in ${path}`;
  const failed = step === null ? "the write failed" : STEP_FAILED[step];
  return `${what}: ${failed} (${ORIGIN[origin]}; ${fileFacts(file, path)}): ${describeCause(cause)}`;
};
