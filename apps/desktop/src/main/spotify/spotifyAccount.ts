import {
  readSpotifyWebProfile,
  SPOTIFY_ACCOUNT_SIGNED_OUT,
  spotifyAccountView,
  stepSpotifyAccount,
  type SpotifyAccount as Profile,
  type SpotifySession,
} from "@wave/core";
import type { SpotifyAccountPanel } from "../../shared/spotifyAccount.ts";
import { BrowserSignInError, exchangeBrowserCode } from "../account/browserSignIn.ts";
import { sealedStore } from "../account/sessionStore.ts";
import { readRemoteImage } from "../library/remoteImage.ts";

const AUTH_URL = "https://accounts.spotify.com/authorize";
const TOKEN_URL = "https://accounts.spotify.com/api/token";
const API_ORIGIN = "https://api.spotify.com";
const PROFILE_PATH = "/v1/me";
const REQUEST_TIMEOUT = 15_000;
const PHOTO_HOSTS = new Set(["i.scdn.co", "image-cdn-ak.spotifycdn.com"]);

// Current profile, Liked Songs and playlists for import, and writing a shared playlist.
const SCOPES = [
  "user-read-private",
  "user-library-read",
  "playlist-read-private",
  "playlist-read-collaborative",
  "playlist-modify-public",
  "playlist-modify-private",
].join(" ");

interface Tokens {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresAt: number;
}

interface SignedIn {
  readonly status: "signedIn";
  readonly clientId: string;
  readonly tokens: Tokens;
  readonly account: Profile;
}

type StoredSession = SignedIn | { readonly status: "expired" };

const nonempty = (value: unknown): value is string => typeof value === "string" && value !== "";

export const spotifySessionStore = (options: Omit<Parameters<typeof sealedStore>[0], "parse">) =>
  sealedStore<StoredSession>({
    ...options,
    parse: (text) => {
      const value = JSON.parse(text) as Partial<SignedIn> | { status: "expired" } | null;
      if (value?.status === "expired") return { status: "expired" };
      if (
        value?.status !== "signedIn" ||
        !nonempty(value.clientId) ||
        !nonempty(value.tokens?.accessToken) ||
        !nonempty(value.tokens?.refreshToken) ||
        !Number.isFinite(value.tokens?.expiresAt) ||
        !nonempty(value.account?.name) ||
        !(value.account.photoUrl === null || nonempty(value.account.photoUrl))
      )
        return null;
      const { clientId, tokens, account } = value;
      return {
        status: "signedIn",
        clientId,
        tokens,
        account: { name: account.name, photoUrl: account.photoUrl },
      };
    },
  });

interface Options {
  readonly clientId: string | null;
  readonly store: ReturnType<typeof spotifySessionStore>;
  readonly fetch: typeof fetch;
  readonly openExternal: (url: string) => Promise<void>;
  readonly online: () => boolean;
  readonly now?: () => number;
  readonly page: () => { readonly title: string; readonly message: string };
}

const deadline = (signal?: AbortSignal) => {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT);
  return signal === undefined ? timeout : AbortSignal.any([signal, timeout]);
};

const json = (response: Response): Promise<unknown> => response.json().catch(() => null);

const readTokens = (value: unknown, now: number, previousRefresh?: string): Tokens | null => {
  const answer = value as {
    access_token?: unknown;
    refresh_token?: unknown;
    expires_in?: unknown;
  } | null;
  const refreshToken = answer?.refresh_token ?? previousRefresh;
  if (
    !nonempty(answer?.access_token) ||
    !nonempty(refreshToken) ||
    typeof answer.expires_in !== "number" ||
    !Number.isFinite(answer.expires_in) ||
    answer.expires_in <= 0
  )
    return null;
  return {
    accessToken: answer.access_token,
    refreshToken,
    expiresAt: now + answer.expires_in * 1_000,
  };
};

/** Only replayable request bodies, so a 401 can be retried once with fresh authorization. */
export type SpotifyRequestInit = Pick<RequestInit, "method" | "headers" | "signal"> & {
  readonly body?: string;
};

/** Provider HTTP errors other than 401 are returned to the caller as ordinary responses. */
export type SpotifyRequest =
  | { readonly status: "response"; readonly response: Response }
  | { readonly status: "signedOut" | "expired" | "offline" | "failed" };

