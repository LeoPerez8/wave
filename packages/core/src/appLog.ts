/**
 * Wave's app log (docs/spec.md, "App log"): what a line looks like, what never
 * reaches it, which lines go when it's full, and the header and name of the
 * file Settings › Developer › Export Logs shares. The app only writes and
 * shares the file.
 */

export type LogLevel = "info" | "warn" | "error" | "fatal";

/** One thing the log records. */
export interface LogEntry {
  /** When it happened, in ms since the epoch. */
  readonly at: number;
  readonly level: LogLevel;
  /** A short word for where it came from: `console`, `uncaught`, `rejection`… */
  readonly tag: string;
  readonly message: string;
}

const LEVEL_LETTERS: Record<LogLevel, string> = { info: "I", warn: "W", error: "E", fatal: "F" };

/** What a secret is replaced with. */
const REDACTED = "[redacted]";

/** A key whose value is a secret: passwords, tokens, cookies, session ids, credentials. */
const SECRET_KEY =
  /password|passwd|^pass$|^pwd$|secret|token|cookie|^auth$|authori[sz]ation|apisid|psid|^[a-z]?sid$|api[-_]?key|credential|session[-_]?(?:id|key)$/i;

/**
 * `text` with every secret Wave handles replaced by `[redacted]`: passwords,
 * tokens, cookies and credentials as `key=value`, `key: value` or JSON pairs,
 * Authorization and Cookie headers, bearer tokens, JWTs (Google ID tokens),
 * Google access tokens and a URL's password. Everything else (song titles,
 * artists, paths) stays.
 */
