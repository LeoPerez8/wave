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

export interface SessionStore {
  /** True when the system has no keyring, so the session stays in memory only. */
  readonly keyringMissing: () => boolean;
  readonly load: () => StoredSession | null;
  readonly save: (session: StoredSession) => void;
  readonly clear: () => void;
}

/** Chromium's Linux backends that store in plain text or found none. */
const NO_KEYRING = new Set(["basic_text", "unknown"]);

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

export const sessionStore = ({
  box,
  file,
  files,
  platform,
}: {
  readonly box: SecretBox;
  readonly file: string;
  readonly files: SessionFiles;
  readonly platform: NodeJS.Platform;
}): SessionStore => {
  // Asked lazily: safeStorage answers only once the app is ready.
  const keyringMissing = () =>
    !box.isEncryptionAvailable() ||
    (platform === "linux" && NO_KEYRING.has(box.getSelectedStorageBackend?.() ?? "unknown"));
  /** The session while there is no keyring. */
  let inMemory: StoredSession | null = null;
  return {
    keyringMissing,
    load: () => {
      if (keyringMissing()) return inMemory;
      const bytes = files.read(file);
      if (bytes === undefined) return null;
      try {
        return parsed(box.decryptString(bytes));
      } catch {
        return null;
      }
    },
    save: (session) => {
      if (keyringMissing()) {
        inMemory = session;
        return;
      }
      files.write(file, box.encryptString(JSON.stringify(session)));
    },
    clear: () => {
      inMemory = null;
      files.remove(file);
    },
  };
};
