/**
 * Where the YouTube session lives on the desktop (docs/spec-desktop.md, Security): with main,
 * sealed by the system's keyring through Electron's `safeStorage`, and in memory until Wave quits
 * when there is no keyring. The JVM signs YT Music's requests with it but writes it nowhere: it
 * asks main for it when it starts (`ytSession.load`) and hands over each change
 * (`ytSession.save`), as `HostSessionStore` does on its side. The window never gets it.
 */
import type { YtAccount, YtSession } from "@wave/core";
import { sealedStore, type SealedStore, type SessionFiles } from "../account/sessionStore.ts";
import type { SecretBox } from "../account/sessionStore.ts";
import type { HostMethods } from "../kotlin/protocol.ts";

/**
 * The session as the JVM encodes it (`YtSessionJson`): `{cookie, dataSyncId, authUser, account}`
 * signed in, `{expired, account}` once YouTube stopped accepting it. Main reads only who it is.
 */
export type StoredYtSession = Readonly<Record<string, unknown>>;

export type YtSessionStore = SealedStore<StoredYtSession>;

/** The account in a session, as the JVM writes it (`YtAccountInfo.toMap`). */
export const readYtAccount = (value: unknown): YtAccount | null => {
  if (typeof value !== "object" || value === null) return null;
  const { name, email, photoUrl } = value as Record<string, unknown>;
  if (typeof name !== "string") return null;
  return {
    name,
    email: typeof email === "string" ? email : null,
    photoUrl: typeof photoUrl === "string" ? photoUrl : null,
  };
};

/** [value] when it is a session the JVM encoded, else null. */
const stored = (value: unknown): StoredYtSession | null => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const session = value as StoredYtSession;
  if (session["expired"] === true) return session;
  return typeof session["cookie"] === "string" && readYtAccount(session["account"]) !== null
    ? session
    : null;
};

/** Who [session] is signed in as, without its credentials. */
export const ytSessionOf = (session: StoredYtSession | null): YtSession => {
  if (session === null) return { status: "signedOut" };
  const account = readYtAccount(session["account"]);
  if (session["expired"] === true) return { status: "expired", account };
  return account === null ? { status: "signedOut" } : { status: "signedIn", account };
};

export const ytSessionStore = (options: {
  readonly box: SecretBox;
  readonly file: string;
  readonly files: SessionFiles;
  readonly platform: NodeJS.Platform;
}): YtSessionStore =>
  sealedStore({
    ...options,
    parse: (text) => stored(JSON.parse(text) as unknown),
  });

export interface YtSessions {
  /** What the JVM asks main: the kept session, and to keep a new one. */
  readonly host: HostMethods;
  /** Who is signed in, as kept. */
  readonly session: () => YtSession;
  readonly keyringMissing: () => boolean;
  /** Forgets the session without the JVM, for when it can't be asked to. */
  readonly forget: () => void;
  /** Hears each session the JVM hands over. */
  readonly subscribe: (listener: (session: YtSession) => void) => () => void;
}

/** The kept YouTube session, between the JVM that uses it and the account in Settings. */
export const createYtSessions = (store: YtSessionStore): YtSessions => {
  const listeners = new Set<(session: YtSession) => void>();
  const changed = () => {
    const session = ytSessionOf(store.load());
    for (const listener of listeners) listener(session);
  };
  return {
    host: {
      "ytSession.load": async () => ({ session: store.load() }),
      "ytSession.save": async (params) => {
        const session = (params as { session?: unknown } | null)?.session ?? null;
        if (session === null) store.clear();
        else {
          const valid = stored(session);
          if (valid === null) throw new Error("Expected { session: a YouTube session or null }");
          store.save(valid);
        }
        changed();
        return null;
      },
    },
    session: () => ytSessionOf(store.load()),
    keyringMissing: store.keyringMissing,
    forget: () => {
      store.clear();
      changed();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
};