export const redactSecrets = (text: string): string =>
  text
    // "key": "value" (JSON), 'key': 'value'.
    .replace(/(["'])([\w.-]+)\1(\s*:\s*)(["'])(?:\\.|(?!\4)[^\\])*\4/g, (match, q, key, sep, vq) =>
      SECRET_KEY.test(key) ? `${q}${key}${q}${sep}${vq}${REDACTED}${vq}` : match,
    )
    // key: 'value', key="value" (a printed object, a quoted form value).
    .replace(/\b([\w-]+)(\s*[:=]\s*)(["'])(?:\\.|(?!\3)[^\\])*\3/g, (match, key, sep, q) =>
      SECRET_KEY.test(key) ? `${key}${sep}${q}${REDACTED}${q}` : match,
    )
    // Authorization and Cookie headers, to the end of the line.
    .replace(
      /\b((?:proxy-)?authorization|set-cookie|cookie)(\s*:\s*)[^\r\n"']+/gi,
      (_, name, sep) => `${name}${sep}${REDACTED}`,
    )
    // A bearer token anywhere.
    .replace(/\b(bearer\s+)[\w.~+/=-]{8,}/gi, (_, bearer) => `${bearer}${REDACTED}`)
    // key=value, key: value (a query string, a form, a cookie, a header), but not
    // a URL's scheme, so its query is read on its own.
    .replace(/\b([\w-]+)(\s*[:=]\s*)(?!\/\/)[^\s&;,'"{}[\]()]+/g, (match, key, sep) =>
      SECRET_KEY.test(key) ? `${key}${sep}${REDACTED}` : match,
    )
    // A JWT, such as a Google ID token, and Google OAuth tokens.
    .replace(/\beyJ[\w-]+\.[\w-]+(?:\.[\w-]+)?/g, REDACTED)
    .replace(/\bya29\.[\w.-]+/g, REDACTED)
    .replace(/\b1\/\/[\w-]{16,}/g, REDACTED)
    // https://user:password@host
    .replace(/(\b[a-z][\w+.-]*:\/\/[^/\s:@]+:)[^/\s@]+@/gi, (_, before) => `${before}${REDACTED}@`);

/** The longest message an entry keeps; past it, it's cut short and says how much went. */
const MAX_MESSAGE_CHARS = 8_000;

/** How many causes an error's description follows. */
const MAX_CAUSES = 3;

const describeError = (error: Error, depth: number): string => {
  const own =
    typeof error.stack === "string" && error.stack.includes(error.message)
      ? error.stack
      : `${error.name}: ${error.message}`;
  // React's: the components a render error was thrown in.
  const componentStack: unknown = (error as { componentStack?: unknown }).componentStack;
  const withComponents =
    typeof componentStack === "string" && componentStack.trim() !== ""
      ? `${own}\nComponent stack:${componentStack.startsWith("\n") ? "" : "\n"}${componentStack}`
      : own;
  const cause = error.cause;
  if (cause === undefined || depth >= MAX_CAUSES) return withComponents;
  const described = cause instanceof Error ? describeError(cause, depth + 1) : describeValue(cause);
  return `${withComponents}\nCaused by: ${described}`;
};

const toJson = (value: object): string => {
  const seen = new WeakSet<object>();
  try {
    return (
      JSON.stringify(value, (_, inner: unknown) => {
        if (typeof inner === "bigint") return inner.toString();
        if (typeof inner === "object" && inner !== null) {
          if (seen.has(inner)) return "[circular]";
          seen.add(inner);
        }
        return inner;
      }) ?? String(value)
    );
  } catch {
    return String(value);
  }
};

const describeValue = (value: unknown): string => {
  if (typeof value === "string") return value;
  if (value instanceof Error) return describeError(value, 0);
  if (typeof value === "object" && value !== null) return toJson(value);
  if (typeof value === "function") return `[function ${value.name || "anonymous"}]`;
  return String(value);
};

/**
 * The message for what a `console.warn` or `console.error` call was given:
 * each argument described (a string as is, an error by its stack and causes,
 * an object as JSON), joined by spaces, without Wave's `[wave] ` prefix, and
 * cut short past a few thousand characters.
 */
export const describeLogArgs = (args: readonly unknown[]): string => {
  const message = args
    .map(describeValue)
    .join(" ")
    .replace(/^\[wave\] /, "");
  if (message.length <= MAX_MESSAGE_CHARS) return message;
  const more = message.length - MAX_MESSAGE_CHARS;
  return `${message.slice(0, MAX_MESSAGE_CHARS)}… (${more} more characters)`;
};

/** How big the log may grow, and what trimming it brings it down to, in UTF-8 bytes. */
export interface LogLimits {
  /** Past this, the oldest entries go. */
  readonly maxBytes: number;
  /** What's left once they have: under the cap, so the log isn't trimmed again at every write. */
  readonly keepBytes: number;
}

/** Wave's log: 2 MiB at most, trimmed to 1.5 MiB. */
export const APP_LOG_LIMITS: LogLimits = {
  maxBytes: 2 * 1024 * 1024,
  keepBytes: 1.5 * 1024 * 1024,
};

/** The UTF-8 size of a string's code unit at `index` (a surrogate pair counts 4 at its first half). */
const utf8Bytes = (text: string, index: number): number => {
  const code = text.charCodeAt(index);
  if (code < 0x80) return 1;
  if (code < 0x800) return 2;
  if (code >= 0xd800 && code < 0xdc00) return 4;
  if (code >= 0xdc00 && code < 0xe000) return 0;
  return 3;
};

const utf8Length = (text: string): number => {
  let total = 0;
  for (let i = 0; i < text.length; i++) total += utf8Bytes(text, i);
  return total;
};

/** What trimming the log keeps, and how many bytes went from its start. */
export interface LogTrim {
  readonly kept: string;
  readonly droppedBytes: number;
}

/**
 * Which entries go when the log is full: within `maxBytes` nothing does; past
 * it, the oldest entries go, whole (an entry's stack goes with it), until what's
 * left fits in `keepBytes`. `droppedBytes` is the UTF-8 size of what went, which
 * the app cuts from the start of the file (entries written since it read the
 * log are after that, and stay).
 */
export const trimLog = (text: string, limits: LogLimits = APP_LOG_LIMITS): LogTrim => {
  const size = utf8Length(text);
  if (size <= limits.maxBytes) return { kept: text, droppedBytes: 0 };
  let dropped = 0;
  let start = 0;
  // Walk forward, keeping a count of the bytes passed, to the first entry start where the rest fits.
  for (let i = 0; i < text.length; i++) {
    const atEntryStart = i > 0 && text.charCodeAt(i - 1) === 10 && !/\s/.test(text[i] ?? "");
    if (atEntryStart && size - dropped <= limits.keepBytes) {
      start = i;
      break;
    }
    dropped += utf8Bytes(text, i);
    start = i + 1;
  }
  return { kept: text.slice(start), droppedBytes: dropped };
};

/** What starts each of an entry's lines after the first, so only its first line starts with a time. */
const CONTINUATION = "  ";

/**
 * An entry as it goes in the file: `<ISO time, UTC> <I|W|E|F> <tag>: <message>`,
 * ending in a newline. A message of several lines (a stack) goes on the lines
 * after, each indented by two spaces.
 */
export const formatLogEntry = ({ at, level, tag, message }: LogEntry): string => {
  const lines = redactSecrets(message).replace(/\s+$/, "").split(/\r?\n/);
  const body = lines.join(`\n${CONTINUATION}`);
  return `${new Date(at).toISOString()} ${LEVEL_LETTERS[level]} ${tag}: ${body}\n`;
};

/** The phone and the Wave build an exported log came from. */
export interface LogDevice {
  /** Wave's version (Android's versionName), such as `0.5.3`. */
  readonly appVersion: string;
  /** Android's versionCode. */
  readonly appBuild: string;
  /** Android's release, such as `15`. */
  readonly androidVersion: string;
  readonly androidApi: number;
  readonly manufacturer: string;
  readonly model: string;
  /** The system text size, 1 being the default. */
  readonly fontScale: number;
}

/** The lines an exported log starts with, then a blank line before the entries. */
export const logHeader = (device: LogDevice, exportedAt: number): string =>
  [
    `Wave ${device.appVersion} (build ${device.appBuild})`,
    `Android ${device.androidVersion} (API ${device.androidApi})`,
    `Phone: ${device.manufacturer} ${device.model}`,
    // Android's float, such as 1.2999999523162842, to two places.
    `Font scale: ${Math.round(device.fontScale * 100) / 100}`,
    `Exported: ${new Date(exportedAt).toISOString()}`,
    "",
    "",
  ].join("\n");

/** The exported file's name: `wave-log-<date>-<version>.txt`. */
export const logFileName = (appVersion: string, exportedAt: number): string =>
  `wave-log-${new Date(exportedAt).toISOString().slice(0, 10)}-${appVersion}.txt`;
