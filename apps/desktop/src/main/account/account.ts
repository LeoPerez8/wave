/**
 * The Wave account on the desktop (docs/spec-desktop.md, Wave account and sync): Google's
 * sign-in in the browser traded for a session with Wave's sync service, held by main in the
 * session store and sent with the pushes and pulls the sync makes. What Settings › Accounts
 * shows is Core's (`stepWaveAccount`, `waveAccountView`); the token never reaches the renderer.
 * The phone's native module does the same (`WaveAccountClient.kt`).
 */
import {
  geniusUpstreamUrl,
  isCollaborationRequest,
  stepWaveAccount,
  ticketmasterUpstreamUrl,
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

/** Why the browser opens Google's sign-in: to sign in, or as Delete Account's fresh sign-in. */
export type BrowserSignInPurpose = "signIn" | "confirmDeletion";

export interface WaveAccountDeps {
  readonly store: SessionStore;
  /** The sync service's origin; null when this build has none, so there's no Sign In. */
  readonly syncUrl: string | null;
  /**
   * Google's sign-in in the browser (`signInWithBrowser`); [signal] is Cancel, and [purpose]
   * is what the tab says Wave finishes.
   */
  readonly signInWithBrowser: (
    signal: AbortSignal,
    purpose: BrowserSignInPurpose,
  ) => Promise<BrowserIdentity>;
  readonly fetch: typeof fetch;
  /** Whether the system has a network, to tell offline from a service out of reach. */
  readonly online: () => boolean;
}

/** What Settings › Accounts shows. */
export interface DesktopAccountView {
  readonly account: WaveAccountView;
  /** No keyring: the session lasts until Wave quits. */
  readonly keyringMissing: boolean;
  /** Delete Account's request went to the service: Cancel no longer stops it. */
  readonly deletionSent: boolean;
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
  /**
   * Stops waiting for Google's sign-in in the browser. For Sign In, also at the service: nobody
   * is signed in. For Delete Account: nothing is sent.
   */
  readonly cancelSignIn: () => void;
  /** Tells the service, and forgets the session either way. */
  readonly signOut: () => Promise<void>;
  /** Ends every session of the account, this one's too. */
  readonly signOutEverywhere: () => Promise<void>;
  /**
   * Deletes the account and everything the service has of it, then signs out; the computer
   * keeps its own. The service needs a fresh Google sign-in to the account's own Google
   * account besides the session, so the browser opens first; one the service doesn't take
   * keeps the account and the session. Resolves when it ended, however it did.
   */
  readonly deleteAccount: () => Promise<void>;
  /**
   * A push, pull, supported provider request or collaborative playlist's request (Core's
   * `isCollaborationRequest`) with the session; a 401 ends it.
   */
  readonly request: (
    method: "GET" | "POST" | "PUT" | "DELETE",
    path: string,
    body: string | null,
    signal?: AbortSignal,
  ) => Promise<{ readonly status: number; readonly body: string }>;
}

/** The service's 401s for Delete Account's ID token, not for the session. */
const ID_TOKEN_REFUSALS: ReadonlySet<unknown> = new Set(["invalid_id_token", "id_token_required"]);

const refusesIdToken = async (response: Response): Promise<boolean> => {
  const answer = (await response.json().catch(() => ({}))) as { error?: unknown } | null;
  return ID_TOKEN_REFUSALS.has(answer?.error);
};

const PULL = /^\/v1\/pull(\?since=[0-9A-Za-z_-]*)?$/;
/** A show check's request, exactly as the service's Ticketmaster routes take it. */
const ticketmaster = (path: string): boolean => {
  const at = path.indexOf("?");
  if (at < 0 || path.includes("#")) return false;
  return (
    ticketmasterUpstreamUrl(path.slice(0, at), new URLSearchParams(path.slice(at + 1))) !== null
  );
};

/** Genius's fixed routes, with the same parameters the Worker validates. */
const genius = (path: string): boolean => {
  const at = path.indexOf("?");
  return (
    at >= 0 &&
    !path.includes("#") &&
    geniusUpstreamUrl(path.slice(0, at), new URLSearchParams(path.slice(at + 1))) !== null
  );
};

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
  /** Delete Account waiting for Google's sign-in in the browser. */
  let confirmingDeletion: AbortController | null = null;
  /** Delete Account sent its request and waits for the answer. */
  let deletionSent = false;

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
  const send = async (
    method: string,
    path: string,
    body: string | null,
    signal?: AbortSignal,
  ): Promise<Response> => {
    const session = signedIn();
    if (session === null) throw new WaveAccountError("ERR_WAVE_SIGNED_OUT");
    const response = await exchange(method, session.serviceUrl + path, session.token, body, signal);
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
      const identity = await deps.signInWithBrowser(controller.signal, "signIn");
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
      deletionSent,
    }),
    session: () => state.session,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    signIn,
    cancelSignIn: () => {
      signingIn?.abort();
      confirmingDeletion?.abort();
    },
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
    deleteAccount: async () => {
      const session = signedIn();
      if (session === null || state.busy !== null) return;
      const controller = new AbortController();
      confirmingDeletion = controller;
      step({ type: "deleteStarted" });
      try {
        const identity = await deps.signInWithBrowser(controller.signal, "confirmDeletion");
        // From here the request is on its way: Cancel no longer stops it.
        confirmingDeletion = null;
        if (controller.signal.aborted || signedIn()?.token !== session.token) {
          step({ type: "deleteCancelled" });
          return;
        }
        deletionSent = true;
        const response = await exchange(
          "DELETE",
          `${session.serviceUrl}/v1/account`,
          session.token,
          JSON.stringify({ idToken: identity.idToken }),
        );
        if (response.status === 401) {
          if (await refusesIdToken(response))
            step({ type: "deleteFailed", reason: "wrongGoogleAccount" });
          // Already ended: Settings shows so.
          else end(session);
          return;
        }
        if (!response.ok) throw unreachable();
      } catch (error) {
        if (
          controller.signal.aborted ||
          (error instanceof BrowserSignInError && error.reason === "cancelled")
        )
          step({ type: "deleteCancelled" });
        else if (error instanceof BrowserSignInError && error.reason === "network")
          step({ type: "deleteFailed", reason: deps.online() ? "failed" : "offline" });
        else
          step({
            type: "deleteFailed",
            reason:
              error instanceof WaveAccountError && error.code === "ERR_WAVE_OFFLINE"
                ? "offline"
                : "failed",
          });
        return;
      } finally {
        confirmingDeletion = null;
        deletionSent = false;
      }
      change(null);
      step({ type: "accountDeleted" });
    },
    request: async (method, path, body, signal) => {
      const allowed =
        (method === "POST" && path === "/v1/push") ||
        (method === "GET" &&
          (PULL.test(path) || ticketmaster(path) || (body === null && genius(path)))) ||
        isCollaborationRequest(method, path);
      if (!allowed) throw new WaveAccountError("ERR_WAVE_FORBIDDEN_REQUEST");
      const response = await send(method, path, body, signal);
      return { status: response.status, body: await response.text() };
    },
  };
};