export interface SpotifyAccountService {
  readonly view: () => SpotifyAccountPanel;
  readonly session: () => SpotifySession;
  readonly signIn: () => Promise<void>;
  readonly cancelSignIn: () => void;
  readonly signOut: () => void;
  readonly check: () => Promise<void>;
  readonly photo: () => Promise<string | null>;
  /** Sends an authorized request to a /v1/ path on Spotify's Web API. Main only. */
  readonly request: (path: string, init?: SpotifyRequestInit) => Promise<SpotifyRequest>;
  readonly dispose: () => void;
}

const sessionOf = (stored: StoredSession | null): SpotifySession =>
  stored?.status === "signedIn"
    ? { status: "signedIn", account: stored.account }
    : stored?.status === "expired"
      ? { status: "expired", account: null }
      : { status: "signedOut" };

const apiFetch = (
  fetch: typeof globalThis.fetch,
  url: URL,
  tokens: Tokens,
  init?: SpotifyRequestInit,
) => {
  const headers = new Headers(init?.headers);
  headers.set("authorization", `Bearer ${tokens.accessToken}`);
  return fetch(url, {
    ...init,
    headers,
    redirect: "error",
    signal: deadline(init?.signal ?? undefined),
  });
};

/** Spotify's session in main. The renderer only sees Core's account view and the photo. */
export const createSpotifyAccount = (options: Options): SpotifyAccountService => {
  const { clientId, fetch, online, store } = options;
  const now = options.now ?? Date.now;
  const saved = clientId === null ? null : store.load();
  let stored = saved?.status === "signedIn" && saved.clientId !== clientId ? null : saved;
  let state = { ...SPOTIFY_ACCOUNT_SIGNED_OUT, session: sessionOf(stored) };
  let attempt: AbortController | undefined;
  let generation = 0;
  let refreshing:
    { readonly tokens: Tokens; readonly result: Promise<"ok" | "offline" | "failed"> } | undefined;

  const expire = () => {
    stored = { status: "expired" };
    generation++;
    state = stepSpotifyAccount(state, { type: "sessionChanged", session: sessionOf(stored) });
    store.clear();
    store.save(stored);
  };

  const refresh = (current: SignedIn, version: number) => {
    if (refreshing?.tokens === current.tokens) return refreshing.result;
    const result = (async () => {
      const answer = await fetch(TOKEN_URL, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: current.tokens.refreshToken,
          client_id: current.clientId,
        }).toString(),
        redirect: "error",
        signal: deadline(),
      }).catch(() => null);
      if (answer === null) return "offline";
      const body = await json(answer);
      if (generation !== version || stored?.status !== "signedIn") return "failed";
      if (!answer.ok) {
        if (
          answer.status === 400 &&
          (body as { error?: unknown } | null)?.error === "invalid_grant"
        )
          expire();
        return "failed";
      }
      const tokens = readTokens(body, now(), current.tokens.refreshToken);
      if (tokens === null) return "failed";
      const session = { ...stored, tokens };
      stored = session;
      store.save(session);
      return "ok";
    })()
      .catch(() => "failed" as const)
      .finally(() => {
        if (refreshing?.result === result) refreshing = undefined;
      });
    refreshing = { tokens: current.tokens, result };
    return result;
  };

  const unavailable = (): SpotifyRequest => ({
    status: stored?.status === "expired" ? "expired" : stored === null ? "signedOut" : "failed",
  });

  const request = async (path: string, init?: SpotifyRequestInit): Promise<SpotifyRequest> => {
    const url = URL.parse(path, API_ORIGIN);
    if (url?.origin !== API_ORIGIN || !url.pathname.startsWith("/v1/") || !path.startsWith("/v1/"))
      return { status: "failed" };
    if (stored?.status !== "signedIn") return unavailable();
    if (!online()) return { status: "offline" };
    const version = generation;
    if (now() >= stored.tokens.expiresAt - 60_000) {
      const result = await refresh(stored, version);
      if (generation !== version || stored?.status !== "signedIn") return unavailable();
      if (result !== "ok") return { status: result };
    }
    const sent = stored.tokens;
    try {
      let response = await apiFetch(fetch, url, sent, init);
      if (generation !== version || stored?.status !== "signedIn") return unavailable();
      if (response.status !== 401) return { status: "response", response };
      void response.body?.cancel().catch(() => {});
      if (stored.tokens === sent) {
        const result = await refresh(stored, version);
        if (generation !== version || stored?.status !== "signedIn") return unavailable();
        if (result !== "ok") return { status: result };
      }
      const retried = stored.tokens;
      response = await apiFetch(fetch, url, retried, init);
      if (generation !== version || stored?.status !== "signedIn") return unavailable();
      if (response.status !== 401) return { status: "response", response };
      void response.body?.cancel().catch(() => {});
      if (stored.tokens === retried) expire();
      return unavailable();
    } catch {
      return generation === version ? { status: "offline" } : unavailable();
    }
  };

  const check = async () => {
    const version = generation;
    const result = await request(PROFILE_PATH);
    if (result.status !== "response" || !result.response.ok) return;
    const account = readSpotifyWebProfile(await json(result.response));
    if (generation !== version || stored?.status !== "signedIn" || account === null) return;
    if (stored.account.name === account.name && stored.account.photoUrl === account.photoUrl)
      return;
    stored = { ...stored, account };
    state = stepSpotifyAccount(state, { type: "sessionChanged", session: sessionOf(stored) });
    store.save(stored);
  };

  const photo = async () => {
    const url = URL.parse(stored?.status === "signedIn" ? (stored.account.photoUrl ?? "") : "");
    if (
      url === null ||
      url.protocol !== "https:" ||
      url.username !== "" ||
      url.password !== "" ||
      url.port !== "" ||
      !PHOTO_HOSTS.has(url.hostname)
    )
      return null;
    const version = generation;
    const data = await readRemoteImage(fetch, url.href, 2_000_000, deadline());
    return generation === version ? data : null;
  };

  const cancelSignIn = () => {
    attempt?.abort();
    attempt = undefined;
    state = stepSpotifyAccount(state, { type: "signInCancelled" });
  };

  const signIn = async () => {
    if (clientId === null || attempt !== undefined || stored?.status === "signedIn") return;
    state = stepSpotifyAccount(state, { type: "signInStarted" });
    if (!online()) {
      state = stepSpotifyAccount(state, { type: "signInFailed", reason: "offline" });
      return;
    }
    const controller = new AbortController();
    attempt = controller;
    try {
      const answer = await exchangeBrowserCode({
        authUrl: AUTH_URL,
        tokenUrl: TOKEN_URL,
        clientId,
        scope: SCOPES,
        callbackPath: "/spotify/callback",
        openExternal: options.openExternal,
        page: options.page(),
        fetch: (input, init) => fetch(input, { ...init, signal: deadline(controller.signal) }),
        signal: controller.signal,
      });
      if (!answer.ok) throw new BrowserSignInError("failed");
      const tokens = readTokens(await json(answer), now());
      if (tokens === null) throw new BrowserSignInError("failed");
      const profile = await apiFetch(fetch, new URL(PROFILE_PATH, API_ORIGIN), tokens, {
        signal: controller.signal,
      }).catch(() => {
        throw new BrowserSignInError("network");
      });
      const account = profile.ok ? readSpotifyWebProfile(await json(profile)) : null;
      if (attempt !== controller) return;
      if (account === null) throw new BrowserSignInError("failed");
      const session: SignedIn = { status: "signedIn", clientId, tokens, account };
      store.save(session);
      stored = session;
      generation++;
      state = stepSpotifyAccount(state, { type: "signInEnded", outcome: sessionOf(session) });
    } catch (error) {
      if (attempt !== controller) return;
      if (error instanceof BrowserSignInError && error.reason === "cancelled") {
        state = stepSpotifyAccount(state, { type: "signInCancelled" });
      } else {
        state = stepSpotifyAccount(state, {
          type: "signInFailed",
          reason:
            error instanceof BrowserSignInError && error.reason === "network"
              ? "offline"
              : "failed",
        });
      }
    } finally {
      if (attempt === controller) attempt = undefined;
    }
  };

  return {
    view: () => ({
      configured: clientId !== null,
      account: spotifyAccountView(state),
      keyringMissing: clientId !== null && store.keyringMissing(),
    }),
    session: () => state.session,
    signIn,
    cancelSignIn,
    signOut: () => {
      store.clear();
      cancelSignIn();
      generation++;
      stored = null;
      state = SPOTIFY_ACCOUNT_SIGNED_OUT;
    },
    check,
    photo,
    request,
    dispose: () => {
      generation++;
      cancelSignIn();
    },
  };
};
