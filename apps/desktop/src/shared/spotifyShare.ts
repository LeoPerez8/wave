import type { SharePlaylistFailure } from "@wave/core";
import type { Invoke } from "./bridge.ts";

/**
 * What Share to Spotify did. Main asks Spotify and copies the link; the window only hears how
 * it went: how many songs Spotify had, that none were there, that Spotify needs a sign-in first
 * ([again] when it ended the session), or why it stopped.
 */
export type SpotifyShareOutcome =
  | { readonly kind: "shared"; readonly found: number; readonly total: number }
  | { readonly kind: "nothingFound" }
  | { readonly kind: "signIn"; readonly again: boolean }
  | { readonly kind: "failed"; readonly reason: SharePlaylistFailure };

export interface SpotifyShareContract {
  /** Makes or updates the playlist's public copy on the Spotify account and copies its link. */
  readonly "spotifyShare.playlist": {
    readonly args: readonly [playlistId: number];
    readonly result: SpotifyShareOutcome;
  };
}

export const SPOTIFY_SHARE_CALLS = ["spotifyShare.playlist"] as const;

export const spotifyShareBridge = (invoke: Invoke) => ({
  playlist: (playlistId: number) => invoke("spotifyShare.playlist", playlistId),
});
