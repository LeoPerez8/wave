/**
 * Reading an existing YouTube session straight from the default browser's cookie store, so Sign In
 * can skip the window when the owner is already signed in to Google there (docs/spec-desktop.md,
 * Sign-in). Linux only: the cookies are sealed with a key from the system keyring (Secret Service),
 * the same `v11` AES-128-CBC scheme every Chromium browser uses. When anything here does not line
 * up — no browser, no keyring secret, a locked or absent store, or a store with no signed-in
 * session — it yields null and the caller falls back to the browser-window sign-in. It never widens
 * what the window flow already does; it only saves a step when it safely can.
 *
 * The impure parts (reading the cookie rows and the keyring secret) are passed in, so the tests run
 * with neither a browser nor a keyring.
 */
import { createDecipheriv, createHash, pbkdf2Sync } from "node:crypto";
import {
  forYtMusic,
  isSignedIn,
  ytCookieHeader,
  type CdpCookie,
  type YtBrowserOutcome,
} from "./ytBrowserSignIn.ts";

/** A signed-in outcome, the shape `ytAccount` hands to the JVM. */
export type SignedInSession = Extract<YtBrowserOutcome, { readonly kind: "signedIn" }>;

/** Chromium's fixed key-derivation for Linux `v11` cookies: PBKDF2(SHA-1, 1 round, 16 bytes). */
const SALT = "saltysalt";
/** Chromium's fixed CBC initialisation vector: sixteen spaces. */
const IV = Buffer.alloc(16, " ");
/** The marker a Linux keyring-sealed cookie value starts with. */
const V11 = Buffer.from("v11");

/** The AES-128 key Chromium derives from a browser's "Safe Storage" keyring password. */
export const chromiumCookieKey = (password: string): Buffer =>
  pbkdf2Sync(password, SALT, 1, 16, "sha1");

/**
 * One `v11` cookie value decrypted with [key], or null when it is not `v11` or will not decrypt.
 * Recent Chromium prepends the SHA-256 of the cookie's host to the plaintext; that is dropped when
 * it is there, so both the old and the new layout read correctly.
 */
export const decryptCookieV11 = (encrypted: Buffer, key: Buffer, host: string): string | null => {
  if (encrypted.length <= V11.length || !encrypted.subarray(0, V11.length).equals(V11)) return null;
  try {
    const decipher = createDecipheriv("aes-128-cbc", key, IV);
    let plain = Buffer.concat([decipher.update(encrypted.subarray(V11.length)), decipher.final()]);
    const hostHash = createHash("sha256").update(host).digest();
    if (plain.length >= hostHash.length && plain.subarray(0, hostHash.length).equals(hostHash))
      plain = plain.subarray(hostHash.length);
    return plain.toString("utf8");
  } catch {
    return null;
  }
};

/** One row of the browser's `cookies` table, with the value still sealed. */
export interface SealedCookieRow {
  readonly host: string;
  readonly name: string;
  readonly encrypted: Buffer;
}

/**
 * The signed-in session the browser's cookies carry, or null when they decrypt to no YouTube Music
 * session. [secret] is the browser's "Safe Storage" keyring password; the key is derived once.
 */
export const sessionFromCookieRows = (
  rows: readonly SealedCookieRow[],
  secret: string,
): SignedInSession | null => {
  const key = chromiumCookieKey(secret);
  const cookies: CdpCookie[] = [];
  for (const row of rows) {
    const value = decryptCookieV11(row.encrypted, key, row.host);
    if (value !== null) cookies.push({ name: row.name, value, domain: row.host });
  }
  if (!isSignedIn(cookies)) return null;
  return {
    kind: "signedIn",
    cookie: ytCookieHeader(cookies),
    // A cookie-only read has no page config; the account and channel stay at their defaults, which
    // limits multi-account and playlist writes until a full sign-in replaces them.
    dataSyncId: null,
    sessionIndex: "0",
  };
};

export interface BrowserSessionDeps {
  /** The YouTube/Google cookie rows of the default browser's store, or null when it cannot be read
   *  (no such browser, a locked or missing store, or a platform without this path). */
  readonly readCookieRows: () => readonly SealedCookieRow[] | null;
  /** The browser's "Safe Storage" keyring password, or null when the keyring has none for it. */
  readonly secret: () => string | null;
  readonly log?: (line: string) => void;
}

/**
 * The existing signed-in session read from the default browser, or null to fall back to the sign-in
 * window. Only the count of cookies and whether a session was found reach the log, never a value.
 */
export const readBrowserSession = (deps: BrowserSessionDeps): SignedInSession | null => {
  const log = deps.log ?? (() => {});
  let rows: readonly SealedCookieRow[] | null;
  try {
    rows = deps.readCookieRows();
  } catch {
    rows = null;
  }
  if (rows === null) return null;
  const relevant = rows.filter((row) =>
    forYtMusic({ name: row.name, value: "", domain: row.host }),
  );
  let secret: string | null;
  try {
    secret = deps.secret();
  } catch {
    secret = null;
  }
  if (secret === null) {
    log("YouTube sign-in: the browser's keyring secret is unavailable; opening the window");
    return null;
  }
  const session = sessionFromCookieRows(relevant, secret);
  if (session === null) {
    log(`YouTube sign-in: the browser's ${relevant.length} cookies carry no session`);
    return null;
  }
  log("YouTube sign-in: reused the browser's existing session");
  return session;
};
