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

/** How deep an object's JSON goes; an object or array nested deeper shows as `{…}` or `[…]`. */
const MAX_JSON_DEPTH = 8;

/** JSON written up to `limit` characters; `full` once something didn't fit. */
interface JsonOut {
  text: string;
  readonly limit: number;
  full: boolean;
}

const put = (out: JsonOut, text: string): void => {
  if (out.full) return;
  const room = out.limit - out.text.length;
  if (text.length > room) {
    out.text += text.slice(0, room);
    out.full = true;
  } else {
    out.text += text;
  }
};

/** What JSON.stringify writes for `value`: its `toJSON()`, a boxed primitive's value. */
const jsonValue = (value: unknown, key: string): unknown => {
  if (typeof value !== "object" || value === null) return value;
  const toJSON: unknown = (value as { toJSON?: unknown }).toJSON;
  if (typeof toJSON === "function") return jsonValue(toJSON.call(value, key), key);
  if (value instanceof Number || value instanceof String || value instanceof Boolean) {
    return value.valueOf();
  }
  return value;
};

/** What JSON.stringify leaves out of an object (and writes as `null` in an array). */
const leftOut = (value: unknown): boolean =>
  value === undefined || typeof value === "function" || typeof value === "symbol";

/**
 * Writes `value` (already through `jsonValue`) as JSON.stringify would, with a
 * bigint as a string and an object inside itself as `"[circular]"`, and stops
 * reading it once `out` is full.
 */
const putJson = (out: JsonOut, value: unknown, parents: object[]): void => {
  if (out.full) return;
  if (value === null || leftOut(value)) return put(out, "null");
  if (typeof value === "string") return put(out, JSON.stringify(value.slice(0, out.limit)));
  if (typeof value === "number") return put(out, Number.isFinite(value) ? String(value) : "null");
  if (typeof value === "bigint") return put(out, `"${value.toString()}"`);
  if (typeof value !== "object") return put(out, String(value));
  if (parents.includes(value)) return put(out, '"[circular]"');
  const isArray = Array.isArray(value);
  if (parents.length >= MAX_JSON_DEPTH) return put(out, isArray ? "[…]" : "{…}");
  parents.push(value);
  if (isArray) {
    put(out, "[");
    for (let i = 0; i < value.length && !out.full; i++) {
      if (i > 0) put(out, ",");
      putJson(out, jsonValue(value[i], String(i)), parents);
    }
    put(out, "]");
  } else {
    put(out, "{");
    let first = true;
    for (const key in value) {
      if (out.full) break;
      if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
      const inner = jsonValue((value as Record<string, unknown>)[key], key);
      if (leftOut(inner)) continue;
      put(out, `${first ? "" : ","}${JSON.stringify(key)}:`);
      first = false;
      putJson(out, inner, parents);
    }
    put(out, "}");
  }
  parents.pop();
};

/**
 * `value` as JSON, at most `limit` characters of it: it's read only as far as
 * that, so a huge object costs no more than a small one. `complete` is false
 * when it was cut.
 */
const toJson = (value: object, limit: number): { text: string; complete: boolean } => {
  const out: JsonOut = { text: "", limit, full: false };
  try {
    const resolved = jsonValue(value, "");
    if (leftOut(resolved)) return { text: String(value), complete: true };
    putJson(out, resolved, []);
    return { text: out.text, complete: !out.full };
  } catch {
    return { text: String(value), complete: true };
  }
};

const isJsonObject = (value: unknown): value is object =>
  typeof value === "object" && value !== null && !(value instanceof Error);

const describeValue = (value: unknown): string => {
  if (typeof value === "string") return value;
  if (value instanceof Error) return describeError(value, 0);
  if (isJsonObject(value)) return toJson(value, MAX_MESSAGE_CHARS + 1).text;
  if (typeof value === "function") return `[function ${value.name || "anonymous"}]`;
  return String(value);
};

const WAVE_PREFIX = "[wave] ";

/**
 * The message for what a `console.warn` or `console.error` call was given:
 * each argument described (a string as is, an error by its stack and causes,
 * an object as JSON), joined by spaces, without Wave's `[wave] ` prefix, and
 * cut short past a few thousand characters. An object is read only as far as
 * the message goes.
 */
export const describeLogArgs = (args: readonly unknown[]): string => {
  // Past this many characters, the message is cut wherever the prefix was.
  const limit = MAX_MESSAGE_CHARS + WAVE_PREFIX.length + 1;
  let message = "";
  // Characters past the limit, when every one was counted.
  let more = 0;
  let uncounted = false;
  const add = (text: string): void => {
    const room = Math.max(0, limit - message.length);
    message += text.length > room ? text.slice(0, room) : text;
    more += Math.max(0, text.length - room);
  };
  args.forEach((arg, index) => {
    if (index > 0) add(" ");
    if (!isJsonObject(arg)) return add(describeValue(arg));
    const room = limit - message.length;
    if (room <= 0) {
      uncounted = true;
      return;
    }
    const json = toJson(arg, room);
    add(json.text);
    if (!json.complete) uncounted = true;
  });
  if (message.startsWith(WAVE_PREFIX)) message = message.slice(WAVE_PREFIX.length);
  if (message.length <= MAX_MESSAGE_CHARS) return message;
  const cut = uncounted ? "cut short" : `${message.length - MAX_MESSAGE_CHARS + more} more characters`;
  return `${message.slice(0, MAX_MESSAGE_CHARS)}… (${cut})`;
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
