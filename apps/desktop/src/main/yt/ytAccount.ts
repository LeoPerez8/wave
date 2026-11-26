/**
 * The YouTube account on the desktop (docs/spec-desktop.md, Sign-in): Core's `stepYtAccount`
 * over the sign-in in the installed browser (`ytBrowserSignIn.ts`), the JVM's shared `YtClient`
 * that accepts and uses the session, and the session main keeps for it (`ytSessionStore.ts`).
 */
import {
  YT_ACCOUNT_SIGNED_OUT,
  stepYtAccount,
  ytAccountView,
  ytLibraryFailure,
  ytLibraryPicker,
  ytSignInEmail,
  type AppLanguage,
  type WaveSession,
  type YtAccountEvent,
  type YtAccountState,
  type YtLibraryFailure,
  type YtLibraryPlaylist,
  type YtSession,
} from "@wave/core";
import type { YtAccountPanel, YtAccountPlaylists } from "../../shared/ytAccount.ts";
import type { KotlinMethods } from "../kotlin/protocol.ts";
import type { YtBrowserSignIn } from "./ytBrowserSignIn.ts";
import { readYtAccount, type YtSessions } from "./ytSessionStore.ts";

export interface YtAccountDeps {
  readonly sessions: YtSessions;
  readonly call: <M extends keyof KotlinMethods>(
    method: M,
    params: KotlinMethods[M]["params"],
  ) => Promise<KotlinMethods[M]["result"]>;
  /** Whether YT Music is on in Settings. */
  readonly enabled: () => boolean;
  readonly online: () => boolean;
  /** Opens the browser on Google's sign-in (`startYtBrowserSignIn`). */
  readonly startSignIn: (email: string | null) => YtBrowserSignIn;
  readonly waveSession: () => WaveSession;
}

export interface YtAccountShape {
  readonly view: () => YtAccountPanel;
  /** Settles once the sign-in ended, however it did; the view says how. */
  readonly signIn: () => Promise<void>;
  readonly cancelSignIn: () => void;
  readonly signOut: () => Promise<void>;
  /** The account's YouTube Music playlists, Liked Songs first. */
  readonly playlists: (language: AppLanguage) => Promise<YtAccountPlaylists>;
  readonly dispose: () => void;
}

const codeOf = (error: unknown): unknown => (error as { code?: unknown } | null)?.code;

const text = (value: unknown): string | null => (typeof value === "string" ? value : null);

/** The library page's playlists as the JVM answers them (`YtLibraryPlaylist.toMap`). */
const libraryPlaylists = (value: unknown): YtLibraryPlaylist[] =>
  (Array.isArray(value) ? value : []).flatMap((row: unknown) => {
    if (typeof row !== "object" || row === null) return [];
    const { playlistId, title, artworkUrl, songCount, kind } = row as Record<string, unknown>;
    if (typeof playlistId !== "string" || typeof title !== "string") return [];
    return [
      {
        playlistId,
        title,
        artworkUrl: text(artworkUrl),
        songCount: typeof songCount === "number" ? songCount : null,
        kind: kind === "own" || kind === "saved" ? kind : "generated",
      },
    ];
  });

/** The JVM's answer to a session call (`YtSessionState.toMap`), as Core's session. */
const readYtSession = (value: unknown): YtSession => {
  if (typeof value !== "object" || value === null) return { status: "signedOut" };
  const { status } = value as Record<string, unknown>;
  const account = readYtAccount((value as Record<string, unknown>)["account"]);
  if (status === "expired") return { status: "expired", account };
  return status === "signedIn" && account !== null
    ? { status: "signedIn", account }
    : { status: "signedOut" };
};

