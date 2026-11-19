import type { AppLanguage, YtAccountView, YtLibraryFailureView } from "@wave/core";
import type { Invoke } from "./bridge.ts";

/** What Settings › Accounts shows about the YouTube account; the session stays in main. */
export interface YtAccountPanel {
  /** Null with YT Music off and nobody signed in: there is nothing to show. */
  readonly account: YtAccountView | null;
  /** No keyring: the session lasts until Wave quits, and Settings says so. */
  readonly keyringMissing: boolean;
  /** The last Sign In found no browser it can sign in with. */
  readonly noBrowser: boolean;
}

/** A playlist of the signed-in account's YouTube Music library. */
export interface YtAccountPlaylist {
  /** YouTube's playlist id, without `VL`; `LM` for Liked Songs. */
  readonly playlistId: string;
  readonly title: string;
  readonly artworkUrl: string | null;
  /** "N songs", when the library page says. */
  readonly line: string | null;
}

export type YtAccountPlaylists =
  | { readonly status: "ok"; readonly playlists: readonly YtAccountPlaylist[] }
  | ({ readonly status: "failed" } & YtLibraryFailureView);

export interface YtAccountContract {
  readonly "ytAccount.view": { readonly args: readonly []; readonly result: YtAccountPanel };
  /** Opens the browser to sign in; settles once that ended, however it did. */
  readonly "ytAccount.signIn": { readonly args: readonly []; readonly result: void };
  readonly "ytAccount.cancelSignIn": { readonly args: readonly []; readonly result: void };
  readonly "ytAccount.signOut": { readonly args: readonly []; readonly result: void };
  readonly "ytAccount.playlists": {
    readonly args: readonly [language: AppLanguage];
    readonly result: YtAccountPlaylists;
  };
}

export const YT_ACCOUNT_CALLS = [
  "ytAccount.view",
  "ytAccount.signIn",
  "ytAccount.cancelSignIn",
  "ytAccount.signOut",
  "ytAccount.playlists",
] as const;

export const ytAccountBridge = (invoke: Invoke) => ({
  view: () => invoke("ytAccount.view"),
  signIn: () => invoke("ytAccount.signIn"),
  cancelSignIn: () => invoke("ytAccount.cancelSignIn"),
  signOut: () => invoke("ytAccount.signOut"),
  playlists: (language: AppLanguage) => invoke("ytAccount.playlists", language),
});
