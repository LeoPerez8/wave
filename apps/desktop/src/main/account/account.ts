/**
 * The Wave account on the desktop (docs/spec-desktop.md, Wave account and sync): Google's
 * sign-in in the browser traded for a session with Wave's sync service, held by main in the
 * session store and sent with the pushes and pulls the sync makes. What Settings › Accounts
 * shows is Core's (`stepWaveAccount`, `waveAccountView`); the token never reaches the renderer.
 * The phone's native module does the same (`WaveAccountClient.kt`).
 */
import {
  stepWaveAccount,
  waveAccountView,
  WAVE_ACCOUNT_SIGNED_OUT,
  type WaveAccountEvent,
  type WaveAccountState,
  type WaveAccountView,
  type WaveSession,
  type WaveSignInFailure,
} from "@wave/core";
import { BrowserSignInError, type BrowserIdentity } from "./browserSignIn.ts";
import type { SessionStore, StoredSession } from "./sessionStore.ts";

export interface WaveAccountDeps {
  readonly store: SessionStore;
  /** The sync service's origin; null when this build has none, so there's no Sign In. */
  readonly syncUrl: string | null;
  /** Google's sign-in in the browser (`signInWithBrowser`); [signal] is Cancel. */
  readonly signInWithBrowser: (signal: AbortSignal) => Promise<BrowserIdentity>;
  readonly fetch: typeof fetch;
  /** Whether the system has a network, to tell offline from a service out of reach. */
  readonly online: () => boolean;
}

/** What Settings › Accounts shows. */
export interface DesktopAccountView {
  readonly account: WaveAccountView;
  /** No keyring: the session lasts until Wave quits. */
  readonly keyringMissing: boolean;
}

/** Why a request with the session didn't go: its code is the native module's. */
export type WaveAccountErrorCode =
  | "ERR_WAVE_SIGNED_OUT"
  | "ERR_WAVE_SESSION_ENDED"
  | "ERR_WAVE_OFFLINE"
  | "ERR_WAVE_UNREACHABLE"
  | "ERR_WAVE_FORBIDDEN_REQUEST";

export class WaveAccountError extends Error {
  readonly code: WaveAccountErrorCode;
  constructor(code: WaveAccountErrorCode) {
    super(`Wave account: ${code}`);
    this.code = code;
  }
}

export interface WaveAccountService {
  readonly view: () => DesktopAccountView;
  /** Who is signed in, as the sync sees it. */
  readonly session: () => WaveSession;
  /** Hears every change of session: sign-in, sign-out and the service ending it. */
  readonly subscribe: (listener: (session: WaveSession) => void) => () => void;
  /** Opens Google's sign-in in the browser; resolves when it ended, however it did. */
  readonly signIn: () => Promise<void>;
  /** Stops the sign-in, in the browser or at the service: nobody is signed in. */
  readonly cancelSignIn: () => void;
  /** Tells the service, and forgets the session either way. */
  readonly signOut: () => Promise<void>;
  /** Ends every session of the account, this one's too. */
  readonly signOutEverywhere: () => Promise<void>;
  /** A push or a pull with the session; a 401 ends it. */
  readonly request: (
    method: "GET" | "POST",
    path: string,
    body: string | null,
  ) => Promise<{ readonly status: number; readonly body: string }>;
}

const PULL = /^\/v1\/pull(\?since=[0-9A-Za-z_-]*)?$/;

const publicSession = (stored: StoredSession | null): WaveSession =>
  stored === null
    ? { status: "signedOut" }
    : stored.status === "signedIn"
      ? { status: "signedIn", account: stored.account }
      : { status: "ended", account: stored.account };

/** What a refused `POST /v1/session` means for the owner. */
const refusal = async (response: Response): Promise<WaveSignInFailure> => {
  const answer = (await response.json().catch(() => ({}))) as { limit?: unknown };
  if (answer.limit === "maxAccounts") return "accountsFull";
  if (answer.limit === "maxNewAccountsPerDay") return "newAccountsPaused";
  if (response.status === 403) return "notAllowed";
  return "failed";
};