export const createYtAccount = (deps: YtAccountDeps): YtAccountShape => {
  const { sessions, call } = deps;
  // Read on first use: the keyring answers only once the app is ready.
  let state: YtAccountState | undefined;
  const current = (): YtAccountState =>
    (state ??= stepYtAccount(YT_ACCOUNT_SIGNED_OUT, {
      type: "sessionChanged",
      session: sessions.session(),
    }));
  const dispatch = (event: YtAccountEvent) => {
    state = stepYtAccount(current(), event);
  };
  const unsubscribe = sessions.subscribe((session) =>
    dispatch({ type: "sessionChanged", session }),
  );

  let noBrowser = false;
  let signingIn: { readonly browser: YtBrowserSignIn; readonly done: Promise<void> } | undefined;
  let checked = false;
  /** Asks YouTube once per run whether it still accepts the kept session. */
  const check = () => {
    if (checked || current().session.status !== "signedIn" || !deps.enabled() || !deps.online())
      return;
    checked = true;
    // What YouTube says comes back as a session the JVM hands over.
    void call("ytCheckSession", {}).catch(() => {});
  };

  const signIn = async (): Promise<void> => {
    if (!deps.enabled()) return;
    noBrowser = false;
    dispatch({ type: "signInStarted" });
    if (!deps.online()) {
      dispatch({ type: "signInFailed", reason: "offline" });
      return;
    }
    let browser: YtBrowserSignIn;
    try {
      browser = deps.startSignIn(ytSignInEmail(current().session, deps.waveSession()));
    } catch {
      dispatch({ type: "signInFailed", reason: "failed" });
      return;
    }
    const done = (async () => {
      const outcome = await browser.outcome;
      if (!deps.enabled()) dispatch({ type: "signInCancelled" });
      else if (outcome.kind === "noBrowser") {
        noBrowser = true;
        dispatch({ type: "signInCancelled" });
      } else if (outcome.kind === "cancelled" || outcome.kind === "closed")
        dispatch({ type: "signInCancelled" });
      else if (outcome.kind === "failed") dispatch({ type: "signInFailed", reason: "failed" });
      else
        try {
          const session = await call("ytSignIn", {
            cookie: outcome.cookie,
            ...(outcome.dataSyncId === null ? {} : { dataSyncId: outcome.dataSyncId }),
            sessionIndex: outcome.sessionIndex,
          });
          checked = true;
          dispatch({ type: "signInEnded", outcome: readYtSession(session) });
        } catch (error) {
          dispatch({
            type: "signInFailed",
            reason: codeOf(error) === "ERR_YT_OFFLINE" || !deps.online() ? "offline" : "failed",
          });
        }
    })();
    signingIn = { browser, done };
    try {
      await done;
    } finally {
      signingIn = undefined;
    }
  };

  return {
    view: () => {
      check();
      return {
        account: ytAccountView(current(), deps.enabled()),
        keyringMissing: sessions.keyringMissing(),
        noBrowser,
      };
    },
    // A second Sign In while the browser is open waits for the first.
    signIn: () => signingIn?.done ?? signIn(),
    cancelSignIn: () => signingIn?.browser.cancel(),
    signOut: async () => {
      try {
        dispatch({ type: "sessionChanged", session: readYtSession(await call("ytSignOut", {})) });
      } catch {
        // The JVM isn't answering: the session is forgotten here, and it starts without one.
        sessions.forget();
      }
    },
    playlists: async (language) => {
      const failed = (reason: YtLibraryFailure): YtAccountPlaylists => ({
        status: "failed",
        ...ytLibraryFailure(reason, language),
      });
      if (!deps.enabled()) return failed("disabled");
      if (current().session.status !== "signedIn") return failed("signedOut");
      if (!deps.online()) return failed("offline");
      try {
        const { rows } = ytLibraryPicker(
          libraryPlaylists(await call("libraryPlaylists", {})),
          undefined,
          language,
        );
        return {
          status: "ok",
          playlists: rows.map(({ playlistId, title, artworkUrl, line }) => ({
            playlistId,
            title,
            artworkUrl,
            line,
          })),
        };
      } catch (error) {
        const code = codeOf(error);
        return failed(
          code === "ERR_YT_SIGNED_OUT"
            ? "signedOut"
            : code === "ERR_YT_DISABLED"
              ? "disabled"
              : code === "ERR_YT_OFFLINE" || !deps.online()
                ? "offline"
                : "failed",
        );
      }
    },
    dispose: () => {
      unsubscribe();
      signingIn?.browser.cancel();
    },
  };
};
