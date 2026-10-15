/**
 * The Soulseek account a Wave account keeps (docs/spec.md, "The Soulseek
 * account"): one per account, its password encrypted with AES-GCM under
 * `SOULSEEK_KEY`, which only the Worker has. The account's id is the
 * encryption's additional data, so a password can't be read as another
 * account's. Nothing here logs a password.
 */

import type { Client } from "@libsql/client";

export interface SoulseekAccount {
  readonly username: string;
  readonly password: string;
}

/** Thrown when `SOULSEEK_KEY` is missing or isn't 32 bytes of base64. */
class SoulseekKeyMissing extends Error {
  constructor() {
    super("SOULSEEK_KEY isn't set to 32 bytes of base64");
  }
}

const IV_BYTES = 12;

const toBase64 = (bytes: Uint8Array): string => btoa(String.fromCharCode(...bytes));

const fromBase64 = (text: string): Uint8Array<ArrayBuffer> | null => {
  try {
    return Uint8Array.from(atob(text), (char) => char.charCodeAt(0));
  } catch {
    return null;
  }
};

/** The AES-GCM key `SOULSEEK_KEY` (base64 of 32 bytes) holds. */
export const importSoulseekKey = async (secret: string | undefined): Promise<CryptoKey> => {
  const raw = fromBase64((secret ?? "").trim());
  if (raw?.byteLength !== 32) throw new SoulseekKeyMissing();
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
};

/** A username and password Soulseek could log in with, as the app checks them before it does. */
export const parseSoulseekAccount = (body: unknown): SoulseekAccount | null => {
  if (typeof body !== "object" || body === null) return null;
  const { username, password } = body as Record<string, unknown>;
  if (typeof username !== "string" || typeof password !== "string") return null;
  const usernameOk =
    username.length > 0 &&
    username.length <= 30 &&
    username.trim() === username &&
    /^[\x20-\x7e]+$/.test(username);
  const passwordOk = password.length > 0 && password.length <= 1024;
  return usernameOk && passwordOk ? { username, password } : null;
};

/** Keeps [account] as [accountId]'s Soulseek account, replacing the one it had. */
export const keepSoulseekAccount = async (
  db: Client,
  key: CryptoKey,
  accountId: string,
  account: SoulseekAccount,
  at: number,
): Promise<void> => {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const sealed = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv, additionalData: new TextEncoder().encode(accountId) },
      key,
      new TextEncoder().encode(account.password),
    ),
  );
  const stored = new Uint8Array(IV_BYTES + sealed.byteLength);
  stored.set(iv);
  stored.set(sealed, IV_BYTES);
  await db.execute({
    sql: `INSERT INTO soulseek_accounts (account_id, username, password, changed_at)
          VALUES (?, ?, ?, ?)
          ON CONFLICT (account_id) DO UPDATE SET
            username = excluded.username, password = excluded.password, changed_at = excluded.changed_at`,
    args: [accountId, account.username, toBase64(stored), at],
  });
};

/**
 * [accountId]'s Soulseek account, or null when it has none. A password that
 * doesn't decrypt under [key] (the key was replaced) counts as none, so the
 * next phone's goes up in its place.
 */
export const readSoulseekAccount = async (
  db: Client,
  key: CryptoKey,
  accountId: string,
): Promise<SoulseekAccount | null> => {
  const row = (
    await db.execute({
      sql: "SELECT username, password FROM soulseek_accounts WHERE account_id = ?",
      args: [accountId],
    })
  ).rows[0];
  if (row === undefined) return null;
  const stored = fromBase64(String(row.password));
  if (stored === null || stored.byteLength <= IV_BYTES) return null;
  try {
    const password = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: stored.subarray(0, IV_BYTES),
        additionalData: new TextEncoder().encode(accountId),
      },
      key,
      stored.subarray(IV_BYTES),
    );
    return { username: String(row.username), password: new TextDecoder().decode(password) };
  } catch {
    return null;
  }
};