export const createWaveAccount = (deps: WaveAccountDeps): WaveAccountService => {
  const { store, syncUrl } = deps;
  let state: WaveAccountState = {
    ...WAVE_ACCOUNT_SIGNED_OUT,
    session: publicSession(store.load()),
  };
  const listeners = new Set<(session: WaveSession) => void>();
  let signingIn: AbortController | null = null;

  const step = (event: WaveAccountEvent): void => {
    state = stepWaveAccount(state, event);
  };
  /** Keeps [stored] and tells the listeners. */
  const change = (stored: StoredSession | null): void => {
    if (stored === null) store.clear();
    else store.save(stored);
    const session = publicSession(stored);
    step({ type: "sessionChanged", session });
    for (const listener of listeners) listener(session);
  };
  const signedIn = (): Extract<StoredSession, { status: "signedIn" }> | null => {
    const stored = store.load();
    return stored?.status === "signedIn" ? stored : null;
  };
  /** A fetch that failed before an answer: offline, or the service out of reach. */
  const unreachable = (): WaveAccountError =>
    new WaveAccountError(deps.online() ? "ERR_WAVE_UNREACHABLE" : "ERR_WAVE_OFFLINE");
  const exchange = async (
    method: string,
    url: string,
    token: string | null,
    body: string | null,
    /** Cancel, for a request the owner can back out of. */
    cancel?: AbortSignal,
  ): Promise<Response> => {
    try {
      return await deps.fetch(url, {
        method,
        redirect: "manual",
        headers: {
          ...(token === null ? {} : { authorization: `Bearer ${token}` }),
          ...(body === null ? {} : { "content-type": "application/json" }),
        },
        ...(body === null ? {} : { body }),
        signal:
          cancel === undefined
            ? AbortSignal.timeout(20_000)
            : AbortSignal.any([AbortSignal.timeout(20_000), cancel]),
      });
    } catch {
      throw unreachable();
    }
  };
  /** Ends [session] if it's still this desktop's: a sign-out and sign-in meanwhile keeps the new one. */
  const end = (session: { readonly token: string }): void => {
    const current = signedIn();
    if (current === null || current.token !== session.token) return;
    change({ status: "ended", account: current.account });
  };
  /** Sends with the session; a 401 ends it. */
  const send = async (method: string, path: string, body: string | null): Promise<Response> => {
    const session = signedIn();
    if (session === null) throw new WaveAccountError("ERR_WAVE_SIGNED_OUT");
    const response = await exchange(method, session.serviceUrl + path, session.token, body);
    if (response.status === 401) {
      end(session);
      throw new WaveAccountError("ERR_WAVE_SESSION_ENDED");
    }
    return response;
  };

  const signIn = async (): Promise<void> => {
    if (syncUrl === null || signingIn !== null || state.session.status === "signedIn") return;
    const controller = new AbortController();
    signingIn = controller;
    step({ type: "signInStarted" });
    try {
      const identity = await deps.signInWithBrowser(controller.signal);
      const response = await exchange(
        "POST",
        `${syncUrl}/v1/session`,
        null,
        JSON.stringify({ idToken: identity.idToken }),
        controller.signal,
      );
      if (controller.signal.aborted) {
        step({ type: "signInCancelled" });
        return;
      }
      if (!response.ok) {
        step({ type: "signInFailed", reason: await refusal(response) });
        return;
      }
      const answer = (await response.json().catch(() => ({}))) as {
        sessionToken?: unknown;
        email?: unknown;
      };
      if (typeof answer.sessionToken !== "string" || typeof answer.email !== "string") {
        step({ type: "signInFailed", reason: "failed" });
        return;
      }
      // Cancel while the answer was read: nothing is kept.
      if (controller.signal.aborted) {
        step({ type: "signInCancelled" });
        return;
      }
      const stored: StoredSession = {
        status: "signedIn",
        token: answer.sessionToken,
        serviceUrl: syncUrl,
        account: { email: answer.email, name: identity.name, photoUrl: identity.photoUrl },
      };
      store.save(stored);
      step({ type: "signInEnded", session: publicSession(stored) });
      for (const listener of listeners) listener(publicSession(stored));
    } catch (error) {
      if (
        controller.signal.aborted ||
        (error instanceof BrowserSignInError && error.reason === "cancelled")
      )
        step({ type: "signInCancelled" });
      else if (error instanceof WaveAccountError)
        step({
          type: "signInFailed",
          reason: error.code === "ERR_WAVE_OFFLINE" ? "offline" : "failed",
        });
      else if (error instanceof BrowserSignInError && error.reason === "network")
        step({ type: "signInFailed", reason: deps.online() ? "failed" : "offline" });
      else step({ type: "signInFailed", reason: "failed" });
    } finally {
      signingIn = null;
    }
  };

  return {
    view: () => ({
      account: waveAccountView(state, syncUrl !== null),
      keyringMissing: store.keyringMissing(),
    }),
    session: () => state.session,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    signIn,
    cancelSignIn: () => signingIn?.abort(),
    signOut: async () => {
      const session = signedIn();
      if (session !== null) {
        step({ type: "signOutStarted" });
        await exchange("DELETE", `${session.serviceUrl}/v1/session`, session.token, null).catch(
          () => {},
        );
      }
      change(null);
    },
    signOutEverywhere: async () => {
      if (signedIn() === null) return;
      step({ type: "signOutEverywhereStarted" });
      try {
        const response = await send("DELETE", "/v1/sessions", null);
        if (!response.ok) throw unreachable();
      } catch (error) {
        // Already ended: Settings shows so, as the 401 changed the session.
        if (error instanceof WaveAccountError && error.code === "ERR_WAVE_SESSION_ENDED") return;
        step({
          type: "signOutEverywhereFailed",
          reason:
            error instanceof WaveAccountError && error.code === "ERR_WAVE_OFFLINE"
              ? "offline"
              : "failed",
        });
        return;
      }
      change(null);
      step({ type: "signedOutEverywhere" });
    },
    request: async (method, path, body) => {
      const allowed =
        (method === "POST" && path === "/v1/push") || (method === "GET" && PULL.test(path));
      if (!allowed) throw new WaveAccountError("ERR_WAVE_FORBIDDEN_REQUEST");
      const response = await send(method, path, body);
      return { status: response.status, body: await response.text() };
    },
  };
};
