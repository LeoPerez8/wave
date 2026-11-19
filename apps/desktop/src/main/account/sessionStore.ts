/**
 * Where the Wave session lives (docs/spec-desktop.md, Security): encrypted with Electron's
 * `safeStorage` in a file of the data folder, read only by the main process. Without a keyring
 * (Linux with no Secret Service) it lives in memory until Wave quits and nothing is written:
 * never plain text.
 */
import type { WaveAccount } from "@wave/core";

/** The session as main holds it; the token never leaves main. */
export type StoredSession =
  | {
      readonly status: "signedIn";
      readonly token: string;
      /** The service that gave the token: it goes nowhere else. */
      readonly serviceUrl: string;
      readonly account: WaveAccount;
    }
  /** The service ended it (a 401): kept so Settings can say so after a restart. */
  | { readonly status: "ended"; readonly account: WaveAccount | null };

/** The part of Electron's `safeStorage` the store uses. */
export interface SecretBox {
  readonly isEncryptionAvailable: () => boolean;
  readonly encryptString: (text: string) => Buffer;
  readonly decryptString: (bytes: Buffer) => string;
  /** Linux only: which secret store Chromium picked. */
  readonly getSelectedStorageBackend?: () => string;
}

export interface SessionFiles {
  readonly read: (path: string) => Buffer | undefined;
  readonly write: (path: string, bytes: Buffer) => void;
  readonly remove: (path: string) => void;
}

export type SessionStore = SealedStore<StoredSession>;

/** Chromium's Linux backends that store in plain text or found none. */
export const NO_KEYRING: ReadonlySet<string> = new Set(["basic_text", "unknown"]);

const parsed = (text: string): StoredSession | null => {
  try {
    const value = JSON.parse(text) as Partial<{
      status: unknown;
      token: unknown;
      serviceUrl: unknown;
      account: unknown;
    }>;
    const account = value.account as WaveAccount | null | undefined;
    const validAccount =
      typeof account === "object" && account !== null && typeof account.email === "string";
    if (
      value.status === "signedIn" &&
      typeof value.token === "string" &&
      typeof value.serviceUrl === "string" &&
      validAccount
    )
      return { status: "signedIn", token: value.token, serviceUrl: value.serviceUrl, account };
    if (value.status === "ended")
      return { status: "ended", account: validAccount ? account : null };
  } catch {
    // Not a session.
  }
  return null;
};

/** What `sealedStore` keeps: one value, sealed by the keyring or in memory without one. */
export interface SealedStore<T> {
  /** True when the system has no keyring, so the value stays in memory only. */
  readonly keyringMissing: () => boolean;
  readonly load: () => T | null;
  readonly save: (value: T) => void;
  readonly clear: () => void;
}

/**
 * A value kept as JSON in [file], sealed by [box]; [parse] reads it back, null for anything that
 * isn't one. Without a keyring it is held in memory and nothing is written.
 */
export const sealedStore = <T>({
  box,
  file,
  files,
  platform,
  parse,
}: {
  readonly box: SecretBox;
  readonly file: string;
  readonly files: SessionFiles;
  readonly platform: NodeJS.Platform;
  readonly parse: (text: string) => T | null;
}): SealedStore<T> => {
  // Asked lazily: safeStorage answers only once the app is ready.
  const keyringMissing = () =>
    !box.isEncryptionAvailable() ||
    (platform === "linux" && NO_KEYRING.has(box.getSelectedStorageBackend?.() ?? "unknown"));
  /** The value while there is no keyring. */
  let inMemory: T | null = null;
  return {
    keyringMissing,
    load: () => {
      if (keyringMissing()) return inMemory;
      const bytes = files.read(file);
      if (bytes === undefined) return null;
      try {
        return parse(box.decryptString(bytes));
      } catch {
        return null;
      }
    },
    save: (value) => {
      if (keyringMissing()) {
        inMemory = value;
        return;
      }
      files.write(file, box.encryptString(JSON.stringify(value)));
    },
    clear: () => {
      inMemory = null;
      files.remove(file);
    },
  };
};

export const sessionStore = (options: {
  readonly box: SecretBox;
  readonly file: string;
  readonly files: SessionFiles;
  readonly platform: NodeJS.Platform;
}): SessionStore => sealedStore({ ...options, parse: parsed });
