import assert from "node:assert/strict";
import { createCipheriv, createHash } from "node:crypto";
import { test } from "node:test";
import {
  chromiumCookieKey,
  decryptCookieV11,
  readBrowserSession,
  sessionFromCookieRows,
  type SealedCookieRow,
} from "./ytCookieSession.ts";

const IV = Buffer.alloc(16, " ");
const PASSWORD = "a-safe-storage-password";

/** Seals a value the way a Chromium browser seals a Linux `v11` cookie, for the round trip. */
const seal = (value: string, host: string, withHostHash: boolean): Buffer => {
  const key = chromiumCookieKey(PASSWORD);
  const prefix = withHostHash ? createHash("sha256").update(host).digest() : Buffer.alloc(0);
  const cipher = createCipheriv("aes-128-cbc", key, IV);
  const body = Buffer.concat([
    cipher.update(Buffer.concat([prefix, Buffer.from(value)])),
    cipher.final(),
  ]);
  return Buffer.concat([Buffer.from("v11"), body]);
};

const row = (name: string, value: string, host = ".youtube.com"): SealedCookieRow => ({
  host,
  name,
  encrypted: seal(value, host, true),
});

test("a v11 cookie decrypts back to its value, with or without the host-hash prefix", () => {
  const key = chromiumCookieKey(PASSWORD);
  const host = ".youtube.com";
  assert.equal(decryptCookieV11(seal("SECRET123", host, true), key, host), "SECRET123");
  assert.equal(decryptCookieV11(seal("SECRET123", host, false), key, host), "SECRET123");
});

test("decryptCookieV11 returns null for a value that is not v11 or will not decrypt", () => {
  const key = chromiumCookieKey(PASSWORD);
  assert.equal(decryptCookieV11(Buffer.from("v10plaintext"), key, "x"), null);
  assert.equal(decryptCookieV11(Buffer.from("v11"), key, "x"), null);
  // A wrong key leaves the AES-CBC padding invalid, so the decrypt fails rather than returning junk.
  assert.equal(decryptCookieV11(seal("value", "h", true), chromiumCookieKey("wrong"), "h"), null);
});

test("a store with a session cookie yields a signed-in session; the header carries the cookies", () => {
  const session = sessionFromCookieRows(
    [row("SAPISID", "api-sid"), row("__Secure-3PSID", "psid")],
    PASSWORD,
  );
  assert.equal(session?.kind, "signedIn");
  assert.equal(session?.dataSyncId, null);
  assert.equal(session?.sessionIndex, "0");
  assert.match(session?.cookie ?? "", /SAPISID=api-sid/);
  assert.match(session?.cookie ?? "", /__Secure-3PSID=psid/);
});

test("a store with no session cookie yields null", () => {
  assert.equal(sessionFromCookieRows([row("__Secure-3PSID", "psid")], PASSWORD), null);
  assert.equal(sessionFromCookieRows([], PASSWORD), null);
});

test("readBrowserSession falls back (null) when the store or the keyring secret is missing", () => {
  assert.equal(readBrowserSession({ readCookieRows: () => null, secret: () => PASSWORD }), null);
  assert.equal(
    readBrowserSession({ readCookieRows: () => [row("SAPISID", "x")], secret: () => null }),
    null,
  );
});

test("readBrowserSession reuses the session when the store carries one", () => {
  const session = readBrowserSession({
    readCookieRows: () => [row("SAPISID", "api-sid")],
    secret: () => PASSWORD,
  });
  assert.equal(session?.kind, "signedIn");
  assert.match(session?.cookie ?? "", /SAPISID=api-sid/);
});

test("readBrowserSession swallows a throwing reader or secret and falls back", () => {
  assert.equal(
    readBrowserSession({
      readCookieRows: () => {
        throw new Error("locked");
      },
      secret: () => PASSWORD,
    }),
    null,
  );
  assert.equal(
    readBrowserSession({
      readCookieRows: () => [row("SAPISID", "x")],
      secret: () => {
        throw new Error("no keyring");
      },
    }),
    null,
  );
});
