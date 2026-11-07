/**
 * The Soulseek account a Wave account keeps (docs/spec.md, "The Soulseek
 * account"): one per account, its password encrypted with AES-GCM under a
 * Soulseek key, which only the Worker has. The account's id is the
 * encryption's additional data, so a password can't be read as another
 * account's. Nothing here logs a password or a key.
 *
 * The keys have versions, so the key can be replaced without losing the
 * passwords kept under the old one. `SOULSEEK_KEY` is version 1 and
 * `SOULSEEK_KEY_<n>` is version n; the highest version is the current key.
 * Each row records the version it was kept under, is read with that version's
 * key, and moves to the current key the next time it's read.
 */

import type { Client } from "@libsql/client";

export interface SoulseekAccount {
  readonly username: string;
  readonly password: string;
}

/** Thrown when no Soulseek key is set, or one isn't 32 bytes of base64 under a key name. */
class SoulseekKeyMissing extends Error {
  constructor(problem: string) {
    super(problem);
  }
}

/** The Soulseek keys, by version, and which one new passwords are kept under. */
export interface SoulseekKeys {
  readonly current: number;
  readonly byVersion: ReadonlyMap<number, CryptoKey>;
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

/** The version a key's secret name gives it: `SOULSEEK_KEY` is 1, `SOULSEEK_KEY_<n>` is n (2 or more). */
const keyVersion = (name: string): number | null => {
  if (name === "SOULSEEK_KEY") return 1;
  const match = /^SOULSEEK_KEY_([1-9]\d{0,5})$/.exec(name);
  const version = match === null ? null : Number(match[1]);
  return version !== null && version >= 2 ? version : null;
};

/**
 * The AES-GCM keys [secrets] hold, by secret name (`SOULSEEK_KEY`,
 * `SOULSEEK_KEY_2`, …), each base64 of 32 bytes. An error names the secret,
 * never its value.
 */
export const importSoulseekKeys = async (
  secrets: Readonly<Record<string, string>> | undefined,
): Promise<SoulseekKeys> => {
  const byVersion = new Map<number, CryptoKey>();
  for (const [name, secret] of Object.entries(secrets ?? {})) {
    const version = keyVersion(name);
    if (version === null) {
      throw new SoulseekKeyMissing(
        `${name} isn't a Soulseek key name: use SOULSEEK_KEY or SOULSEEK_KEY_<2 or more>`,
      );
    }
    const raw = fromBase64(secret.trim());
    if (raw?.byteLength !== 32) throw new SoulseekKeyMissing(`${name} isn't 32 bytes of base64`);
    byVersion.set(
      version,
      await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]),
    );
  }
  if (byVersion.size === 0) throw new SoulseekKeyMissing("SOULSEEK_KEY isn't set");
  return { current: Math.max(...byVersion.keys()), byVersion };
};

/** [password] sealed for [accountId] under [key]: base64 of the IV and the ciphertext. */
const seal = async (key: CryptoKey, accountId: string, password: string): Promise<string> => {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const sealed = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv, additionalData: new TextEncoder().encode(accountId) },
      key,
      new TextEncoder().encode(password),
    ),
  );
  const stored = new Uint8Array(IV_BYTES + sealed.byteLength);
  stored.set(iv);
  stored.set(sealed, IV_BYTES);
  return toBase64(stored);
};

/** The password [stored] seals for [accountId] under [key], or null when it doesn't open. */
const open = async (key: CryptoKey, accountId: string, stored: string): Promise<string | null> => {
  const bytes = fromBase64(stored);
  if (bytes === null || bytes.byteLength <= IV_BYTES) return null;
  try {
    const password = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: bytes.subarray(0, IV_BYTES),
        additionalData: new TextEncoder().encode(accountId),
      },
      key,
      bytes.subarray(IV_BYTES),
    );
    return new TextDecoder().decode(password);
  } catch {
    return null;
  }
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

/** Keeps [account] as [accountId]'s Soulseek account under the current key, replacing the one it had. */
export const keepSoulseekAccount = async (
  db: Client,
  keys: SoulseekKeys,
  accountId: string,
  account: SoulseekAccount,
  at: number,
): Promise<void> => {
  const password = await seal(keys.byVersion.get(keys.current)!, accountId, account.password);
  await db.execute({
    sql: `INSERT INTO soulseek_accounts (account_id, username, password, key_version, changed_at)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT (account_id) DO UPDATE SET
            username = excluded.username, password = excluded.password,
            key_version = excluded.key_version, changed_at = excluded.changed_at`,
    args: [accountId, account.username, password, keys.current, at],
  });
};

/**
 * [accountId]'s Soulseek account, or null when it has none. A password that
 * doesn't decrypt under its version's key (that key was replaced or removed)
 * counts as none, so the next phone's goes up in its place. One kept under an
 * older key moves to the current key.
 */
export const readSoulseekAccount = async (
  db: Client,
  keys: SoulseekKeys,
  accountId: string,
): Promise<SoulseekAccount | null> => {
  const row = (
    await db.execute({
      sql: "SELECT username, password, key_version FROM soulseek_accounts WHERE account_id = ?",
      args: [accountId],
    })
  ).rows[0];
  if (row === undefined) return null;
  const version = Number(row.key_version);
  const key = keys.byVersion.get(version);
  if (key === undefined) return null;
  const stored = String(row.password);
  const password = await open(key, accountId, stored);
  if (password === null) return null;
  if (version !== keys.current) {
    // Only if the row is still the one read, so a password kept meanwhile stays.
    await db.execute({
      sql: `UPDATE soulseek_accounts SET password = ?, key_version = ?
            WHERE account_id = ? AND password = ? AND key_version = ?`,
      args: [
        await seal(keys.byVersion.get(keys.current)!, accountId, password),
        keys.current,
        accountId,
        stored,
        version,
      ],
    });
  }
  return { username: String(row.username), password };
};
