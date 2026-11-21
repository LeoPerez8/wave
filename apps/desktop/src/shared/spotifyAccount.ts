import type { SpotifyAccountView } from "@wave/core";
import type { Invoke } from "./bridge.ts";

/** Spotify in Settings › Accounts. The session credentials stay in main. */
export interface SpotifyAccountPanel {
  readonly configured: boolean;
  readonly account: SpotifyAccountView;
  readonly keyringMissing: boolean;
}

export interface SpotifyAccountContract {
  readonly "spotifyAccount.view": {
    readonly args: readonly [];
    readonly result: SpotifyAccountPanel;
  };
  readonly "spotifyAccount.signIn": { readonly args: readonly []; readonly result: void };
  readonly "spotifyAccount.cancelSignIn": { readonly args: readonly []; readonly result: void };
  readonly "spotifyAccount.signOut": { readonly args: readonly []; readonly result: void };
  readonly "spotifyAccount.check": { readonly args: readonly []; readonly result: void };
  readonly "spotifyAccount.photo": { readonly args: readonly []; readonly result: string | null };
}

export const SPOTIFY_ACCOUNT_CALLS = [
  "spotifyAccount.view",
  "spotifyAccount.signIn",
  "spotifyAccount.cancelSignIn",
  "spotifyAccount.signOut",
  "spotifyAccount.check",
  "spotifyAccount.photo",
] as const;

export const spotifyAccountBridge = (invoke: Invoke) => ({
  view: () => invoke("spotifyAccount.view"),
  signIn: () => invoke("spotifyAccount.signIn"),
  cancelSignIn: () => invoke("spotifyAccount.cancelSignIn"),
  signOut: () => invoke("spotifyAccount.signOut"),
  check: () => invoke("spotifyAccount.check"),
  photo: () => invoke("spotifyAccount.photo"),
});
